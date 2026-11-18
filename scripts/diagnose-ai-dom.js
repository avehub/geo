// ============================================================================
// 只读诊断：搞清 AI 流量页的**数据行到底在什么元素里**（Task 10 设计输入）
//
// 背景：2026-11-18 实测（用户提供 Console 输出）：
//   表0: rows=1 first="关键词 AI引用量 AI曝光量 AI点击量 AI点击率 操作"
//   表1: rows=0 first=""
// 即整页只有 1 个 <table> 且只有表头行 —— **数据行不在 table 里**。
// 现有 extract_visible_tables_script() 只遍历 table → th/td，
// 因此对真实 AI 页永远只能拿到 0 行。要设计新提取器必须先知道数据行的真实结构。
//
// 🔴 隐私边界：只读**可见文本**与结构性元信息（tagName / role / className），
//    不读 cookie / localStorage / 网络，不读任何输入值，不截屏。
//
// 用法：在 AI 流量页按 F12 → Console → 整段粘贴回车，把打印出的全部文本发回。
//       若数据行很多，确保页面已滚动到有数据的区域再看输出。
// ============================================================================

/* eslint-disable */
(() => {
  const say = (s) => console.log(s);
  const txt = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  const all = (sel) => {
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch (_) {
      return [];
    }
  };
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    try {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch (_) {
      return true;
    }
  };
  const sig = (el) => {
    const role = el.getAttribute && el.getAttribute('role');
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return el.tagName.toLowerCase() + (role ? `[role=${role}]` : '') + cls;
  };

  say('=== 0. 页面 ===');
  say('url   : ' + location.href);
  say('title : ' + document.title);

  say('\n=== 1. 所有 table ===');
  const tables = all('table');
  say('table 总数: ' + tables.length);
  tables.forEach((t, i) => {
    const rows = t.querySelectorAll ? t.querySelectorAll('tr') : [];
    const first = rows && rows[0];
    say(
      `  表${i} rows=${rows ? rows.length : '?'} 可见=${visible(t)} 首行=${JSON.stringify(txt(first || t).slice(0, 70))}`,
    );
  });

  say('\n=== 2. 候选容器：可见计数 + 前 2 个样本的"子元素文本" ===');
  const CANDIDATES = [
    '[role="row"]',
    '[role="gridcell"]',
    '[role="grid"]',
    '[role="table"]',
    '[role="listitem"]',
    'tbody tr',
    'tr',
    '[class*="row"]',
    '[class*="list-item"]',
    '[class*="cell"]',
  ];
  for (const sel of CANDIDATES) {
    const els = all(sel).filter(visible);
    if (!els.length) continue;
    say(`  ${sel}  → 可见 ${els.length}`);
    for (const el of els.slice(0, 2)) {
      const kids = Array.from(el.children || []);
      const cells = kids.length ? kids.map((k) => txt(k)) : [txt(el)];
      say(`      <${sig(el)}> 子=${kids.length} ${JSON.stringify(cells).slice(0, 220)}`);
    }
  }

  say('\n=== 3. 表头表向上 5 层的祖先链（看数据是否在兄弟节点）===');
  const headerTable = tables.find((t) => txt(t).includes('AI引用量')) || tables[0];
  if (!headerTable) {
    say('  （找不到表头表）');
  } else {
    let node = headerTable.parentElement;
    for (let up = 1; up <= 5 && node; up++) {
      const kids = Array.from(node.children || []);
      say(
        `  ↑${up} <${sig(node)}> 子=${kids.length} 可见=${visible(node)} 文本=${JSON.stringify(txt(node).slice(0, 60))}`,
      );
      // 兄弟节点里有没有"行样"的？打印前 3 个子节点的签名与文本
      kids.slice(0, 3).forEach((k, i) => {
        const kk = Array.from(k.children || []);
        say(
          `      ├ 子${i} <${sig(k)}> 孙=${kk.length} 文本=${JSON.stringify(txt(k).slice(0, 60))}`,
        );
      });
      node = node.parentElement;
    }
  }

  say('\n=== 4. 全页扫描：重复出现的"多子元素且各有文本"模式（不依赖表头列数）===');
  const buckets = new Map();
  const pool = all('div, li, [role="row"], [role="listitem"]').filter(visible);
  for (const el of pool) {
    const kids = Array.from(el.children || []);
    if (kids.length < 4 || kids.length > 12) continue;
    if (!kids.every((k) => txt(k) !== '')) continue;
    if (kids.some((k) => k.querySelector && k.querySelector('table'))) continue;
    // 每个子元素都不该有太多子元素（那是容器不是单元格）
    if (kids.some((k) => (k.children || []).length > 3)) continue;
    const key = sig(el);
    if (!buckets.has(key)) buckets.set(key, []);
    if (buckets.get(key).length < 5) buckets.get(key).push(el);
  }
  const ranked = Array.from(buckets.entries())
    .filter(([, els]) => els.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (!ranked.length) {
    say('  （没找到重复的多子元素模式 —— 数据可能不在当前视口，请滚动到有数据的区域后重跑）');
  }
  for (const [key, els] of ranked.slice(0, 6)) {
    say(`  ├─ <${key}> 命中 ${els.length} 个（最多列 5）`);
    for (const el of els.slice(0, 3)) {
      const cells = Array.from(el.children || []).map((c) => txt(c));
      say(`  │   ${JSON.stringify(cells).slice(0, 260)}`);
    }
  }

  say('\n=== 5. 是否虚拟滚动（只渲染可见行）===');
  say('  页面里 role=row 总数=' + all('[role="row"]').length +
      '，可见=' + all('[role="row"]').filter(visible).length);
  const scrollers = all('[class*="scroll"], [style*="overflow"]').filter(visible).slice(0, 3);
  scrollers.forEach((s, i) => {
    say(`  滚动容器${i} <${sig(s)}> scrollH=${s.scrollHeight} clientH=${s.clientHeight}`);
  });

  say('\n=== 完成：把以上全部文本发回 ===');
})();
