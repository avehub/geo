// ============================================================================
// 🔴 针对**生产 JS**（search_browser.rs::extract_visible_tables_script）的离线测试
//
// 为什么必须测这段字符串：它只在真实浏览器里执行，而真实执行需要用户登录百度站长
// —— 线下/CI 都跑不了。所以这里用**极简假 DOM** 直接跑真实脚本源码，
// 至少把"结构判据"（表头表/表体表识别、合并、可见性）钉住。
//
// 覆盖的真实事实（2026-11-18 用户实测录制）：
//   · Element UI 的 el-table 把表头与表体渲染成两个独立 <table>
//   · 前者只有 1 行 th、后者只有 N 行 td
//   · 按"每张表各自取首行为表头"处理 → 前者 0 行、后者首行被当表头丢弃 → 永远 0 行
// ============================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 从 Rust 源码抽出生产 JS（与 refresh-capture-snippet.py 同源，避免测到副本） */
function productionJs() {
  const src = readFileSync('apps/desktop/src-tauri/src/services/search_browser.rs', 'utf8')
  const m = /pub fn extract_visible_tables_script\(\) -> &'static str \{\s*r#"(.*?)"#\s*\}/s.exec(src)
  if (!m) throw new Error('找不到 extract_visible_tables_script')
  return m[1]
}

// ── 极简 DOM ──────────────────────────────────────────────────────────────
class El {
  constructor(tag, text = '', { cls = '', visible = true } = {}) {
    this.tagName = tag.toUpperCase()
    this.textContent = text
    this.innerText = text
    this.className = cls
    this.children = []
    this.parentElement = null
    this.visible = visible
  }
  append(...kids) {
    for (const k of kids) {
      k.parentElement = this
      this.children.push(k)
    }
    return this
  }
  walk(out = []) {
    for (const c of this.children) {
      out.push(c)
      c.walk(out)
    }
    return out
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim())
    return this.walk().filter((e) => parts.some((p) => e.tagName.toLowerCase() === p.toLowerCase()))
  }
  getBoundingClientRect() {
    return this.visible ? { width: 800, height: 20 } : { width: 0, height: 0 }
  }
  getClientRects() {
    return this.visible ? [{}] : []
  }
  contains(other) {
    if (other === this) return true
    return this.walk().includes(other)
  }
}

const row = (tag, cells, visible = true) => new El('tr', '', { visible }).append(
  ...cells.map((c) => new El(tag, c)),
)
const text = (t) => new El('div', t)

/**
 * el-table 形状：header 与 body 是两个**独立的 table**，同属 .el-table 容器
 */
function elTableDom(header, rows, { visible = true } = {}) {
  const headerTable = new El('table', '', { cls: 'el-table__header', visible })
  headerTable.append(row('th', [...header, '']))  // 🔴 真实页表头比数据行多一个空 gutter 单元格
  const bodyTable = new El('table', '', { cls: 'el-table__body', visible })
  for (const r of rows) bodyTable.append(row('td', r))
  const headerWrap = new El('div', '', { cls: 'el-table__header-wrapper' }).append(headerTable)
  const bodyWrap = new El('div', '', { cls: 'el-table__body-wrapper' }).append(bodyTable)
  const container = new El('div', '', { cls: 'el-table' }).append(new El('div', '', { cls: 'hidden-columns' }), headerWrap, bodyWrap)
  const root = new El('body').append(new El('section', '', { cls: 'panel-card' }).append(container))
  return { root, headerTable, bodyTable }
}

/** 普通表格：表头与数据行在同一个 table 里 */
function plainTableDom(header, rows) {
  const table = new El('table')
  table.append(row('th', header), ...rows.map((r) => row('td', r)))
  const root = new El('body').append(table)
  return { root, table }
}

function run(js, root) {
  const sandbox = {
    document: { querySelectorAll: (sel) => (sel === 'table' ? root.querySelectorAll('table') : []) },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
  }
  const fn = new Function('document', 'window', `return ${js}`)
  return JSON.parse(fn(sandbox.document, sandbox.window))
}

// ── 断言工具 ──────────────────────────────────────────────────────────────
let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ ${msg}`)
    pass++
  } else {
    console.log(`  ❌ ${msg}`)
    fail++
  }
}

const JS = productionJs()

console.log('[1] 🔴 el-table 拆分结构 → 必须合并成一张表')
{
  const { root } = elTableDom(
    ['关键词', 'AI引用量', 'AI曝光量', 'AI点击量', 'AI点击率', '操作'],
    [['示例站点app大小', '1', '0', '0', '0.00%', '查看']],
  )
  const out = run(JS, root)
  ok(out.length === 1, `合并后只剩 1 张表（实际 ${out.length}）`)
  const lines = (out[0] || '').split('\n')
  ok(lines.length === 2, `表头 + 1 行数据 = 2 行（实际 ${lines.length}）`)
  ok(lines[0].startsWith('关键词\tAI引用量\tAI曝光量'), `表头行正确：${JSON.stringify(lines[0].slice(0, 40))}`)
  ok(lines[1].startsWith('示例站点app大小\t1\t0'), `数据行正确：${JSON.stringify(lines[1].slice(0, 40))}`)
  ok(!lines[0].endsWith('\t'), '表头尾部的空 gutter 单元格被裁掉')
}

console.log('[2] el-table 多行数据 —— 全部保留且顺序不变')
{
  const rows = [
    ['甲', '3', '10', '1', '10.00%', '查看'],
    ['乙', '2', '8', '0', '0.00%', '查看'],
    ['丙', '1', '0', '0', '0.00%', '查看'],
  ]
  const { root } = elTableDom(['关键词', 'AI引用量', 'AI曝光量', 'AI点击量', 'AI点击率', '操作'], rows)
  const out = run(JS, root)
  const lines = (out[0] || '').split('\n')
  ok(out.length === 1 && lines.length === 4, `表头 + 3 行（实际表数 ${out.length}，行数 ${lines.length}）`)
  ok(lines.slice(1).map((l) => l.split('\t')[0]).join(',') === '甲,乙,丙', '数据行顺序保持')
}

console.log('[3] 普通单表（表头+数据在同一 table）—— 行为不变')
{
  const { root } = plainTableDom(
    ['关键词', '点击量', '展现量', '点击率'],
    [['工业除尘器', '8', '1200', '0.0067']],
  )
  const out = run(JS, root)
  ok(out.length === 1, `仍是 1 张表（实际 ${out.length}）`)
  const lines = (out[0] || '').split('\n')
  ok(lines.length === 2 && lines[0].startsWith('关键词'), '表头与数据都在同一张表里')
}

console.log('[4] 隐藏的表要被过滤（el-table 无数据时 body 会隐藏）')
{
  const { root } = elTableDom(['关键词', 'AI引用量'], [], { visible: false })
  const out = run(JS, root)
  ok(out.length === 0, `不可见的表全部被过滤（实际 ${out.length}）`)
}

console.log('[5] 🔴 源码里不得出现任何业务字符串（Task 10 的 DR-A4 同款纪律）')
{
  const banned = ['ziyuan', 'baidu', 'aiflow', 'AI 流量', '收录', '关键词表', 'el-table__header']
  const hits = banned.filter((b) => JS.includes(b))
  ok(hits.length === 0, `无业务/框架专有字符串（命中：${hits.join(',') || '无'}）`)
  // 🔴 也不能有可执行注入面
  const code = ['eval(', 'new Function', 'document.cookie', 'localStorage', 'fetch(', 'XMLHttpRequest']
  const bad = code.filter((c) => JS.includes(c))
  ok(bad.length === 0, `无脚本执行/隐私越界调用（命中：${bad.join(',') || '无'}）`)
}

console.log('[6] 返回值必须是**字符串**（Tab::evaluate 的 return_by_value:false 要求）')
{
  const { root } = plainTableDom(['关键词'], [['甲']])
  const fn = new Function('document', 'window', `return ${JS}`)
  const raw = fn(
    { querySelectorAll: (s) => (s === 'table' ? root.querySelectorAll('table') : []) },
    { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
  )
  ok(typeof raw === 'string', `返回值类型是 string（实际 ${typeof raw}）`)
  ok(Array.isArray(JSON.parse(raw)), '且是合法 JSON 数组')
}

console.log(`\n[browser-extract.test] ${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
