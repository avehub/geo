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
