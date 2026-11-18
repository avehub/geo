// ============================================================================
// 百度站长页面「可见表格」采集器 —— Task 10 改造前基线用（一次性手工执行）
//
// 🔴 里面的 extractVisibleTables() 是从
//    apps/desktop/src-tauri/src/services/search_browser.rs 的
//    extract_visible_tables_script() **逐字复制**过来的。
//    必须逐字一致：基线的意义就在于"这是线上实现真实的输出"，
//    改一个字符，改造前后的比对就失去参照物了。
//    （若线上脚本变更，请重新用 scripts/refresh-capture-snippet.py 生成本文件。）
//
// 🔴 隐私边界与线上一致：只读**可见表格的文本**，不碰 cookie / localStorage /
//    网络请求，不截屏，不读页面其它区域。
//
// 用法：在已登录的百度站长页面按 F12 打开 Console，整段粘贴回车，
//       浏览器会自动下载一个 JSON 文件。把文件交给开发即可。
// ============================================================================

/* eslint-disable */
(() => {
  // ↓↓↓ 以下函数体与 search_browser.rs::extract_visible_tables_script() 逐字一致 ↓↓↓
  const extractVisibleTables = () =>   (() => {
    const clean = (value) => (value || '')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && style.opacity !== '0';
    };
    const rowsOf = (table) => Array.from(table.querySelectorAll('tr'))
      .filter((row) => row.getClientRects().length > 0);
    const cellsOf = (row) => Array.from(row.querySelectorAll('th, td'))
      .map((cell) => clean(cell.innerText || cell.textContent));
    const tsvOf = (table) => rowsOf(table)
      .map((row) => {
        const cells = cellsOf(row);
        while (cells.length > 0 && cells[cells.length - 1] === '') {
          cells.pop();
        }
        return cells.join('\t');
      })
      .filter((line) => line.trim() !== '')
      .join('\n');

    // ── 表头表 / 表体表的识别（🔴 通用结构判据，不含任何业务字符串）──
    // 某些 UI 组件库（如 Element UI 的 el-table）把表头与表体渲染成**两个独立的
    // <table>**：一个只有一行 th，另一个只有若干行 td。若按"每张表各自取首行为表头"
    // 处理，前者解析出 0 行、后者首行被当成表头直接丢弃 —— 数据就永远抓不到。
    const isHeaderOnly = (table) => {
      const rows = rowsOf(table);
      if (rows.length !== 1) return false;
      const th = rows[0].querySelectorAll('th').length;
      const td = rows[0].querySelectorAll('td').length;
      return th > 0 && th >= td;
    };
    const isDataOnly = (table) => {
      const rows = rowsOf(table);
      if (rows.length < 1) return false;
      return rows.every((r) => r.querySelectorAll('th').length === 0
        && r.querySelectorAll('td').length > 0);
    };

    // 在 header 表的祖先链里找"最近的、包含另一张可见表"的容器，
    // 再在该容器内找第一张 data-only 表作为它的表体。
    // 🔴 用 DOM 包含关系判断，不靠 class 名（el-table / ant-table / vxe-table 都适用）。
    const findBody = (header, all, taken) => {
      let node = header.parentElement;
      for (let depth = 0; depth < 6 && node; depth++) {
        const inside = all.filter((t) => t !== header && !taken.has(t) && node.contains(t));
        const body = inside.find(isDataOnly);
        if (body) return body;
        node = node.parentElement;
      }
      return null;
    };

    const all = Array.from(document.querySelectorAll('table')).filter(visible);
    const taken = new Set();
    const merged = [];
    for (const table of all) {
      if (taken.has(table)) continue;
      if (isHeaderOnly(table)) {
        const body = findBody(table, all, taken);
        if (body) {
          taken.add(body);
          // 表头一行 + 表体若干行 → 合成一张正规表
          merged.push([tsvOf(table), tsvOf(body)].filter((s) => s !== '').join('\n'));
          continue;
        }
      }
      const text = tsvOf(table);
      if (text !== '') merged.push(text);
    }

    // 🔴 `Tab::evaluate` 固定 `return_by_value: false`：数组只会回 objectId。
    // 回一个字符串，`RemoteObject.value` 才拿得到内容。
    return JSON.stringify(merged);
  })();
  // ↑↑↑ 逐字复制区结束 ↑↑↑

  // 🔴🔴 必须 JSON.parse：线上脚本 return 的是 **JSON.stringify(tables)**（一个字符串），
  //    不是数组 —— 因为 `Tab::evaluate` 固定 return_by_value:false，返回数组只会拿到
  //    objectId，所以线上刻意序列化成字符串。照抄函数体时就继承了这个返回值形态。
  //    （第一版这里直接当数组用，`tables.map is not a function` 当场炸；
  //      这个错在浏览器 Console 里同样会炸，会让人白跑一趟登录采集。）
  const tables = JSON.parse(extractVisibleTables());
  if (!Array.isArray(tables)) throw new Error('提取结果不是数组，采集脚本可能已与线上实现漂移');
  const payload = {
    captured_at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    // 🔴 采集器版本指纹：用来证明"这份基线出自哪一版提取脚本"。
    //    脚本改了而指纹没变 = 基线不可信，所以这里对脚本源码本身取一个简单指纹。
    extractor_fingerprint: String(extractVisibleTables.toString().length) + ':' +
      extractVisibleTables.toString().split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0),
    table_count: tables.length,
    // 每张表的表头单独列出来，方便一眼核对"列名契约"是否符合真实平台
    headers: tables.map((t) => (t.split('\n')[0] || '').split('\t')),
    tables_tsv: tables,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const stamp = payload.captured_at.replace(/[:.]/g, '-').slice(0, 19);
  a.href = URL.createObjectURL(blob);
  a.download = `ziyuan-tables-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // 同时在控制台打印摘要，便于当场确认"表头对不对、有没有数据行"
  console.log('%c[采集完成] ' + payload.table_count + ' 张可见表格', 'color:#0a0;font-weight:bold');
  console.table(payload.headers.map((h, i) => ({ 表: i, 列数: h.length, 表头: h.join(' | ') })));
  console.log('每张表的数据行数：', tables.map((t) => Math.max(0, t.split('\n').length - 1)));
  console.log('已下载：' + a.download);
  console.log('%c🔴 交给开发前请自行脱敏：域名/站点名/真实关键词要替换，但【表头一个字都不能改】', 'color:#c00;font-weight:bold');
})();
