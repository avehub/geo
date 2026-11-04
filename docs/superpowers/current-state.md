# 当前状态与里程碑回填

> **状态快照**：2026-10-29。本文是当前状态与执行回填，**不是需求真值源**；冲突时以产品定义、对应 spec、差异台账为准。
>
> **何时读**：改 demo、命令面、站长数据、项目概览、文章管理、站点接入前。
>
> **更新纪律**：命令增删时同步本文「当前命令面」表与差异台账；不要把未发生或无法验证的状态写进来。

## 1. 当前命令面（2026-11-03 核对）

| 项 | 数量 | 真值源 |
|---|---:|---|
| `IPC_COMMANDS` | 105 | `apps/desktop/ui/src/api/client.ts` |
| `demoBackend` 键 | 105 | `apps/desktop/ui/src/demo/backend.ts` |
| Rust `generate_handler![]` | 55 | `apps/desktop/src-tauri/src/ipc/mod.rs` |
| demo-only | 50 | `contracts/ipc-command-surface.json` 的 `pending` |

**105 = 55 条 Rust + 50 条 demo-only。** `demoBackend` 必须 105 条全覆盖（漏一条 `tsc -b` 就红）；桌面端点进 demo-only 命令报 `ipc/unknown_command`，按规则 8 **不屏蔽**。

### demo-only 族

| 轮次 | 命令族 | 条数 | 差异 |
|---|---|---:|---|
| M3–M7 | 采集 / 解析 / 诊断 / 行动 / 报告 | 20 | §4b E-33 |
| Plan B | `app_environment` / `llm_models_list` | 2 | §4c E-46…E-51 |
| M1.5 | `keyword_*` / `faq_*` | 10 | §4d E-52…E-54 |
| M6.5 | `site_*` | 11 | §4e E-55…E-57 |
| M1.2b | `kb_*` | 6 | §4g E-58…E-66 |
| M6 | `article_*` | 10 | §4g E-63…E-66 |
| M5.5 | `search_*` | 6 | §4h E-67…E-72 |

## 2. 当前 demo 边界

- **领域算法**：去重率、字段完整率、样本量分级、机会判定等只在 Rust 纯函数里真算；demo 只呈现预置值或静态清单（规则 9）。
- **站点接入**：demo 不真的改线上站点；`publish` / `unpublish` / `rollback` 只翻状态 + 记事件 + 生成交接文件；`site.demoBody` / `site.staticNote` 常驻。
- **文章管理**：demo 没有真定时任务；`next_run_at` 只是按频率 + 时间算出的显示值，到点不跑；“立即运行”从预置文章池取，刷新即重置；生成物一律 `pending_review` 且不做合规扫描。
- **站长数据**：demo 的 OAuth 一条都没实现；只走导入 / 填报 / 汇总 / 筛选 / 机会处置。归一 / 求和 / 重算 / 筛选 / 区间收敛在前端 `api/search-compose.ts` 真做；机会清单是静态 6 条。
- **项目概览**：M9 组合只有数据层、没有页面；`summarizePortfolio` 只给计数 + 每个指标的 min/median/max 分布 + 逐项目行。

## 3. 里程碑回填

### M3–M7 demo 闭环（采集 → 解析 → 诊断 → 行动 → 报告）

- 规格：`docs/superpowers/specs/2026-09-28-demo-m3-m7-closed-loop-design.md`。
- 该轮 20 条命令**只有 demo 侧实现**；桌面端点进去报 `ipc/unknown_command`，理由与代价见差异台账 §4b E-33。
- 当时 Rust 侧一条未加；demo 是唯一可走查路径。

### Plan B（导航 / 设置 / 新建项目）

- 规格：`docs/superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md`；执行回填在该文 §13。
- 设置页是 `/settings/:section` **五段**；新建项目是「填网址自动采集 / 手动录入」**两个入口**。
- 该轮新增 `llm_models_list` / `app_environment` 两条命令，**只有 demo 侧实现**；连同 M3–M7 那 20 条当时共 22 条，差异见 §4c E-46…E-51。
- 完整页面/文案/导航回填、设置五段细节与新建项目两入口的走查清单，以规格为准。

### M1.5 素材层（关键词库 / FAQ 常见问题库）

- 规格：`docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`（DR-37…DR-44；落地回填在 §12）。
- 两个二级项插在**品牌实体卡下面**；内容支持手动录入 + AI 生成，可导出 CSV / FAQPage JSON-LD。
- 也可**引用进 Prompt 题库**：引用复用既有 `prompt_item_add`，导出复用既有 `export_write_file`，这两条是**真的写路径**，没有新增命令。
- 该轮新增 `keyword_*` / `faq_*` 共 10 条，**只有 demo 侧实现**；连同 M3–M7 20 条、Plan B 2 条当时共 32 条，差异见 §4d E-52…E-54。

### M6.5 站点接入与补丁工作台

- 规格：`docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`。
- 先读该文 §2 的全球市场调研与 §3 的裁定：覆盖层 / CMS 连接器 / 仓库代理 / 落地包交接四条路径各自的代价都在里面。
- 二级项「站点接入」排在**行动中心之后、报告之前**。
- 演示模式**不会**真的改到线上站点：`publish` / `unpublish` / `rollback` 只翻状态 + 记事件 + 生成可下载的交接文件，所以 `site.demoBody` 与 `site.staticNote` 两句必须常驻（规则 6 / 规则 9）。
- 该轮新增 `site_*` 共 11 条，**只有 demo 侧实现**；连同前面几轮当时共 43 条，差异见 §4e E-55…E-57。
- E-56 记的是凭据面：真后端的 `secret_set` 只认 `provider`、`parse_secret_ref` 只吃两段，站点通道那个三段引用串在 Rust 侧还没有落点。

### M1.2b 知识库重构 + M6 文章管理 Article Studio

- 规格：`docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`；市场调研见 `docs/superpowers/specs/2026-10-10-kb-and-article-studio-ux-survey.md`。
- 知识库页**去掉与实体卡重复的内容模块卡片**；其余卡片按成熟知识库的体系与交互重做：销售/客服话术带场景、素材走画廊格、编辑改侧滑、分组卡片 ⇄ 密集表格双视图。
- 项目下新增「文章管理」二级菜单：方向 → 提示词模板 → 排期 → 评审。
- **同步块整体退役**：上一轮「基于实体卡信息变动而自动更新」的要求被该轮用户指示取代（重复卡片正是投影来的）；替代品是「从实体卡导入」的**一次性复制**、不跟随源头。差异台账 E-61 因此整条作废（原文保留，§4g 抬头声明）。
- 该轮命令面**第一次有增有减**：`kb_entry_detach` 删除 + `article_*` 新增 10 条 ⇒ `IPC_COMMANDS` 99；**这 10 条同样只有 demo 侧实现**；连同前面几轮当时共 59 条 demo 独有命令，见 §4g E-63…E-66。
- demo **没有真定时任务**：`next_run_at` 只是按频率 + 时间算出来的显示值、到点不自动跑；“立即运行”从预置文章池取，刷新即重置（E-65）；生成物一律 `pending_review` 且不做合规扫描（E-66）。
- **知识库条目修订留痕**（产品负责人 2026-10-13，DR-119，设计在 M5.5 规格里）：`KbEntryRevision` 与实体卡 `EntityCardRevision` **六键同构**；`RevisionTimeline` **泛化**（props 加 `labelKeyOf`）不新造组件；`kb_entry_update` 逐字段留痕、`body_markdown` 新旧值截断 120 字、verify 记一条；add / delete / generate **不留痕**；读出口寄生 `kb_board` 的 `revisions`，**命令面不加**。

### M5.5 站长数据接入与优化机会自动分析

**范围与落地**
- 规格：`docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`。
- 范围：把 GSC / Bing 站长 / 百度搜索资源平台《AI 流量分析》/ 百度统计 / 头条搜索的**曝光、点击、AI 引用**接进来，**跨平台归一汇总**后与自有抽样对照，并按 6 条规则自动开出优化机会。
- demo 侧已落地（2026-10-13）：`IPC_COMMANDS` 99 → **105**、「demo 独有命令」这一族 59 → **65**。
- 新增 6 条：`search_board` / `search_source_upsert` / `search_source_remove` / `search_source_test` / `search_metric_import_csv` / `search_opportunity_update`；实现在 `demo/handlers/search.ts` + `search-import.ts`（拆两个文件守 400 行）。
- Rust 侧**一条未加**（`generate_handler![]` 仍 **40** 条）⇒ 桌面端点进这一页报 `ipc/unknown_command`，**不屏蔽**（规则 8）。差异台账 §4h E-67…E-72（E-72 = xlsx 的 TS `fflate` / Rust `calamine` 双解析器）。
- 调研结论：“**最该接的那批源全都没有 API**”（百度《AI 流量分析》灰度且无字段文档、GSC 生成式 AI 报告只有曝光且 UI-only、Bing AI Performance 同样无 API、头条 / 搜狗 / 360 只有推送 API），所以裁定 **导入 / 填报先行、OAuth 三家全做但排在后面**（DR-90 / DR-93）。

**归一、机会与分布**
- **归一 / 求和 / 重算 / 筛选 / 区间收敛在前端 `api/search-compose.ts` 真做**（DR-99，demo 与桌面端将来共用同一份纯函数）。
- **机会清单是静态 6 条**（DR-100 的判定是 `geo-domain` 纯函数，demo 不算，规则 9）⇒ 这一页“**汇总数字真变、机会清单不变**”的不对称是刻意的，`staticNote` 必须常驻说明。
- 接入建议（DR-111）的分布数字走 `search_board` 的 `traffic_split`（demo 是只读种子表，真后端由 `analytics` 组的**来源分析**算出）；**没有分布就显示空态，绝不端一份内置的市场份额推荐**。
- **四条会被反复踩的口径**（产品负责人 2026-10-12 裁定后的版本）：
  1. 二级项叫**「站长数据」**（en `Webmaster Data`），排在**解析与核查之后、诊断与归因之前**（DR-91）。
  2. **分层归一**（DR-95，反转了 10-11 草案那条“不做跨源归一”）：A 类可加（曝光 / 点击 / AI 引用，跨平台是**不相交事件集合**所以能求和）；B 类**只能重算不能平均**（百度 AI 点击率的分母是**引用量**、搜狗是**查询量**、GSC 是 impressions，三个不同分母的比率取平均没有任何解释）；C 类平台独有单独展示并**标注平台**（Bing `Grounding Queries` / 百度引用页面量 / 百度统计会话数）。
  3. **百度统计是「站内分析」补充组、不是站长平台**，它的会话数**永不进曝光合计**（DR-92 / DR-110）。
  4. 合计行**必须**同时给出汇总区间（自动收敛到各源 `data_through` 交集，DR-109）、参与源清单、完整性旗标（GSC 超 5 万行/天会**静默采样**，DR-110）——**给数字同时给得出账**。

**凭据与二期**
- 凭据是**账号级**两段引用串 `keyring://search/<kind>`，项目级只存非敏感的站点绑定——这恰好给差异台账 E-56 那个三段串指出了正解（DR-96 / E-69）。
- **搜狗 / 360 是二期**（`phase: 2`）：枚举、词典、目录表该轮就建齐（DR-108 要求“加源只加数据、不改页面”），但界面不渲染、种子不给数据。

**禁止模拟登录与导入形态**
- **不做模拟登录**（产品负责人 2026-10-12 追问“能不能让用户预配账号密码、由我们模拟登录抓后台”，四条路径逐一核过、每条都有出处，见规格 §3.4c）。
- 官方 API **不存在**：百度只开放收录推送。
- 模拟登录**不可承受**：百度用户协议禁出借账号密码且账号所有权归百度；**三重授权原则**缺“平台授权”；新浪微博诉脉脉案北知院终审判赔 200 万 + 20.9 万；反法 2025 修订**第十三条第三款“数据专款”**已有首例判决；北京互联网法院 2026-06 判赔 23 万余元，点名的正是“登录验证措施、访问权限管理措施、可追踪加密参数”；风控会打到**客户账号**上，而百度账号是全身份凭据。
- 本机只读屏被产品定义 §3.12 ❌浏览器插件挡着（列三期）。
- 正解是**粘贴解析 `paste_parse`**（DR-113，升为**一等接入形态**、界面上是**主按钮**，CSV 导入降为次按钮）：取数发生在**客户自己的浏览器**里，我们不持有凭据、不向平台发请求、不绕过任何技术措施。
- 这条已提为**硬性规则 11**（DR-114：任何“替客户登录第三方平台”的需求一律走官方 OAuth，没有 OAuth 的就走 `paste_parse` / `file_import` / `manual_entry`）。

**百度导出、三层数据流与观察清单**
- **百度《AI 流量分析》的导出已实测确认**（2026-10-12，产品负责人本机 Chrome 登录）：页面三段（AI 引用概览 / AI 引用趋势 / AI 引用热门关键词）中**只有「AI 引用热门关键词」带下载按钮**，格式 **xlsx**、表头五列原文 `关键词|AI引用量|AI曝光量|AI点击量|AI点击率`、**无日期列**（区间靠导入时确认）、空站点导出仅表头；样本录在 `fixtures/search/`（规则 2 的录制纪律）。
- demo 的 `file_import` 这一 ingest mode **必须吃 xlsx**（DR-98，`fflate` + 最小 reader；真后端 `calamine`，E-72）；概览 / 趋势 / 热门页面表**不作“有导出”的承诺**。落地命令是 `search_metric_import_csv`（文件与粘贴文本共用同一条命令）。
- **三层数据流**（产品负责人 2026-10-12 第三轮“要全自动化”后的重定位，DR-90 / DR-116）：主喂料永远自动 = **L1 自有抽样**（M3 `geo-crawler` 按关键词库问各家 AI 引擎、记引用，我们的“AhrefsBot 腿”）+ **L2 官方 API**（百度统计 / GSC / Bing 三家 OAuth）；控制台导出 / 粘贴 / 填报是 **L3 对账层**（用平台第一方数字校准 L1 偏差，冲突以 L3 为准并记差异事件），**不是主喂料**。
- 侦查结论：Semrush / Ahrefs 的自动化 = **自建索引 + 官方 OAuth** 两条腿，**不登录客户后台**；百度控制台第一方数据**全球无厂商能自动拿到** ⇒ “参考 semrush”推不出模拟登录（§3.6 / §10.5）。
- DR-117 把“等平台开 API”变成带触发条件的观察清单（季度复查；五项观察全无变化时保持沉默，有变化才列证据与应做动作；不自行改规格/代码、不登录平台后台）；用户在场 RPA 留**四条开口门禁**（法务书面意见 / 产品定义 §3.12 修订 / 客户书面接受账号风险 / 该源无 API 且影响成单），未满足前排期 = 给销售兑现不了的承诺。
- 定时复查属于**外部运行环境能力，不是仓库状态**：若需要，另行创建自动化；不能假定某个线程上的 `dr-117-api` 仍然存在，也不把“已挂”写进仓库事实。

**自建索引与外部数据**
- **站点自建索引 = 关键性采样**（产品负责人第四轮裁定，DR-118）：只存对本站点观测到的快照（关键题 × 引擎引用快照 / 页面可索引性快照 / SERP **位次带**快照——只记带不记精确名次），留存 400 天；**不建全网索引、不估曝光、不做点击流**（自有索引没有点击，界面上不许与 CTR 混成一条曲线）；命令面不加（寄生 `collection_*` 写路径 + `search_board` 的 `self_index_summary` 读出口）。
- **凡引用外部数据一律标出处**（DR-115）：CTR 基准改用**站点自身同位次分位数**（`MIN_QUERY_SAMPLE = 30`，复用既有 `MINIMUM_SAMPLE_SIZE`，样本不足时规则 1 **不出机会**）。
- 外部曲线（SISTRIX / Backlinko / Semrush / AWR）第一位 CTR 差近一倍（22.4% / 28.5% / 31.73% / 45.35%）且**全是英文 SERP**，只作**冷启动参考带**、以带 `source` / `url` / `as_of` 的数据文件存在（`api/search-benchmark.ts`，**不写进 `api/constants.ts`**）、界面标机构名 + 年份 + 链接、且**默认不参与判定**。

### 项目概览首页

- 规格：`docs/superpowers/specs/2026-10-29-project-overview-home-design.md`；路径 `/projects/:id/overview`，项目下第一项。
- **结果区按轮次锚定**：只取 `succeeded` / `partial`，默认最近一轮**有结论**的，不是“最新一轮”；环比只与上一有结论轮次比，`metric_spec_version` 变了就不给环比。
- **待办区按项目累计**：告警 / 事实核查 / 低置信度复核跨轮；进行中轮次的问题不进队列。
- **命令面零新增**（`IPC_COMMANDS` 保持 105）：选轮 / 环比 / 风险排序 / 组合分布都在 `api/overview-compose.ts`（单项目）/ `api/portfolio-compose.ts`（M9）纯函数层；轮次清单取不到时不整页红屏，逐卡显示错误码（规则 8）。
- **M9 组合口径已先定**：`summarizePortfolio` 只给计数 + 每个指标的 min/median/max 分布 + 逐项目行；**不对比率取平均、不求和、不做跨项目环比**（分母不同），默认排除归档项目。组合页已落 demo（`/portfolio`，左侧栏「项目 → 组合总览」）；项目页与组合页共用 `ProjectOverviewSnapshot`。差异台账 **E-73**（真后端需一个 `portfolio_overview` 聚合接口）。

### 2026-10-30 视觉重做 · 壳层与设计样张（第 0 轮）

- 规格：`docs/superpowers/specs/2026-10-30-visual-refresh-and-nav-grouping.md`。
- 导航合并为**双模式 + 四阶段分组**（项目外：清单；项目内：概览 + 准备 / 监测 / 诊断与行动 / 交付）；
  路由与路径段未改，选中态仍由 `pathname` 推导，侧栏**零新增取数**。
- 标题栏 64 → 48px；demo 横幅换成 **32px 细条**（`role="note"`，不可关闭，合规句不变）。
- 主色按飞书参照改为 `#3370FF`，tokens 集中在 `theme/tokens.ts`；数字等宽只走 `components/ui/MetricText`。
- 三稿按飞书参照收敛：**表格行 48**、菜单项 40、控件 40；状态为浅底标签（22px 高）；
  结论条改为白底 + 左竖线；demo 细条改灰底 + `DEMO` 徽标。
- 四稿修复项目名列被压到 30px 的事故：侧栏 240、项目表单行主单元格（名字 + 弱文本 meta）、
  行内动作收进「更多」；1024 下项目名 294px、1280 下 550px。
- 2026-10-31 第一批全面推进：19 个页面/分段页头统一 `PageHeader`；知识/关键词/FAQ/文章外层换
  `SectionCard`；解析页表格加 `scroll.x` 修掉 1024 溢出。
- 知识库：默认视图改为**表格**（分组可切），`tableLayout=fixed` 修掉 113px/行的事故；
  1280 下页面高度 5737 → 1778。采集页新增「引擎 × 意图」计数矩阵（只计数、不评分）。
- 新增 dev-only 设计样张 `/__design`（`import.meta.env.DEV` 门禁、零 IPC、不进侧栏）；
  生产构建 `__design` 字符串零残留。
- **未做**：页面内容级重排（知识库筛选轨 / 采集引擎矩阵 / 诊断与行动内容区）仍未做；
  命令面仍 **105**（40 Rust + 65 demo-only），无新增命令、无差异台账条目。

### 2026-11-03 demo 全面功能梳理 · P1/P2 修复

- 范围：全 demo 走查后先修 **12 项 P1**（项目删除全表级联、设置自动保存归属 / 离开 flush / 并发版本、汇总区间交集与关键词覆盖区间、AI 全站曝光量、仅表头导入不覆盖旧值、人工纠错矛盾状态、实体卡空态 CTA、切题库 / 导入清空选择、排期时区、`patches.json` 发布快照与审核闸门、设置缺字段与错误态），再并行修 **31 项 P2**（站长数据 / 关键词 / 监测 UI、报告 / 导出契约、站点接入 / 行动中心、题库 / 素材 / 设置错误态）。
- **命令面零新增、零删除**（仍 **105 = 40 Rust + 65 demo-only**）；Rust 侧一行未改；无迁移。
- 关键口径：
  - `api/search-compose.ts` 的 `resolveAggregateWindow` 取各源 `[period_start, data_through]` 的**交集**，无交集不给合计；关键词行改用多周期**覆盖**区间，不再倒挂。
  - `SearchQueryMetric.impressions / clicks / ctr` 保持可空：关键词只有 AI 面数据时显示 `—`，不再用 0 冒充“没有这一列”。
  - `project_export` 只覆盖 **M1/M2 档案**（Rust DTO `deny_unknown_fields`），UI 文案改为「项目 JSON（M1/M2 档案）」；差异台账 **E-74**。
  - `patches.json` 只收 `status === 'published' && review_status === 'approved'`，且 kind / target / channel / body 全部取**发布快照**；已发布补丁必须先 `unpublish` 才能删除。
  - 排期 `next_run_at` 按**本机时区**生成；⚠ 种子里的静态 `next_run_at` 仍是中国时区口径，非中国时区演示时可能偏移，真后端需要显式的 timezone 字段。导入 / 粘贴默认区间从 `search_board.as_of` 推导，不用系统日期。
  - 报告预览与 MD / HTML / CSV 导出的采集时间、引擎名、口径说明、白标 Logo **同源**；HTML `lang` 随当前界面语言。
  - Prompt 校验镜像 Rust（≤300 字 / weight 1–5 / repeat_count 1–3）；关键词 CSV 固定 **8 列**（不含 `source`）。
- 已知边界（**demo 阶段刻意不修**）：
  - 组合总览：demo 里「有结论轮次但 `diagnosis_overview` 为 `null`」不可达（所有 `succeeded` / `partial` 轮次都配了种子）；真实后端会遇到，当前会被归入「待采集」。已登记 **E-75**，留到 `portfolio_overview` 补三态。分布侧已安全：`overview === null` 不进分布、不算有结论、不显示 0 分。
  - 采集页矩阵：矩阵与证据表是**同一条 `collection_record_list`** 的两次查询（矩阵不带筛选）。demo 后端确定性、同轮同源，失败必然一起发生，证据表已有错误卡；只有真后端瞬时失败才可能出现「列表成功、矩阵静默消失」。Plan C 应收敛为一次取数 + 前端筛选，而不是再加第二张错误卡。


### 2026-11-03 P3 体验 / 契约整洁度 / 文档（第一批）

- **数字与日期格式化**：`components/format.ts` 新增 `countText`（固定 en-US 千分位、非有限值收敛 `0`）、`dateText`、`dateTimeSecondsText`；`KeywordTable` / `ArticleTemplateTable` / `CollectionPage` / `OverviewStationCard` / `ProjectTable` / `RevisionTimeline` 不再各写 `toLocaleString` 或 dayjs 格式。`tokensText`、站长数据密集表的曝光 / 点击 / 引用列与 AI 汇总卡也复用 `countText`；`null` / `0` 在可空列仍显示 `—`（语义未变）。
- **搜索导入共享逻辑**：`defaultIngestRange`、`SEARCH_INGEST_ERROR_KEYS` 与完成摘要 `ingestSummaryText` 收敛到 `api/search-ingest.ts`；两个弹窗只保留各自的表单与提交逻辑。未知 `reason` 不再裸露机器记号：先显示本地化说明，原始 token 只作附加信息。
- **非空断言收敛**：`CollectionMatrix` / `OverviewCompetitorsCard` / `OverviewKpiCards` / `PortfolioDistributionCard` / `api/overview-compose.ts` 去掉 5 类 `!` 断言；总分环比只读一次上一轮值。分布卡在「计数 > 0 但 min/median/max 为空」的契约违例下改为空态，不再显示 0%。
- **站长数据加载期**：`search_board` 未返回时禁用「粘贴 / 导入 / 配置」入口；避免默认区间落到系统今天，加载完成后恢复。判据用 `board === undefined`（刷新时旧锚点仍有效）。
- **文档**：修正 `current-state.md` 中「组合页只落数据层，M9 再渲染」的过时表述（`/portfolio` 已落地）。

- **真后端开工前**：先按 `docs/superpowers/specs/2026-11-03-plan-c-preflight-contract-checklist.md` 冻结 DTO / 错误码 / 枚举 / 纯函数归属 / 命令面；不要照 demo 的临时形状直接写 handler。

### 2026-11-03 Plan C 前置门禁 + 关键词 CRUD 纵向切片

- **命令面契约**：新增 `contracts/ipc-command-surface.json`（`rust_registered` + `pending`），TS 与 Rust 两侧各有断言：`IPC_COMMANDS == rust_registered ∪ pending`、`generate_handler![] == rust_registered`。当前 **105 = 44 Rust + 61 demo-only**。
- **导入 reason 契约**：新增 `contracts/search-import-reasons.json`；前端映射与 Rust 侧占位测试都对齐这 6 个 reason。未知 reason 在界面上先给本地化说明，机器记号只作附加信息。
- **第一 / 第二个纵向切片（关键词 + FAQ CRUD）**：`keyword_*` 4 条与 `faq_*` 4 条（list / add / update / delete）已落 Rust：
  - `geo-domain::keyword`：`KeywordKind`（5 类）/ `LibrarySource` / `KeywordItem` / `KeywordDraft` + 纯校验（文本必填 ≤300、priority 1..=5、difficulty ≤100、monthly_volume 非负）；
  - 迁移 `20261103000002_keywords.sql`（`project_id` 外键级联，`position` 索引）；
  - `KeywordRepo`：按 `position, id` 排序、批量写入、按 `(id, project_id)` 取/改、幂等删除、`next_position`；
  - `KeywordService` / `FaqService`：新增全有或全无；更新保留 `source` / `position` / `created_at`，跨项目 id 报 `validation/failed {field: keyword_id|faq_id, reason: invalid_id}`；
  - FAQ 额外迁移 `20261103000003_faqs.sql`，仓储 `FaqRepo` 与 `FaqService` 同构；
  - `keyword_generate` / `faq_generate` 也已落 Rust：前者调模型生成候选（月搜索量 / 难度暂为 `null`，第三方关键词接口未接入）；后者调模型成文并跑广告法红线扫描，命中整批拒绝。两者产物一律 `generated` + `pending_review`，并按文本等值去重。
  - **知识库切片**：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` / `kb_entry_verify` 已落 Rust；迁移 `20261104000004_kb.sql` 建 `kb_entries` + `kb_entry_revisions`。更新逐字段 diff 留痕（正文截断 120 字符），删除重排 `position` 且不删留痕，核实写 `verified_at` 留痕；`kb_generate` 仍 demo-only。
- 判据：关键词 domain 6 + repo 7 + service 11（含 4 条生成），FAQ domain 5 + repo 7 + service 11（含 4 条生成），KB domain 6 + repo 7 + service 9；命令面契约 2 条（Rust）/ 5 条（TS）。

## 4. 维护方式

- 命令增删：先改 `apps/desktop/ui/src/api/client.ts` 的 `IPC_COMMANDS` 与 demo 后端，再更新本文「当前命令面」表和差异台账；Rust 侧是否落地以规格/台账为准，不按 demo-only 命令机械补注册。
- 新增里程碑：先写 spec/plan，落地后再回填本文；不要在本文写“计划中”当成“已实现”。
- 发现 demo 与真后端差异：按差异台账 §1 的判据登记，编号从文件末尾续号；本文只做摘要，不替代台账。
