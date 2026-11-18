# fixtures/search-browser —— 浏览器取数通道的离线样本

纪律同 `fixtures/search`、`fixtures/http`、`fixtures/llm`：**测试禁止联网（AGENTS 规则 2）**，
一切"平台页面长什么样"的证据以这里录制的文件为准。新增样本必须写明
**录制日期、录制人、来源页面路由**。

## 这个目录为什么存在（Task 10 的前置）

`services/search_browser.rs` 目前的取数链路是：

```
Chrome 页面 DOM
  └─(A) extract_visible_tables_script() 注入的 JS  →  每张可见表一个 TSV 字符串
        └─(B) Rust: tsv_header / pick_candidate_tables / header_is_recognized
              └─(C) geo_domain::parse_search_table  →  结构化行
```

Task 10 要把 (A) 的业务判据与 (C) 的**硬编码列名别名**换成「通用提取器 + 声明式规则包」。
这是本 plan 自认风险最高的一项，因为这条链路跑在**用户已登录的第三方平台会话**里，
且正确性只能靠真人登录真机验证 —— 回归成本极高。

所以计划要求：**改造前先冻结基线**，把现有实现对真实样本的输出存成
`fixtures/rulepack-parity/baseline-*.json`，改造后逐字段比对。

🔴 (A) 在真实浏览器里执行，**离线无法复现**。所以基线的输入必须是
"真人在真实页面上跑一次 (A) 得到的 TSV"—— 这就是本目录的内容。

## 怎么录（一次性手工操作）

1. 用**有 AI 流量数据**的站点登录百度搜索资源平台（零数据行的样本只能验表头，验不了行归一化）
2. 按 F12 打开 Console，把 `scripts/capture-search-tables.js` **整段**粘贴回车
3. 浏览器自动下载 `ziyuan-tables-<时间>.json`，Console 会打印表头与每张表的数据行数
4. 需要录的页面：

| 页面 | 路由 | 为什么要 |
|---|---|---|
| AI 流量分析 | `https://ziyuan.baidu.com/aiflow/index` | 主链路；含「AI 引用热门关键词」与「热门页面」**两张表** |
| 传统站长面 | `https://ziyuan.baidu.com/` | `SearchSourceKind::BaiduZiyuan` 分支，`page_classifiers` 要能把两个面分开 |
| 收录/索引页 | 站内导航到「收录」相关页 | 规则包里有 `page_table`（`title_contains: 收录`）分类，需真实标题佐证 |

> 🔴 采集脚本只读**可见表格文本**，不碰 cookie / localStorage / 网络请求、不截屏。
> 与线上 `extract_visible_tables_script()` 的隐私边界完全一致（隐私政策 §3.7）。
> `scripts/refresh-capture-snippet.py` 会校验脚本与 Rust 源码**逐字一致**，
> 防止采集器悄悄漂移导致基线失真。

## 🔴 脱敏规则（与以往不同，务必看清）

| 内容 | 处置 |
|---|---|
| 表头（`关键词` / `AI引用量` / `AI曝光量` / `AI点击量` / `AI点击率` / `页面`） | 🔴 **一个字都不能改**。表头就是列名契约本身，改了样本就失去意义 |
| 数据行的关键词、页面路径、域名、站点名 | **必须替换**成虚构但**结构相同**的值（长度、构词方式相近） |
| 数字（引用量/曝光量/点击量） | 可保留或等比缩放；🔴 但要**保留千分位逗号与 `%` 的原样格式**（`1,200`、`0.67%`），行归一化就是要处理它们 |
| `url` 字段 | 保留路由、去掉站点标识参数（如 `?site=`） |
| `title` | 保留（不含站点标识的话）；若含站点名则替换站点名、保留「AI 流量分析」等平台字样 |

命名：`<平台>-<页面>-<是否空表>-<录制日期>.json`，例如
`baidu-ziyuan-aiflow-with-data-2026-11-17.json`。

## 🔴 已发现的契约不一致（必须在 Task 10 之前解决）

后台仓已发布的 `baidu_ziyan` 规则包，其 `header_match` 是按后台仓
`apps/admin-server/src/modules/engine/fixtures/baidu-ziyuan-aiflow.html`
这份**手写样本**写的，而那份样本的表头是 `查询 | 曝光量 | 点击量 | 点击率`
（更像 Google Search Console 的列名），**与真实百度站长不一致**。

真实表头（本仓 `fixtures/search/README.md` 记录的 2026-10-12 真人实测）是：

```
关键词 | AI引用量 | AI曝光量 | AI点击量 | AI点击率        （页面表首列为「页面」）
```

对照后台规则包的 `header_match`（匹配语义是 `header.includes(pattern)`，见
`rulepack-test.service.ts`）：

| 字段 | header_match | 对真实表头的结果 |
|---|---|---|
| `query` | `["查询","问题"]` | 🔴 **匹配不到** `关键词` → 主键列丢失 |
| `impressions` | `["曝光","展现"]` | ✅ 命中 `AI曝光量` |
| `clicks` | `["点击"]` | ⚠️ 命中 `AI点击量`（**靠列顺序侥幸**：`AI点击率` 也含「点击」，若两列顺序调换就会绑错） |
| `ctr` | `["点击率","CTR"]` | ✅ 命中 `AI点击率` |
| — | *（缺失）* | 🔴 `AI引用量` **完全没有对应字段**，而 `geo-domain` 有专门的 `Column::Citations` |

而 `crates/geo-domain/src/search_import.rs` 里现有的**硬编码别名是对的**
（`关键词|AI引用量|AI曝光量|AI点击量|AI点击率` 都能识别）。

> 🔴 所以 Task 10 若直接拿现在这份规则包替换硬编码别名，
> **百度站长 AI 流量取数会从"能用"变成"不能用"**，而且丢掉 AI 引用量这个核心 GEO 指标。
> parity 基线会当场抓到这个回归 —— 这正是"先冻结基线"的价值。
>
> 正确顺序：先用真实录制样本修正后台仓的规则包（补 `关键词`、补 `citations`、
> 把 `点击` 换成不会与 `AI点击率` 冲突的精确匹配），再动桌面仓的解释器。

## 落库前的自检

```bash
python3 scripts/refresh-capture-snippet.py     # 采集器与 Rust 源码逐字一致
node --check scripts/capture-search-tables.js  # 语法
```

---

# 已录制的样本（2026-11-18，真人登录实测）

| 文件 | 页面 | 表头（真实，未脱敏） | 数据行 |
|---|---|---|---|
| `baidu-ziyuan-aiflow-2026-11-18.json` | `/aiflow/index` | `关键词 \| AI引用量 \| AI曝光量 \| AI点击量 \| AI点击率 \| 操作` | 表头 0 行；另有 1 行数据被单独放在另一张表 |
| `baidu-ziyuan-keywords-with-data-2026-11-18.json` | `/keywords/index?range=month` | `关键词 \| 点击量 \| 展现量 \| 点击率 \| 排名 \| 详情` | 10 行 ✅ |
| `baidu-ziyuan-indexs-with-data-2026-11-18.json` | `/indexs/index` | `索引量 \| 变化情况 \| 日期` | 10 行（时间序列） |

## 🔴 实测确认的事实（这些推翻了此前的假设）

1. **AI 表是 6 列，多一个「操作」**。前五列与 `geo-domain` 的别名完全对得上
   （`关键词`→Query、`AI引用量`→Citations、`AI曝光量`→Impressions、
   `AI点击量`→Clicks、`AI点击率`→CtrCheck），`操作` 是未知列、会被归到 extras 忽略。
   → **桌面仓的硬编码别名是对的**；风险只在声明式规则包那侧。

2. **点击率是带 `%` 的文本**：`44.20%`、`0.00%`。内部口径是小数（0.4420），
   直接 `parse::<f64>()` 会失败。2026-11-18 实测：修复前「流量与关键词」页
   **10 行全部 invalid_format、metrics=0**，即浏览器取数在真实数据上一直是坏的
   （与规则包无关）。已在 `parse_percent` 修复。

3. **整数有千分位**：`-2,992`、`7,100`、`5,523`（索引量表）。
   `parse_int` 本来就会 strip 逗号，这点没问题。

4. **"无数据"用占位符 `--`**（索引量表的 `变化情况` 列）。

5. 🔴 **AI 流量页的真实 `document.title` 不含「AI 流量」**，而是
   `百度搜索资源平台_共创共享鲜活搜索`。所以规则包里
   `page_classifiers[0].match.title_contains: ["AI 流量"]` **永远匹配不上**
   （靠 `url_contains: ["aiflow"]` 单独命中，且分类器用的是 AND 语义）。

6. 🔴🔴 **已确认：AI 流量页的数据行根本不在 `<table>` 里。**
   用户第二次录制 + Console 诊断确认：

   ```
   表0: rows=1 first="关键词 AI引用量 AI曝光量 AI点击量 AI点击率 操作"
   表1: rows=0 first=""
   ```

   **结构已由 `scripts/diagnose-ai-dom.js` 完整确认**：该页用的是 **Element UI 的
   `el-table`**，而 `el-table` 把表头与表体渲染成**两个独立的 `<table>`**：

   ```
   <section class="panel-card">
     <div class="panel-head">热门关键词 | 热门页面</div>        ← 两个 tab
     <div class="el-table data-table">
       <div class="hidden-columns"> …6 列… </div>
       <div class="el-table__header-wrapper">
         <table class="el-table__header">   ← 表0：表头（1 行 th）
       </div>
       <div class="el-table__body-wrapper">
         <table class="el-table__body">     ← 表1：表体（N 行 td，无表头）
       </div>
     </div>
     <div class="table-footer">下载表格 | 1 前往页 | 共 0 条</div>
   </section>
   ```

   **这意味着**：`extract_visible_tables_script()` 会拿到两张**互不相连**的表 ——
   一张只有表头（解析出 0 行）、一张只有数据行（首行被当成表头 → `missing_header`
   被丢弃）。所以对真实 AI 页**永远只能拿到 0 行**：不是解析 bug，是**结构性不匹配**，
   而且根因是 Element UI 的固定渲染方式，不是偶发。

   🔴 由此得出两条硬结论：
   * Task 10 的提取器必须**配对** `el-table__header` 与其**同一个 `.el-table` 容器内**
     的 `el-table__body`（跨独立 `<table>` 组表头与数据行）。
     计划里"遍历 table → 读 th/td"的假设对 AI 页不成立。
   * AI 页**没有有意义的"改造前 parity 基线"**（当前输出恒 0 行）。
     基线只能取「人工按可见页面核对出的期望行」，不能取"现有实现的输出"。

   另注：`table-footer` 里有 **「下载表格」** 按钮（xlsx 导出），
   与 `fixtures/search/*.xlsx` 那批录制样本对应 —— 说明平台除了页面表格
   还有导出路径。哪条作为主路径属于产品决策，见下条待确认项。

7. 🔴 **待确认（业务）**：本次复采的站点显示 **「暂无数据」/「共 0 条」**，
   即该站点**本身没有 AI 引用数据**。所以到目前为止**仍缺**
   "多行真实 AI 数据"的样本（唯一一行真实数据来自 2026-11-18T02-38 那次录制，
   且当时表头与数据行分处两个 table，与 el-table 结构一致）。

   要么换一个**有 AI 引用数据**的站点复采，要么接受"结构取自真实诊断、
   行值取自那唯一一行真实数据"的构造样本。两者都能推进，但前者更可信。

## 复采时需要确认的动作

在**页面完全加载、数据行可见**之后采集，并回答一个问题：
**肉眼看，表头那一行和数据行是在同一个表格框里，还是分成上下两个表格？**

如果确实分成两个 `<table>`，请在采集后额外把 Console 里这一行贴给我：

```js
[...document.querySelectorAll('table')].map((t,i)=>`表${i}: rows=${t.querySelectorAll('tr').length} first="${(t.querySelector('tr')?.innerText||'').replace(/\s+/g,' ').slice(0,60)}"`).join('\n')
```

它会输出每张表的行数与首行文本，足以判断表头与数据行的归属。

---

# ✅ 2026-11-18 已修复：el-table 拆分结构的合并

## 问题（已由真实录制证实）

AI 流量页用 Element UI 的 `el-table`，它把表头与表体渲染成**两个独立的 `<table>`**：

```
表0（el-table__header）: 关键词 AI引用量 AI曝光量 AI点击量 AI点击率 操作        ← 只有 1 行 th
表1（el-table__body）  : 示例站点app大小 1 0 0 0.00% 查看                      ← 只有 1 行 td
```

旧提取器"每张表各自取首行为表头" → 表0 解析出 0 行；表1 首行被当成表头 → `missing_header` 丢弃。
**合起来 = 0 行**，这就是「AI 流量取数恒为 0」的机械原因。

## 修复

`extract_visible_tables_script()` 现在会识别并**合并同一容器内的表头表与表体表**：

- 判据是**通用结构**，不含任何业务字符串，也不认 class 名（`el-table` / `ant-table` / `vxe-table` 通用）：
  * **表头表** = 恰好 1 行，且该行 `th` 数 ≥ `td` 数
  * **表体表** = 所有行都只有 `td`、没有 `th`
  * 配对方式：沿表头表的祖先链向上找**最近的、包含另一张可见表**的容器，取其中第一张表体表
- 合并结果 = 表头行 + 表体全部行，作为一张正规表交给 Rust 侧解析
- 普通单表（表头与数据在同一 `<table>`）**行为不变**
- 表头行末尾的空 gutter 单元格会被裁掉（真实页 `操作` 后还有一个空 `th`）

## 验证

| 层次 | 测试 | 结果 |
|---|---|---|
| 生产 JS（假 DOM 跑真实源码） | `scripts/tests/browser-extract.test.mjs` | **14/14**：合并、多行顺序、普通单表不变、隐藏表过滤、无业务字符串、返回值为字符串 |
| Rust 端到端（真实录制样本） | `search_import::ai_table_split_structure_tests` | **4/4**：复现"未合并 → 0 行"的 bug；验证"合并 → 1 行真实数据" |
| 采集器与源码一致性 | `scripts/refresh-capture-snippet.py` | 逐字一致（JS 主体 2866 字节） |

`browser-extract.test.mjs` 已接进 `mise run test` —— 那段脚本只在真实浏览器里跑
（需要登录百度站长），线下只能靠假 DOM 跑真实源码，至少把结构判据钉住。

## 基线怎么取（🔴 重要）

AI 页**不能用"现有实现的输出"当 baseline** —— 修复前它恒为 0 行，
冻进去就等于把 bug 固化成黄金标准。正确做法：

* 结构基线：`fixtures/search-browser/baidu-ziyuan-aiflow-with-data-2026-11-18.json`
  里那两张表的**原样形态**（表头表 + 表体表分开），由
  `capture_really_has_header_and_body_in_separate_tables` 守着 ——
  谁把 fixture 改成单表，测试会红并提醒"你改的是真实结构的证据"。
* 期望值基线：合并后应解析出 **1 行**，字段
  `query=示例站点app大小 / citations=1 / impressions=0 / clicks=0 / ctr=0.0`
  （AI 表的 ctr 分母是 citations，见 `parse_rows` 的 denominator 分支）。

## 仍未覆盖

* 该站点 AI 数据只有 **1 条**（`共 1 条`）。多行/分页/虚拟滚动的行为还没验过。
* 「热门页面」tab 的页面级表（`页面 | AI引用量 | …`）尚未录制；
  规则包里有个 `page_table` 分类但**没有对应的 table_rule**。
* `table-footer` 有「下载表格」（xlsx）—— 用户已裁定**走浏览器抓表格**，
  所以导出路径不作为主路径，但两者的列口径应保持一致（同一平台的两种呈现）。
