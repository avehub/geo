# GEO 桌面客户端 · M3–M7 demo 闭环（采集 → 解析 → 诊断 → 行动 → 报告）设计规格

> **文档状态**：实现完成、待产品负责人走查（2026-09-28；`mise run web` 打开即可验收）
> **关系**：本文件是 `2026-09-18-geo-desktop-demo-i18n-settings-design.md` 的**增量续作**——沿用其
> DR-1（demo 模式）、DR-2（错误码 + `params` + 前端词典）、DR-7（zh-CN/en-US 全量）、DR-10（demo 定稿后才落后端）
> 四条既定裁定，不重开；未提及的部分仍以原文档与 `2026-09-16-geo-desktop-p0-design.md` 为准。
> **配套**：本轮新增的 demo ↔ 真后端差异登记在 `2026-09-23-demo-vs-backend-known-divergences.md` **§4b（E-33 … E-45）**。
> **需求真值源**：`docs/GEO客户端-MVP产品定义-v1.md`（v1.1）§3.5–§3.9、附录 C。
> **门禁**：`mise run check` **全绿**（`CHECK_EXIT=0`）——cargo fmt / clippy `-D warnings` /
> cargo test **22 targets · 515 passed · 0 failed**（与上一轮同一基线，因为**Rust 侧本轮一行未动**）·
> `eslint --max-warnings 0` · vitest **53 files / 798 tests** · `tsc -p tsconfig.app.json --noEmit` ·
> 前端产物构建通过（`dist` = 1.69 MB / gzip **510 KB**，其中新增的 8 个种子模块是主要增量；
> 体积是否可接受请走 `mise run demo:preview` 亲自看一次）。

---

## 1. 背景与目标

前两轮（P0-A、Plan A/B）把 **M1 项目与品牌档案**、**M2 Prompt 题库**、**M8 客户端基座**的界面与设置页
在 demo 里定了稿。产品定义 §3.2 的模块总览里，P0 还剩 **M3 多引擎采集 / M4 解析与事实核查 /
M5 诊断与竞品对标 / M6 GEO 行动中心 / M7 报告与分享** 五个模块没有界面——而这五个恰恰是
「本产品到底长什么样、值不值得续费」的全部说服力所在（§3.8 的原话：海外工具
*"show where AI engines get your company wrong; they do not close the gap"*）。

按 AGENTS 规则 8（**demo 优先**），本轮把这五个模块的界面、交互、文案与信息架构
**全部在纯前端 demo 里做完**，不碰 Rust、不碰数据库、不碰迁移。

**目标**

- **G1** 让产品负责人能在浏览器里走完**一整条闭环**：排一轮采集 → 看证据 → 看解析与核查 →
  人工纠正/结办 → 看诊断与归因 → 领处方 → 生成文稿 → 出三版报告并导出。
- **G2** 把 M3–M7 的 **20 条 IPC 命令的契约**（DTO + 错误码 + 枚举）在前端先冻结下来，
  作为后端落地时的输入，而不是反过来等后端。
- **G3** 界面双语（zh-CN / en-US）与错误 i18n **一次做到位**，沿用 Plan A 的基座，不留半中半英。
- **G4** 合规红线（AGENTS 规则 6 / 产品定义 §3.8）在**文案与状态机两层**都落地：
  生成内容默认 `pending_review`、报告每一版都带免责声明、全站无绝对化用语。
- **G5** 把「demo 不许实现领域算法」（AGENTS 规则 9）变成**看得见**的界面纪律：
  凡是静态值的地方，界面上都明说「演示模式下是预置静态值，不由前端重算」。

## 2. 非目标（本轮明确不做）

- **不做任何 Rust 后端与数据库改动**：无新表、无迁移、无 `#[tauri::command]`。
- **不采集**：不接引擎 API、不起浏览器自动化、不抓网页、不截图。
- **不跑模型**：不做结构化抽取、不做双模型交叉校验、不做置信度打分、不生成文稿正文。
- **不算领域指标**：去重率、覆盖率、准确率、五维加权、样本量分级、归因 delta 一律是种子里的静态值。
- **不产 docx / pdf / png**：要原生渲染或文档库，纯前端 demo 不引。
- **不做定时任务、云同步、多项目白标账号体系（M9/M10）**。
- **不做真实用量记账与硬配额暂停**：用量看板是静态种子。

## 3. 决策记录（DR）

编号续 `2026-09-18-…-design.md` §3（DR-1 … DR-10）。

| # | 决策 | 被否方案与理由 |
|---|---|---|
| DR-11 | M3–M7 的 20 条命令**只在前端两侧登记**：`api/client.ts` 的 `IPC_COMMANDS`（40 → 60 条）与 `demo/backend.ts` 的 `demoBackend`。后者标注为 `Record<IpcCommand, DemoHandler>` ⇒ **漏一条 `tsc` 就红**；运行期另有 `backend.test.ts` 的「键集合与 `IPC_COMMANDS` 完全相等」断言 | 等后端先定契约：违背 AGENTS 规则 8 的 demo 优先；且后端落地时界面还没收敛，等于让 Rust 追着界面改两遍 |
| DR-12 | demo 只保留**人工操作**类写路径（排队 / 重跑 / 纠正 / 结办 / 告警已读 / 处方状态 / 生成文稿 / 渲染报告），**一律不重算任何比率** | 让纠正与结办联动重算准确率：那就是在前端实现附录 C 的口径，必然与 Rust 漂移（规则 9） |
| DR-13 | `collection_task_retry` **不重跑**，而是把 `seed/collection-records-retest.ts` 里预置的那条证据（+ 对应解析结果）推进内存库；轮次级聚合（`completed_queries` / `failed_queries` / `success_rate` / token）**刻意不动** | 顺手把聚合也重算：记账口径（成功率分母含不含重复采样、超时算不算失败）是后端的事，demo 猜一个就是新漂移面 ⇒ 登记为 E-35 |
| DR-14 | `planned_queries = 题目数 × 引擎数`，**刻意不乘 `repeat_count`** | 乘上去更"像真的"：重复采样只作用于**关键题目**（§3.5），而"哪些题算关键"由后端按意图与权重判定，demo 不判；乘上去还会与种子里第 3 轮自相矛盾（那一轮 `repeat_count: 2`、`planned_queries: 434` = 62 题 × 7 引擎）。"两个数字对不上"是本产品最不能出现的失败形态 ⇒ E-34 |
| DR-15 | M3–M7 的实体 id 认不出时，统一复用**既有**错误码 `validation/failed` + `params.reason: 'invalid_id'` + `params.field`，**不新增错误码** | 给每类实体加 `round/not_found` 之类：`contracts/error-codes.json` 冻结在 43 条、`errors.kinds.*` 钉在 Rust 真值源上不许扩（AGENTS 规则 7 的契约）。代价是 13 个新 `field` 值只活在前端词典里 ⇒ E-44 |
| DR-16 | 枚举入参一律**「收敛而不拒绝」**：契约外的值收敛成最保守的那一个（`sentiment` → `null`、`action_status` → `todo`、`fact_issue_status` → `open`、`risk` 筛选 → 不筛），**不报错**。**唯一例外**是 `report_render` 的 `variant`：悄悄出一份别的版本比报错更糟 ⇒ 发 `validation/failed` | 全部严格报错：demo 的调用方就是自家 UI，严格化只会把"界面与假后端对枚举的理解不一致"变成用户可见的错误弹窗；全部收敛：报告版本收敛错会产出一份**内容完全不同的报告**，那是静默造假 |
| DR-17 | `DiagnosisOverview` 内嵌的 `alerts` / `trend` 副本在**读取时**被 `db.alerts` / `SEED_TREND` 覆盖；写路径（告警已读）只写库里那一处 | 直接回内嵌副本：「标记已读」就得同时写两处，正是本仓反复警告的同步面。覆盖后「两份副本谁是真值」在代码里只有一个答案 |
| DR-18 | 展示格式化收进**单一模块** `components/format.ts`（百分比、带符号整数、耗时、token、条数、题目数、置信度、时间）。`AlertItem.delta` 装**原始单位**差值、`ReportMetricBlock.delta` 装**百分点** ⇒ 由 `alertDeltaText` 与 `metricDeltaText` **两个**函数分别处理，不共用 | 各页各写一份 `Math.round(x*100)+'%'`：六个漂移面；强行统一成一个 delta 口径：要改 DTO 语义，而 DTO 是后端契约的输入，本轮不该由 demo 单方面改 ⇒ E-40 |
| DR-19 | 报告标题 / 节标题 / 指标名 / 表头 / 免责声明 / 口径说明**都是界面文案**，一律走词典；种子只给**稳定记号 + 数据**。前端把两者拼成预览，也拼成 Markdown / HTML / CSV 导出文本（`api/report-compose.ts`）⇒ **导出文件随界面语言走** | 把整段报告正文写进种子：那是"后端产出自然语言进契约"这一类问题（差异清单 §5-2 已点名），会让报告没法双语 |
| DR-20 | demo 产不出 `docx` / `pdf` / `png`（`DESKTOP_ONLY_EXPORT_FORMATS`）。按钮**照旧渲染但置灰**，并说明"由桌面端提供" | 直接不渲染按钮：产品负责人就看不到桌面端的完整能力面，等于把 M7 的验收项藏起来 ⇒ E-42 |
| DR-21 | `content_generate` 产出的文稿一律 `status: 'pending_review'` + `compliance_checked: false`，界面显示「演示模式未执行合规扫描」。种子里那两份"已经生成过"的文稿是 `true`（它们代表真后端扫过之后的样子） | 新文稿直接写 `compliance_checked: true`：demo 没有合规扫描器，写 `true` 就是**假声明**，且违反 AGENTS 规则 6「生成内容默认 `PendingReview`」 ⇒ E-41 |
| DR-22 | 报告里**没有数据的节整节省略**，不渲染空标题 | 渲染空节：报告是要发给老板与客户的，一个空的「竞品对标」看起来像"这一项是 0"，比不出现更糟 ⇒ E-43 |
| DR-23 | 页面级测试走 **demo 假后端 + 真种子**（`vi.mock('../api/runtime', () => ({ runtime: 'demo' }))`），不逐页复刻 `mockInvoke` 桩 | 每页各写一套桩：既冗长，又会与页面实现漂移，且测的不再是产品负责人在 `mise run web` 里看到的那个数据面 |
| DR-24 | 本轮**不新增 CSS class**（`index.css` 的选择器集有常驻守卫），排版一律用 antd 既有组件 + 既有 class | 新加样式类：Tailwind oxide 扫不到 `.ts` 文件里的类名（`components/format.ts` 的头注释就是这个提醒），新增 class 面会带来"类名写了但没进产物"的静默缺陷 |

## 4. 架构与分层

沿用既有分层，本轮只在**前端**加叶子模块；crate 分层（AGENTS 规则 4）与 Rust 代码零改动。

```
apps/desktop/ui/src/
├── api/                      # IPC 边界：组件不直接 invoke（AGENTS 代码风格）
│   ├── client.ts             # ✏ IPC_COMMANDS 40 → 60 条
│   ├── constants.ts          # ✏ + REVIEW_CONFIDENCE_FLOOR = 0.75（Rust 侧尚不存在，见 E-45）
│   ├── completeness.ts       # ★ 枚举「值清单 ↔ 字面量联合」的编译期完整性网（从 types.ts 拆出的共享叶子）
│   ├── types.ts              # ✏ 汇总导出
│   ├── types-collection.ts   # ★ M3 DTO
│   ├── types-insight.ts      # ★ M4 DTO
│   ├── types-diagnosis.ts    # ★ M5 DTO
│   ├── types-action.ts       # ★ M6 DTO
│   ├── types-report.ts       # ★ M7 DTO（含 DESKTOP_ONLY_EXPORT_FORMATS）
│   ├── collection.ts insight.ts diagnosis.ts action.ts report.ts   # ★ 五个命令族
│   ├── report-compose.ts     # ★ 报告 → Markdown / HTML / CSV（语言随界面）
│   └── content-compose.ts    # ★ 文稿 → Markdown / HTML（CONTENT_EXPORTABLE_FORMATS）
├── components/               # ★ 16 个新组件 + format.ts（展示格式化单点）
├── pages/                    # ★ 5 个新页面（各带同名 .test.tsx）
├── i18n/locales/{zh-CN,en-US}/  # ★ 各 +5 个 bundle：collection/insight/diagnosis/action/report
│                              # ✏ common（单位词、新枚举标签）、fields（+13）、nav（+5）
└── demo/
    ├── backend.ts            # ✏ demoBackend 40 → 60 条（Record<IpcCommand, …> 全覆盖网）
    ├── db.ts                 # ✏ 内存库 +8 张"表"与取数helper
    ├── types.ts              # ✏ DemoDb / DemoHandler / demoError
    ├── handlers/{collection,insight,diagnosis,action,report}.ts   # ★ 20 条命令的内存实现
    └── seed/{collection-rounds,collection-records,collection-records-retest,insights,
              diagnosis,actions,contents,reports}.ts               # ★ 8 个新种子模块
```

★ = 新增（本轮 **58** 个新生产文件：api 13 / components 17 / handlers 5 / seed 8 / i18n 10 / pages 5；另有 **11** 个新测试文件）· ✏ = 修改（21 个文件，+1279 / −69）

**IPC 命令族（20 条）**

| 模块 | 命令 |
|---|---|
| M3 采集（6） | `collection_board` · `collection_round_get` · `collection_start` · `collection_task_retry` · `collection_record_list` · `collection_record_get` |
| M4 解析核查（4） | `insight_list` · `insight_correct` · `fact_check_list` · `fact_check_resolve` |
| M5 诊断归因（5） | `diagnosis_overview` · `diagnosis_competitors` · `diagnosis_funnel` · `diagnosis_engines` · `diagnosis_alert_acknowledge` |
| M6 行动中心（4） | `action_board` · `action_update_status` · `content_generate` · `content_update_status` |
| M7 报告分享（1） | `report_render` |

**首屏往返刻意合并**：`collection_board`（轮次列表 + 用量看板）与 `action_board`
（处方 + 归因卡片 + 内容模板 + 已生成文稿）各自把首屏要用的东西一次给全，
页面再按选中项发第二次往返取详情。理由是 demo 与真后端都要走 IPC，
把首屏拆成 4 个往返只会让"页面转圈"变成产品负责人对 demo 的第一印象。

## 5. 数据模型与种子数据

DTO 定义在 `api/types-*.ts`，本轮**先于后端**冻结，作为 Plan C 的输入。要点：

- ID 一律 `string`（真后端是 `uuid::Uuid` v4，序列化成字符串）；时间一律 RFC3339 `string`
  （对齐 AGENTS 代码风格：SQLite 存 RFC3339 文本）。
- 每个枚举都同时给出**字面量联合**与 `*_VALUES` 值清单，并用 `api/completeness.ts` 的
  `AssertComplete<ValuesAreComplete<…>>` 在**编译期**钉住"联合里没有被值清单收录的成员"。
- 领域算法的产物（`sample_size_grade`、`confidence`、`fact_accuracy`、五维得分、归因 delta）
  在 DTO 里就是**普通字段**，demo 只填静态值，不解释它们怎么算出来的。

**种子数据的自洽性是本轮的主要工程量**。`demo/seed.test.ts`（+444 行）把跨模块的数字对齐逐条钉死：

| 判据 | 内容 |
|---|---|
| 轮次 ↔ 题库 | 每轮的 `prompt_set_label` / `prompt_set_version` 与 `seed/prompt-sets.ts` 一致 |
| 题目数 × 引擎数 | 第 2/3 轮 `planned_queries: 434` == 62 题 × 7 引擎（DR-14 的对价） |
| 任务 ↔ 证据 | 每条 `succeeded` 任务都有 `record_id`，且能在证据表里找到；`failed` 任务没有 |
| 五维加权 == 总分 | 附录 C 的权重乘五维得分 == `total_score`（**只校验种子自洽，不在运行期算**） |
| 归因卡片 == 两轮 overview | `SEED_ATTRIBUTION_CARDS` 的 before/after 四个数逐一对齐基线轮与复测轮 |
| 报告数字 == 诊断数字 | `seed/reports.ts` 的 `ReportMetricBlock` 与 `seed/diagnosis.ts` 同源 |
| 核查汇总 4 轮齐备 | `SEED_FACT_CHECK_SUMMARIES` 覆盖全部 4 轮（含小样本的通道验证轮），`null` 那一支今天是防御性的 |
| 证据行 ↔ 解析结果投影 | `CollectionRecord.mentioned/rank/sentiment` 与 `AnswerInsight.self_*` 一致（运行期由 `insight_correct` 维持） |

**四轮采集的叙事线**（这是产品负责人走查时的主线，刻意编成"看得懂的一条故事"）：

| 轮次 | 状态 | 作用 |
|---|---|---|
| 第 1 轮 · 通道验证（小样本） | `partial` / 样本不足 | 演示「样本不足 ⇒ 不出精确分数」的降级形态；报告只剩结论一节 |
| 第 2 轮 · 基线体检 | `succeeded` | 主战场：434 次查询、复核队列、三类核查问题、告警 |
| 第 3 轮 · 行动后复测 | `succeeded` | 归因卡片的 after 侧；报告默认选中它 |
| 第 4 轮 · 周更采集 | `running` | 演示「进行中 ⇒ 诊断回 `null`、趋势图排除它、报告出不了」 |

归因主线：覆盖率 `0.42 → 0.55`、Top3 `0.21 → 0.34`（各 **+13 个百分点**）、
事实错误 `27 → 15`（**−12 条**）、负面提及 `0.19 → 0.12`。

## 6. 页面与信息架构

五个页面都挂在项目下的既有导航里（`nav.collection/insight/diagnosis/action/report`），
路由 `/projects/:id/{collection,insight,diagnosis,action,report}`（`App.tsx`）。
五页共享同一套页头形态：**标题 + 副标题 + 轮次选择器 + 口径说明 Alert**。

### 6.1 M3 多引擎采集 `/collection`
轮次概览（进度、成功率、耗时、token）→ 各引擎执行汇总 → 任务队列（失败条目显示原因、可单独重跑）
→ 原始证据表 → 证据抽屉（prompt 原文、完整回答、引用来源、时间戳、**截图那一格永远空状态**）。
「排一轮采集」弹窗（`StartRoundModal`）选题库 / 引擎范围 / 重复次数 / 轮次名。
🔴 三句口径说明常驻：样本子集、静态值、demo 只排队不执行。

### 6.2 M4 解析与核查 `/insight`
两个 tab：**解析结果**（提及 / 位次 / 情感 / 置信度 / 风险标记，可展开看回答形态、引用来源、
品牌提及明细）与**事实核查**（四格汇总 + 三类问题清单，每条可结办为「已更正 / 误报」，可下钻到证据抽屉）。
四个筛选器（引擎 / 复核状态 / 提及情况 / 风险标记）按 **AND** 组合。
「一键纠正」只放开三项（是否提及 / 推荐位次 / 情感倾向），弹窗里明说
**「不会重算任何比率」**；纠正后该条出复核队列并长出「已人工纠正: <字段>」标签，
**置信度一动不动**（那是模型的自评分）。
复核门槛 `REVIEW_CONFIDENCE_FLOOR = 0.75` 在界面上被显式解释。

### 6.3 M5 诊断与归因 `/diagnosis`
GEO 体检总分（旁挂样本量、重复采样区间、口径说明）→ 四个 KPI（覆盖率 / SOV / 事实准确率 / 被引域名数）
→ 五维得分表（权重按附录 C 展示，**不归一化**）→ 环比趋势折线（进行中那轮**排除**，并说明为什么）
→ 告警列表（可标记已读）→ 竞品对标矩阵 → 意图漏斗（认知 → 推荐 → 决策）→ 引擎差异表。
🔴 进行中那轮**整页是空状态**（`diagnosis.noData`），不是错误——采集没跑完就出结论是造假。

### 6.4 M6 行动中心 `/action`
Top 10 处方表（类别 / 处方 / 依据 / 预期收益 / 难度 / 建议负责人 / 影响的引擎与题目范围，状态可翻）
→ **闭环归因卡片**（做完这几项 → 覆盖率 +13pp、事实错误 −12 条，同一视图关联展示，§3.8 的验收项）
→ 内容生产面板（6 个模板，一键生成 → `pending_review` → 可导出 Markdown / HTML）。
🔴 处方**不重排、不新增**；归因数字是静态的，翻处方状态不会让它变化。

### 6.5 M7 报告与分享 `/report`
轮次选择器（**出不了报告的轮次置灰并说明原因**）→ 三版切换（老板版 / 执行版 / 客户白标版，
`Radio.Button`）→「附证据附录」开关 → 白标档案（机构名 / 联系方式 / Logo URL）→ 预览 →
导出条（Markdown / HTML / CSV 可用，docx / pdf / png 置灰说明"桌面端提供"）。
🔴 **免责声明每一版都在**（`report.disclaimer`），口径说明页固定写明样本量分级、采集时间、
引擎列表、题库与版本、指标口径版本（§3.9 的"建立行业信任的关键设计"）。

## 7. i18n 与错误契约

- 新增 5 组 bundle × 2 语言（`collection` / `insight` / `diagnosis` / `action` / `report`），
  zh 与 en **键集完全相同**（`dictionary.test.ts` 的既有 parity 守卫覆盖）。
- `common` 新增**单位词**（`units.percentagePoints` / `seconds` / `tokens` / `items` / `prompts`）
  与 M3–M7 的枚举标签命名空间；`fields` 新增 13 个字段名（DR-15）；`nav` 新增 5 项。
- **插值变量一律不叫 `count`**（i18next 会走复数分支找 `_one` / `_other`，本词典没有）——
  这条既有纪律在 `format.ts` 的头注释里再钉了一次，因为单位词插值是本轮新增的高频形态。
- 错误契约不变：假后端只回 `code` + 语言中立 `params`，文案由 `describeIpcError` 按当前语言渲染。
- 可访问名：本轮给轮次选择器与四个筛选器补了 `aria-label`（`insight.roundAria`、
  `insight.filters.{engine,review,mentioned,risk}Aria`）。理由是**占位文案在选中之后就消失**，
  用占位定位既不稳定也与读屏用户看到的不一致。

## 8. 合规红线（AGENTS 规则 6 / 产品定义 §3.8）

| 层 | 落地方式 |
|---|---|
| 文案 | 禁词守卫常驻（zh：保证/霸屏/第一/最好/最强/最优/最先进/国家级/世界级/独家；en：`guaranteed` / `#1` / `\bbest\b` / `100%` / `number one`）。M5/M6/M7 的文案只谈**可见度、覆盖率、提及份额**，不谈排名承诺 |
| 状态机 | 生成的文稿一律 `pending_review`；`compliance_checked` 在 demo 里对**新产物**恒为 `false`（DR-21） |
| 报告 | 免责声明三版都带；样本不足时**只提供方向性参考、不提供精确分数**（降级告警常驻） |
| 数字 | 静态值的地方界面上明说，不伪装成计算结果（G5） |

## 9. 测试策略与常驻守卫

**分层**（与 TDD 纪律一致：先写失败测试再写实现）

1. **handler 层**（`demo/handlers/*.test.ts`，5 个新文件 / 96 条）：契约行为——错误码与 `params`、
   枚举收敛、写路径改了哪几个字段、**刻意不做什么**（不重算、不联动）。
2. **页面层**（`pages/*.test.tsx`，5 个新文件 / 45 条）：界面形态——走 demo 假后端 + 真种子（DR-23），
   钉「口径说明在不在」「按钮点了之后界面变成什么样」「静态值一动不动」。
3. **种子层**（`demo/seed.test.ts`）：跨模块数字自洽（§5 那张表）。
4. **i18n 层**：词典 parity、非注释零 CJK、禁词、枚举标签前缀。

**本轮新增/加强的常驻守卫**

| 守卫 | 判据 | 抓过什么 |
|---|---|---|
| `i18n/enum-label-prefixes.test.ts`（★ 新） | 扫全部源码里的 `enumLabel(t, '<prefix>', …)` 调用，把 39 个前缀**逐个钉死**，并断言每个前缀在 **zh 与 en 两侧**都能解析出一张非空字符串表 | 上线前抓到 `ContentPanel.tsx` 把 `action.contentStatuses` 写成了 `entity.contentStatuses`（界面上会露出裸枚举值） |
| `pages/en-us-page-residual.test.tsx`（✏ 5 → **10** 个页面） | `整页文本节点 − 演示种子数据 = 无 CJK`。数据清单从 `demo/seed/**` 全部 **14** 个模块**现算**（228 → **454** 条），≤4 字的短尾**逐字钉死**（81 → **83** 条，新进的 `关于澜舟`/`销售运营` 已逐条判定为数据），总清单上界 260 → **520** | 见该文件 docblock 的 M-1 分析：短尾放行面变宽必须过审，不许静默 |
| `i18n/no-hardcoded-strings.test.ts`（✏） | 非注释 CJK 零残留的扫描面扩到本轮全部新文件（`.test.` 文件豁免） | — |
| `demo/backend.test.ts`（✏） | `demoBackend` 的键集与 `IPC_COMMANDS` **集合相等**（60 条） | — |

**门禁抓到的一处偶发红（已修，记在这里防复活）**：`action_update_status` 原先对同一次写操作
调了**两次** `nowIso()`（`completed_at` 一次、`updated_at` 一次），跨毫秒时两者差 1ms ⇒
`handlers/action.test.ts` 的「翻成 done ⇒ 盖 `completed_at` 并刷新 `updated_at`」**偶发**红。
修法是取一个 `stamp` 复用（与 `handlers/project.ts`、`handlers/entity-card.ts` 的既有口径一致）。
🔴 这类缺陷只能由「同一次写操作 = 同一个时间戳」这条不变量兜住，**不要**把断言放宽成
`toBeCloseTo` 或只比到秒——那等于把不变量删了。

**已知的 antd 测试摩擦**（都已在测试里就地写明理由，避免下一个人重踩）：
两个汉字的按钮会渲染出中间空格（`/确\s*认/`）；图标按钮的可访问名含图标标签（用正则）；
`Radio.Button` 的真 `<input>` 是 `pointer-events: none`（用 `fireEvent.click`）；
Select 的回显是 `label · statusLabel`（用 RegExp 匹配器）；
页面有**两次往返**（board 然后 detail），要等详情区独有的元素再断言；
`'2'` / `'84%'` 这类数字在页面上到处都有（用 `.ant-statistic` 收窄）；
不受控的 `Form.Item`（没有 `name`）挂不上 `for` ⇒ `getByLabelText` 失效（按 `.ant-form-item` + `querySelector('input')` 定位）。

## 10. 与真后端的差异

本轮新增 **13 条**，登记在 `2026-09-23-demo-vs-backend-known-divergences.md` **§4b（E-33 … E-45）**：
20 条命令 demo 独有（Rust 侧零对应）、`collection_start` 只排队、`planned_queries` 不乘重复次数、
重跑不重算聚合、无截图、用量看板静态、M5 全静态且告警真值在库里、纠正与结办不重算、
两个 delta 口径、文稿不调模型且 `compliance_checked: false`、docx/pdf/png 置灰、
报告空节省略、13 个 `field` 值 + 5 个 aria 键只在前端词典、`REVIEW_CONFIDENCE_FLOOR` 无 Rust 对应。

每一条都按该文件 §1 的判据归过类：**全部属于「demo 不许实现算法」或「镜像成本 > 漂移风险」**，
没有一条是缺陷。

## 11. 开放问题的裁定结果（2026-09-29 产品负责人回复）

本节原先是 5 条待裁问题，现已全部有回复。裁定的**执行状态**逐条标注，未执行的不要当成已完成。

1. **文稿导出的 CSV 置灰理由说错了**（E-42②：文稿这里 CSV 置灰且写着「由桌面端提供」，
   而报告那边 CSV 明明能导出）⇒ **裁定：不改**。理由是「这个 web 页面只是个 demo」。
   👉 已按台账 §1 的先例（E-17）把 E-42② 标成「已裁定 · 留此仅作台账」，防止下一个人重新发现一遍。
   注意这条裁定**只**覆盖置灰理由的文案矛盾，不覆盖「文稿到底该不该有 CSV」这个能力问题——
   Plan C 落桌面端时若要给文稿加 CSV，仍需重新裁。
2. **`REVIEW_CONFIDENCE_FLOOR = 0.75`**（E-45：Rust 侧不存在这个常量）⇒ **裁定：demo 验收确定后需要同步 Rust 侧**。
   👉 列为 Plan C 的**必做项**（§13-6 已更新）：把门槛值收进 `crates/geo-domain` 的 `pub const`，
   前端改用 `src/test/truth-source.ts` 那套「解析真值源」手法读它，**不再手抄字面量**。
   🔴 同步之前，`demo/seed/insights.ts` 的 `needs_review` 静态值与这个常量必须继续手工保持一致
   （判据在 `demo/seed.test.ts`），否则界面会说出「低于 0.75 进复核队列」而队列里有 0.80 的条目。
3. **`AlertItem.delta`（原始单位）与 `ReportMetricBlock.delta`（百分点）两个口径**（E-40）⇒ **裁定：需要统一**。
   👉 **方向已确认：统一到百分点**（Plan B Task 8，2026-09-30 执行完毕），五步全部落地：
   ① DTO 注释：`api/types-diagnosis.ts` 的 `AlertItem.delta` 与 `api/types-report.ts` 的
   `ReportMetricBlock.delta` 互相指认，都写明"比率类装百分点、条数类装条数"；
   ② 种子：`SEED_ALERTS` 的三条比率类 delta 由 `0.19 / -0.14 / -0.03` 改成 `19 / -14 / -3`
   （`fact_error_count` 的 `9` 是条数，不动）；
   ③ `components/format.ts`：`alertDeltaText` **连同那支 `* 100` 一起删除**，格式化只剩
   `metricDeltaText` 一个函数；新增 `alertMetricUnit(metric)` 只回答"这个指标是哪种单位"、不做算术；
   ④ 判据：`format.test.ts` 断言 `alertDeltaText` 不再被导出（留着旧函数就等于口径没统一），
   `demo/seed.test.ts` 断言告警 delta 是整数且与 `detail` 里点名的「N 个百分点」逐条对得上；
   ⑤ 台账：E-40 已标「已对齐 · 留此仅作台账」。
   🔴 **界面上显示的数字一个都没变**（`-0.14 × 100` 与 `-14` 渲染出同一句「-14 个百分点」），
   变的是**契约与种子**：后端落地 `AlertItem` 时必须直接发百分点，不许再发 0~1 的比率。
4. **进行中那轮（第 4 轮）诊断页是一整页空状态** ⇒ **裁定：确认符合预期**（「采集没跑完就不出结论」）。
   👉 无动作。`diagnosis.noData` 的文案与形态就此定稿。
5. **13 个新 `field` 值 + 5 个 aria 键只活在前端词典**（E-44）⇒ **裁定：后端沿用**
   `validation/failed` + `reason: 'invalid_id'` + `field` 这条路，**不**给每类实体新发 `*_not_found`。
   🔴 附加要求（产品负责人原话）：「后期生成本地应用时候需要能够兼容中英文」。
   这条今天**已经成立**并且有常驻守卫看着：后端只回稳定错误码 + 语言中立 `params`（AGENTS 规则 7），
   文案由前端 `describeIpcError` 按当前语言渲染，13 个 `field` 值在 zh-CN 与 en-US 两侧**逐字对齐**
   （`i18n/dictionary.test.ts` 的 parity 守卫 + `pages/en-us-page-residual.test.tsx` 的整页无残留守卫）。
   👉 Plan C 落地时的义务是：**不许把中文字段名写进 Rust**（那是 §5-2「后端产出自然语言进契约」的重犯），
   只回 `field: "round_id"` 这种稳定记号。

## 12. 交回产品负责人的手动验收

`mise run web` 打开后请逐项走查（沿用差异清单 §8 的口径：控制器不代跑真人验收）：

1. **闭环主线**：项目「澜舟除尘」→ 采集页看第 2 轮 → 点开一条证据看抽屉 → 解析页看复核队列
   → 一键纠正一条（确认「已人工纠正」标签长出来、**置信度没变**）→ 事实核查 tab 结办一条
   （确认弹窗并排给出「回答里的说法 vs 实体卡口径」、**准确率没变**）。
2. **排队与重跑**：采集页「排一轮采集」→ 确认新轮次是「已排队」且**不会自己跑完**；
   第 2 轮里点一条失败任务的「重跑」→ 确认证据出现、但**轮次的成功率与 token 没变**。
3. **诊断**：默认停在第 4 轮（进行中）⇒ 整页空状态；切到第 3 轮 ⇒ 总分、五维、趋势、告警、
   竞品矩阵、意图漏斗、引擎差异全部出现；标记一条告警已读后刷新页面，确认**已读状态留着**。
4. **行动**：翻一条处方状态 → 确认**归因卡片的四个数字一动不动**；用模板生成一份文稿 →
   确认状态是「待人工审核」且写着「演示模式未执行合规扫描」→ 导出 Markdown 与 HTML 各开一次。
5. **报告**：三版各生成一次，确认老板版只有结论（+ 证据附录）、执行版全给、白标版没有漏斗与核查明细；
   确认**免责声明三版都在**；切到第 1 轮（小样本）确认降级告警出现且只剩结论；
   导出 Markdown / HTML / CSV 各开一次，确认**导出文件随界面语言走**（切 English 后再导一次）。
6. **双语**：全站切 English ⇒ **零中文残留**（本轮已把它做成 10 个页面的常驻守卫，
   但真人走查仍要看 antd 内置组件、空状态、错误弹窗、置灰按钮的 tooltip）；切回中文 ⇒ 无键名裸露。
7. **合规**：全站搜一遍「保证 / 霸屏 / 第一 / 最好」与 `guaranteed` / `#1` / `best` / `100%`，
   应当**零命中**（守卫已钉，这里是复核）。

## 13. 落地到桌面端与 Rust 的下一步（Plan C 的输入）

按 DR-10，**产品负责人回"定稿"之前不开工**。定稿后的建议顺序：

1. `crates/geo-domain`：把 `api/types-*.ts` 的 DTO 翻成 Rust 类型（`serde` + `Uuid` + `DateTime<Utc>`），
   枚举用 `strum` 或手写 `const` 值清单，**保持与前端 `*_VALUES` 逐字相同**。
2. `crates/geo-store`：M3–M7 的表与迁移（`sqlx::migrate!`）。轮次 / 任务 / 证据 / 解析结果 /
   核查问题 / 诊断快照 / 告警 / 处方 / 文稿 / 报告。
3. `crates/geo-crawler` + `geo-llm`：真采集与真抽取（本轮刻意不做的部分）。
4. `apps/desktop/src-tauri/src/ipc/`：20 条 `#[tauri::command]`；错误一律回 `code` + `params`
   （DR-15 的 13 个 `field` 值在这里定稿）。
5. 补齐 `IPC_COMMANDS` ↔ `ipc::handler()` 的**集合相等**断言（差异清单 §5-11 早就点过名：
   用 `include_str!("../../../ui/src/api/client.ts")` 正则抽清单，与注册表比对）。
6. 🔴 **裁定 2 的必做项**：把 `REVIEW_CONFIDENCE_FLOOR`、附录 C 的五维权重、样本量分级阈值收进
   `crates/geo-domain` 的 `pub const`，前端改用 `src/test/truth-source.ts` 那套「解析真值源」手法，
   **不再手抄字面量**（`REVIEW_CONFIDENCE_FLOOR` 今天是前端独有的展示口径，见 §11-2 / E-45）。
