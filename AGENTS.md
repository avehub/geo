# AGENTS.md

本仓库是「稿得快 GEO 客户端」——Tauri 2 桌面应用（Rust 核 + React 前端），面向国内中小企业的生成式引擎优化工具。

## 必读上下文

- 产品定义：`docs/GEO客户端-MVP产品定义-v1.md`（唯一需求真值源）。
- 架构与规格：`docs/superpowers/specs/`；实施计划：`docs/superpowers/plans/`
  （按计划的依赖顺序推进；明确无依赖的 task 可并行，见「并行子任务」）。
- **当前状态与里程碑回填**：`docs/superpowers/current-state.md`
  （**改 demo、命令面、站长数据、项目概览、文章管理、站点接入前必读**；含命令面现状、
  demo-only 族、当前边界与各轮细节；里程碑落地 / 命令增删后回填）。
- demo 与真后端的已知差异：`docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`
  （**改 demo 前必读**；发现新差异按该文件 §1 的判据登记，编号从文件末尾续号，不重号、不跳号）。
- M3–M7 demo 闭环：`docs/superpowers/specs/2026-09-28-demo-m3-m7-closed-loop-design.md`
  （改采集 / 解析 / 诊断 / 行动 / 报告前必读）。
- 导航 / 设置 / 新建项目：`docs/superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md`
  （改 `/settings/:section` 五段、新建项目双入口前必读）。
- 素材层（关键词库 / FAQ）：`docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`
  （改素材层、导出或引用进 Prompt 题库前必读）。
- 站点接入与补丁工作台：`docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`
  （改站点通道、补丁下发 / 撤回 / 回滚前必读；先看 §2 调研与 §3 裁定）。
- 知识库 / Article Studio：`docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`
  （改知识库卡片、修订留痕、文章管理前必读；市场调研见同目录 `2026-10-10-kb-and-article-studio-ux-survey.md`）。
- 站长数据：`docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`
  （改导入 / 归一 / 机会 / 凭据前必读；先看 §3.4c 的禁止模拟登录裁定）。
- 项目概览：`docs/superpowers/specs/2026-10-29-project-overview-home-design.md`
  （改首页轮次锚定、待办、M9 组合口径前必读）。

### 当前关键不变量

- **命令面**：`api/client.ts` 的 `IPC_COMMANDS` 是单一清单；2026-11-05 核对为 **105 条 = 93 条 Rust + 12 条 demo-only**（关键词与 FAQ 各 5 条、知识库 6 条、站点 5 条、补丁 6 条、站长 6 条、采集读 4 条、解析/核查 4 条、诊断/行动 9 条、报告 1 条、本机环境与模型清单 2 条已转正）。
  demo 后端必须 105 条全覆盖；Rust 注册按规格 / 差异台账，demo-only 命令桌面端报 `ipc/unknown_command`，**不屏蔽**（规则 8）。
- **demo 边界**：去重率、字段完整率、样本量分级、机会判定等领域算法只在 Rust 纯函数里真算；demo 只呈现预置值 / 静态清单（规则 9）。
- **站点接入 demo**：`publish` / `unpublish` / `rollback` 只翻状态 + 记事件 + 生成交接文件，**不真的改线上站点**；`site.demoBody` / `site.staticNote` 常驻。
- **文章管理 demo**：没有真定时任务，`next_run_at` 只是显示值；生成物一律 `pending_review`，不做合规扫描。
- **站长数据**：A 类可加、B 类只重算不平均、C 类单独展示并标平台；百度统计会话数不进曝光合计；合计行必须给汇总区间、参与源、完整性旗标；搜狗 / 360 为二期。
- **项目概览**：结果区按「最近一个有结论轮次」锚定；待办按项目累计；M9 组合只给计数 + min/median/max，不对比率取平均、不求和、不做跨项目环比，默认排除归档。
- **外部数据**：只走官方 OAuth / API、客户导出、`paste_parse`、手工填报；不模拟登录（规则 11）。外部研究数据必须标机构 + 年份 + 链接，默认不参与判定。

- M9 组合总览（2026-10-29，`/portfolio`，左侧栏「项目」下的「组合总览」）：
  `docs/superpowers/specs/2026-10-29-portfolio-overview-design.md`
  🔴 只给**计数 + 分布 + 逐项目行**；比率不平均、不求和、不做跨项目环比；未采集≠0 分，
  归档默认排除；组合层风险本轮只取**未读告警**（完整队列在项目概览）。
  🔴 **命令面零新增**（仍 105）：按项目并行 `collection_board` + `diagnosis_overview`，
  再走 `api/portfolio-compose.ts` 的 `buildProjectSnapshot` / `summarizePortfolio` /
  `filterPortfolioRows`；M9 真后端应换成一个 `portfolio_overview`（E-73）。
  🔴 demo 项目从 2 个增到 **4 个**（3 active + 1 archived）：新增 `澄川水处理设备` /
  `禾野食品供应链` 两个**尚未采集**的 active 项目，专门走查「待采集 / 分布只含 1 个项目」。
- 项目概览的 P1（2026-10-29，同一页）：
  - **站外数据对账**：`search_board` + `search-compose.summarizeMetrics`，传统搜索 / AI 回答**分面展示**，
    常驻汇总区间（会收敛到头条的 8/20）、参与源与完整性旗标；不做跨面相加（DR-95 / DR-109 / DR-110）。
  - **交付进度**：`article_list` + `site_board`，文章评审队列与官网补丁台账的计数 / 完成比例。
  - **引擎差异 + 漏斗摘要**：`diagnosis_engines` 给最认可 / 最易说错两条；`diagnosis_funnel` 给
    认知 / 推荐 / 决策三层提及率标签（完整表与漏斗图留在诊断页）。
  - 这三块都只有 demo 侧实现，桌面端逐卡显示 `ipc/unknown_command`（规则 8）。

## 工具链与命令

版本由 mise 锁定，**不要用全局 node/cargo**，一律经 mise：

```bash
mise run doctor   # 打印工具链版本
mise run test     # cargo test --workspace + 前端 vitest
mise run lint     # cargo fmt --check + clippy -D warnings + 前端 lint
mise run check    # 提交前门禁（必须全绿才可声明完成）
mise run dev      # 启动原生桌面窗口（真实后端）
mise run web      # demo 模式：纯前端 + 静态数据，不连后端（浏览器打开即用）
```

无 mise 激活时可用 `mise exec -- cargo test --workspace`。

### Tauri 的两套工作目录（改构建配置前必读）

- `tauri` CLI 只在**当前目录及其子目录**里找 `tauri.conf.json`。配置在 `apps/desktop/src-tauri/`、
  前端在 `apps/desktop/ui/`，两者是兄弟目录，所以 CLI 必须在 `apps/desktop` 下跑；
  在 `ui/` 里跑会直接 panic（`Couldn't recognize the current folder as a Tauri project`）。
  `mise run dev` 用 `dir = "apps/desktop"` 固定了这一点。
- Tauri 2 的 `beforeDevCommand` / `beforeBuildCommand` 在**前端目录**里跑（由 `frontendDist`
  的上一级推出，即 `apps/desktop/ui`），所以钩子写 `pnpm run dev` / `pnpm run build`，
  加了 `--dir ui` 反而会报 `canonicalizing the --dir argument: ui`。

## 并行子任务（最多 4 个）

**目标**：只并行互不依赖的工作；计划顺序、TDD、demo 优先与共享契约优先。本节不改变硬性规则 1–11。

### 1. 先拆解，再写代码

接到多文件、跨 crate/前后端或准备派发的工作，先在主任务输出一张短表：子任务、输入 → 产出、依赖、写集（文件/模块）。单文件小改可写一行「无需并行」。**未完成拆解前不写代码；写集有交集（含测试文件、共享守卫清单、i18n namespace、迁移号、命令清单）就串行。**

只读调研、代码阅读、独立文档草稿可并行。三个条件全满足才并行：

1. A 的产出不是 B 的输入；
2. 不碰同一文件、模块、配置、迁移、命令契约或词典键；
3. 不要求先跑通 A 才能确认 B 的做法。

计划文件里的 task/step 顺序是硬依赖：只并行明确无依赖的 task；同一 task 内有先后依赖的 step 串行，禁止为并行跳过前置步骤。

计划头部指定 `superpowers:subagent-driven-development` 等必需流程时，该流程的 review / commit 顺序优先；本节只判断哪些独立 task 可以并行，不改变该流程。

### 2. 本项目的共享接缝只设一个 owner

以下不拆给多个子任务；先定稿，再并行各域实现：

- **命令面**：`api/client.ts` 的 `IPC_COMMANDS`、`demo/backend.ts` 的注册、`apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 与对照测试。命令名/参数/DTO 先由一个 owner 定稿；之后各域 handler 可并行，但命令清单、demo 路由、Rust 注册（仅当该功能按规格落 Rust）与对照测试仍由同一 owner 收口。
- **全局入口**：`App.tsx` / `SideNav.tsx` 的路由与导航挂载、`contracts/error-codes.json` + Rust `error.rs` + `api/errors.ts` + `i18n/locales/{zh-CN,en-US}/errors.ts` 的错误码契约，由单一 owner 统一挂载/收口；子任务只交页面、handler 或词典片段。
- **i18n**：同一功能的 `zh-CN` 与 `en-US` 不拆给两个人；新增 namespace/前缀与 `dictionary.test.ts`、`no-hardcoded-strings.test.ts`、`en-us-page-residual.test.tsx` 的清单/计数由同一 owner 修改。
- **全局状态**：`geo-domain` 公共类型、`geo-store/migrations/` 迁移号、`Cargo.toml` / `Cargo.lock`、`2026-09-23-demo-vs-backend-known-divergences.md` 的续号各自只允许一个 owner；子任务只报候选差异，不自行抢号。
- **demo 与真后端**：同一功能的 demo 与 Rust/桌面端落地，规则 8 的产品确认前不并行；契约冻结且写集互斥后才可拆。不得把 demo-only 命令顺手补成 Rust 实现。

### 3. 派发与上限

- 主任务同时最多派发 **4 个执行型子任务**（Task/subagent；主任务不计入）；子任务不再派生；超过 4 个分批。
- 每个 brief 必须自包含：目标、写集（只改哪些文件）、依赖/输入、验收命令与预期、TDD 要求、回报格式（改动文件、红→绿命令与结果、未决风险）。
- 子任务不得改别人写集、不得顺手重构共享契约、不得等待另一个子任务才能继续；发现必须改共享接缝时，停止并回报，由主任务裁定。
- 同一行为不要拆成「先写测试」「再写实现」两个并行任务；每个子任务在自己的切片内先红后绿（规则 1）。
- 优先隔离工作区；没有隔离时只并行写集完全不相交的任务。
- 提交：走 `superpowers:subagent-driven-development` 时，按该流程由 implementer 在各自 worktree 提交，主任务 cherry-pick / 整合；否则子任务不提交，由主任务按计划 task 统一提交。共享分支 / 同一 worktree 不得并发提交。
- 子任务运行期间，主任务继续做不冲突的集成准备，不空等。
- 子任务只跑聚焦测试；Rust 测试若争用 `target/` 锁按队列跑，不复制 target 目录；全量 `mise run check` 由主任务合并后串行执行，避免重复门禁吃掉并行收益。

### 4. 汇总与收口

主任务统一执行：按写集检查每个子任务 diff 是否越界 → 集成 → `mise run check` → 至少一条真实入口验证（`mise run web` 走查或 `mise run dev` 对应链路；纯函数/纯文档轮说明验收方式）→ 汇报。

子任务自述「完成」不算验证；失败必须报告原因、影响面与未完成项，**不得静默降级、伪造通过或把失败藏进汇总**。集成暴露共享契约问题时，回到主任务统一修订，不继续并发改同一处。

### 5. 不并行与兜底

不并行：单文件、预计 < 约 30 行的小改；强耦合重构（共享类型、接口签名、全局状态、命令面变更）；需要互相看中间结果的探索/调试；设计决策尚未稳定；同一 task 内步骤有先后依赖。

环境不支持并行时：仍先给出依赖/写集表与串行顺序，退化为单线程执行，保持子任务边界、验收标准与回报格式不变，并在最终汇报写明「因环境限制未并行」。

## 硬性规则

1. **TDD**：先写失败测试，跑红，再写最小实现。没有失败测试就不写生产代码。
2. **测试禁止联网**：所有 HTTP/LLM 交互走 `fixtures/` 录制数据或 `wiremock`。CI 中不提供任何 API Key。
3. **密钥永不落库**：API Key 只存系统钥匙串（`SecretStore` trait），数据库仅存 `secret_ref` 字符串。日志与错误信息中不得出现 Key。
4. **crate 分层不可反向依赖**：`geo-domain` 不依赖任何其他 crate 且不做 IO；`geo-llm`/`geo-crawler`/`geo-store` 可依赖 `geo-domain`；`src-tauri` 依赖全部。
5. **选型约束**：HTTP 客户端用 `reqwest` + `rustls-tls`（禁用 `native-tls`，避免 openssl 依赖）；SQLite 用 sqlx 的 bundled 编译；迁移用 `sqlx::migrate!`，不引入 refinery。
6. **文案合规**：UI 与生成内容禁用“保证排名/霸屏/第一/最”等绝对化用语，英文同理（禁 `guaranteed ranking` / `#1` / `best` / `100%` 这类绝对化表述）；生成内容默认 `PendingReview` 状态。
7. **UI 双语**：默认 `zh-CN`，支持 `en-US`。所有面向用户的文案必须经 `apps/desktop/ui/src/i18n` 词典，**不得在组件里硬编码自然语言**。后端错误只返回稳定错误码 + 语言中立的 `params`，文案由前端按当前语言渲染（契约见 `docs/superpowers/specs/2026-09-18-geo-desktop-demo-i18n-settings-design.md` §4.2）。
8. **demo 优先**：界面、交互、文案与信息架构的改动先在 demo 模式（`mise run web`）里定稿，产品负责人确认后再落桌面端与 Rust 后端。demo 后端在 `apps/desktop/ui/src/demo/`，以 `IPC_COMMANDS` 为单一清单；命令增减时**前端清单与 demo 后端必须同步**（`Record<IpcCommand, DemoHandler>` 编译期强制）。Rust 侧是否注册、是否加 DTO / 迁移，以规格与差异台账为准；未落 Rust 的 demo-only 命令不得在 Rust 侧伪造注册，桌面端已知报 `ipc/unknown_command` 不屏蔽。
9. **demo 的能力边界**：去重率、字段完整率、样本量分级等领域算法是 Rust 纯函数，demo 里只呈现预置静态值，不代表真实计算结果；不要在 demo 里"顺手实现"算法。
10. **不要 git commit 之外的破坏性操作**：不 push、不改 remote、不 force、不删分支。
11. **第三方平台数据只走官方通道**：不得实现"代客户登录第三方平台"（模拟登录 / 抓私有后台接口 / 绕验证码或风控）；
    需要平台数据时只用 ①官方 OAuth / API ②客户自己导出的文件 ③客户自己复制粘贴（`paste_parse`）④客户手工填报。
    凡界面或生成内容引用**外部研究数据**（行业 CTR 曲线、基准值等）必须标机构名 + 年份 + 链接，
    且**默认不参与判定**（裁定与出处见 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`
    §3.4c / DR-114 / DR-115）。

## 代码风格

- Rust：`rustfmt` 默认；clippy `-D warnings` 必须干净；错误统一用 `thiserror` 定义的 crate 级 `Error`，跨 crate 边界转成 `geo_domain::GeoError`。
- 公共类型放 `geo-domain`，序列化统一 `serde`，ID 统一 `uuid::Uuid`（v4），时间统一 `chrono::DateTime<Utc>`（SQLite 存 RFC3339 文本）。
- TypeScript：严格模式；IPC 调用集中在 `apps/desktop/ui/src/api/`，组件不直接 `invoke`。
- 文件保持聚焦：新增 / 大改生产代码优先控制在约 400 行内，超过时先拆职责；既有超限文件不因这条规则被顺手重构。测试、fixtures、seed、模板等数据密集文件按可读性处理，不强制套用。

## 提交规范

Conventional Commits（`feat:` / `fix:` / `test:` / `chore:` / `docs:`），一次提交对应计划里的一个 task，提交信息用中文或英文均可但需说明"做了什么 + 为什么"。并行切片的中间提交由主任务 cherry-pick / squash 收敛；最终仍保持“一个计划 task 对应一个可审查提交”。
