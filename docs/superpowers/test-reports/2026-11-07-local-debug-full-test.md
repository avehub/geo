# 搞钱GEO客户端 · 本地调试版全面测试报告

- **日期**：2026-11-07（客户端时区）
- **对象**：当前工作树（`main` + 184 项未提交改动，HEAD `6900c43`）
- **形态**：① 自动化门禁 ② demo 模式浏览器走查（`mise run web`，headless Chrome 真实点击）③ 桌面端真后端启动验证（`mise run dev`）④ 三个只读专项审计（命令面契约 / 安全与架构 / 文案合规与 i18n）
- **结论先行**：**可以进入产品走查**。自动化门禁全绿（Rust 805 + 前端 1656 用例，0 失败）；demo 54 个视图零 JS 运行时错误、零失败请求；闭环主链路（采集→解析→诊断→行动→文章→站点→报告）交互全部走通；导出真下载验证通过。**未发现 P0/P1 级功能缺陷**。发现 1 项 P2 功能缺陷（归档项目数据不可达）、1 项 P3 体验缺陷（favicon 404）、若干观察项；三个专项审计另报 2 项 P1（均为"守卫缺口/加固不足"，非已发生故障）与一批 P2/P3。

---

## 1. 测试范围与方法

| 层 | 方法 | 覆盖 |
|---|---|---|
| Rust 单元/集成 | `cargo test --workspace --no-fail-fast` | 40 个测试二进制 / 805 用例 |
| 前端单元/组件 | `vitest run` | 120 文件 / 1656 用例 |
| 静态门禁 | `cargo fmt --check`、`cargo clippy -D warnings`、`eslint --max-warnings 0`、`tsc -b && vite build` | 全绿 |
| demo UI 走查 | Playwright-core + 本机 Chrome（headless），真实点击导航/按钮/弹窗；收集 console error / pageerror / 失败请求 / ≥400 响应；逐页截图 | 4 项目 × 14 分区 + 全局页 = 54 视图；en-US 全站 23 视图 |
| 交互用例 | 40 条端到端用例（含下载、弹窗、校验、状态流转） | 见 §4 |
| 桌面端真后端 | `mise run dev` 启动原生进程，核查启动日志、SQLite 迁移、每日刷新、应用数据目录 | 见 §5 |
| 专项审计 | 3 个只读子代理（命令面契约 / 安全架构 / 文案 i18n） | 见 §6 |

**环境**：macOS；node v24.21.0 / pnpm 12.4.2 / rustc 1.98.1（mise 锁定）；Chrome（headless）；demo 运行时 = 纯浏览器（无 Tauri 桥）。

---

## 2. 自动化门禁结果（全绿）

| 门禁 | 结果 | 明细 |
|---|---|---|
| `cargo test --workspace` | ✅ | 40 个测试二进制全 `ok`；**805 passed / 0 failed / 0 ignored** |
| `cargo fmt --all --check` | ✅ | exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ | exit 0，0 warning |
| `pnpm test`（vitest） | ✅ | **120 文件 / 1656 用例 passed**（310s） |
| `pnpm lint`（eslint --max-warnings 0） | ✅ | exit 0 |
| `pnpm build`（tsc -b + vite build） | ✅ | 3362 模块；产物 `index-*.js` **2,446.81 kB（gzip 731.22 kB）**，vite 提示 >500kB（见 O-05） |

---

## 3. demo 模式页面走查（54 视图）

- **0 个 pageerror、0 个失败网络请求、0 个 ≥400 业务响应**；唯一控制台错误是 **favicon 404**（D-02，每次加载 1 条）。
- 4 个项目（含 1 个归档）× 14 个分区全部可达并渲染；未采集项目（澄川/禾野）正确显示空态与「去采集」引导，**没有被当成 0 分**。
- 组合总览：项目数 3（归档默认排除）、有结论 1 / 待采集 2、比率只给 min/中位数/max 且注明「不是平均值」——与 M9 规格一致。
- 设计样张 `/__design`（dev-only）正常渲染。
- 设置五段（通用/模型服务商/采集与频控/数据与存储/关于）全部可达；demo 下系统权限如实显示「当前环境不支持」。

### en-US 全站扫描（23 视图）
- 界面语言切到英文后，**UI 文案零中文残留**；检出的 17 条唯一中文行全部是**品牌名与种子数据值**（项目名、轮次名、行业标签、地域），标签部分（`Brand:` / `aliases:` / `Updated` / `· GEO performance…`）均已翻译。
- 观察 O-01：demo 种子语料只有中文，en-US 下数据面中英混排（数据非文案，可接受，建议登记为已知形态）。

---

## 4. 交互用例结果（40 条）

> 说明：首轮有 8 条因**测试脚本定位口径**误报（如把 antd Select 当 radio、漏勾选评审行、漏填必填项、下载未开 acceptDownloads、导出是下拉/弹窗二级按钮），全部已复测修正；下表为**最终判定**。

| 域 | 用例 | 结果 | 证据摘要 |
|---|---|---|---|
| 外壳 | 收起/展开导航 | ✅ | 240→64→240px |
| 外壳 | 演示模式细条常驻、不可关闭、说明可开 | ✅ | 无关闭按钮；说明弹层正常 |
| 外壳 | 主题 浅色→深色 + 刷新持久化 | ✅ | `colorScheme=dark`、`geo.preferences` 落 localStorage、刷新后仍深色（截图佐证） |
| 外壳 | 字号 标准→大→小 | ✅ | antd token 14→16→13px |
| 外壳 | 隐私开关可切换 | ✅ | aria-checked false→true |
| i18n | 界面语言切英文 + 全站扫描 | ✅ | 见 §3 |
| 采集 | 排一轮采集（弹窗→排队） | ✅ | demo 新轮次停「排队中」+ demoNotice，符合 demo 边界 |
| 采集 | 任务重跑 | ✅ | toast「重跑完成，证据与解析结果已入库」 |
| 解析 | 证据抽屉 / 纠正弹窗 | ✅ | 抽屉 409 字含引擎/通道/时间；纠正弹窗字段齐 |
| 诊断 | 轮次切换（第4轮空态→第3轮出五维/总分） | ✅ | 空态切换正确 |
| 诊断 | 告警标记已读 | ✅ | 未读 2→1，toast「已更新告警状态」 |
| 行动 | 处方状态流转 | ✅ | toast「已更新处方状态」 |
| 文章 | 立即生成→待审 | ✅ | 待审 3→5，toast「已生成 1 篇待审文章」（不直接发布，符合规则 6） |
| 文章 | 勾选→通过选中 | ✅ | 禁用 true→false，「通过选中（5）」→「已通过 5 篇文章」 |
| 文章 | 导出 Markdown 真下载 | ✅ | 1,055 B |
| 站点 | 补丁发布/撤回 | ✅ | toast「已记为发布：线上生效要靠所选通道真的执行一次」；demo 只翻状态，符合边界 |
| 报告 | 生成报告渲染 | ✅ | 1,919 字 |
| 报告 | demo 导出门禁 | ✅ | Markdown/HTML/CSV 可用；**Word/PDF/XLSX 置灰**（disabled=true） |
| 报告 | 导出 CSV 真下载 | ✅ | 2,173 B |
| 素材 | 关键词手动录入/FAQ 手动录入/知识库新增 | ✅ | 均落库可检索（KB 新条目需搜索或切分组可见，见 O-04） |
| 实体卡 | 行内编辑保存 | ✅ | toast「字段已更新，修订已留痕」 |
| 站长 | 合计行含汇总区间/参与源/完整性旗标 | ✅ | 三要素齐 |
| 站长 | 粘贴解析（平台原文表头） | ✅ | 选「百度（索引量/流量与关键词）」+ `关键词/展现量/点击量` 解析成功；表头不匹配时给「缺少必需的列/未知字段」稳定提示（拒绝路径正确） |
| 站长 | 机会采纳 | ✅ | toast「已更新机会状态」 |
| 项目 | 显示已归档后归档项目入列表 | ✅ | 行可见，行内按钮=取消归档/导出 |
| 项目 | **归档项目可打开** | ❌ | **D-01：无任何打开入口，归档后数据不可达** |
| 项目 | 导出 JSON 真下载 | ✅ | 53,465 B，内容以 `{` 开头 |
| 项目 | 5 步向导空表单拦截 / 填完进第二步 | ✅ | 校验文案命中 |
| 项目 | 自动采集屏提交 | ✅ | 「开始采集」有反馈 |
| 组合 | 「待采集」筛选 | ✅ | 只留未采集项目 |

**交互用例合计：39 通过 / 1 失败（D-01）/ 0 阻断。**

---

## 5. 桌面端真后端（`mise run dev`）

- 原生进程启动成功，**无 panic**；`tauri dev` 的 beforeDev/dev 命令链路正常（vite 1420 + cargo run）。
- 应用日志（`~/Library/Logs/com.gaodekuai.geo/gdk-geo.log.*`）显示：`SQLite 连接池就绪，迁移已校验 max_connections=4`、`GSC daily refresh finished`、`Bing daily refresh finished`——启动即跑 + 24h 节奏生效。
- 应用数据目录 `~/Library/Application Support/com.gaodekuai.geo/`：`geo.db`（含 `_sqlx_migrations` 等 20+ 张表、2 个项目）、`browser-profile/baidu_ziyuan_ai/`（百度通道 profile）、`screenshots/`（元宝截图目录）——与规格一致。
- 日志中**未见任何密钥/token 明文**（抽查今日日志，仅 provider 名与 reason）。
- **限制**：本环境无 Accessibility 授权、cua 无法解析未打包的 dev 二进制，**未能对原生窗口做 GUI 级截图/点击走查**；桌面端功能正确性由 805 条 Rust 集成测试 + 契约测试（108/108 注册）+ 上述启动证据共同背书。真窗口走查建议由产品负责人按 README 人工执行。

---

## 6. 专项审计摘要（3 个只读子代理）

### 6.1 命令面契约（Jason）
- **核心不变量成立**：`IPC_COMMANDS` 108 = demo 108 = Rust `generate_handler!` 108 = 契约 `rust_registered` 108，`pending` 0；六组两两集合差全空；`#[tauri::command]` 声明与注册严格 1:1；错误码 44 条四处对齐；抽查 5 条命令的参数名/返回 DTO 字段名/顺序/可空性全一致。实跑契约测试全绿。
- **P2-A1**：`{kind}/not_found` 动态错误码族靠三份**手抄**清单（各 5 个 kind），其注释声称的取证命令实跑出 **13** 个 kind；守卫单向，结构上发现不了漏登记。当前 14 个发射点均被 service 层兜底转换，**无用户可见故障**，属"假保险"。
- **P2-A2**：命令**载荷**面（DTO 形状）零自动化跨端守卫（`DemoHandler` 返回 `unknown`，无 ts-rs/typeshare/schemars）。
- **P2-A3**：`client.ts` / `backend.ts` 内 6 处「demo 独有」分族注释与文件头「108=108 Rust+0 demo-only」自相矛盾（纯注释，易误导后续维护）。
- **P2-A4**：`search_board` 真后端 3/9 字段硬编码空（`self_index_summary/self_index_snapshots/traffic_split`），demo 有数据——台账 E-67 口径已过时。
- P3：错误码条数注释 4 处写 43 / 4 处写 44；`command-surface.test.ts` 两条用例零迭代空转；`current-state.md` 旧小节残留「105 = 44+61」。

### 6.2 安全与架构（Parfit）
- 规则 3/4/5/11 **全部遵守**：密钥只进钥匙串、迁移无密钥列、refresh_token 轮换不落库、55 处日志宏无泄漏；crate 分层零反向依赖、geo-domain 零 IO；无 native-tls/openssl/refinery，sqlx bundled 有物证；四条第三方通道均为「用户自登/扫码 + 程序只取数」，反模式扫描零命中。
- **P1-B1**：百度站长通道以 `--remote-allow-origins=*` 开 CDP 且浏览器不回收，该 profile 持有客户登录态（利用需额外原语，作者已如实降级说明）。
- P2-B1 `validate_ws_url` 只校验 scheme 不校验 host（可外连任意 CDP 投毒）；P2-B2 Bing Key 拼进 URL 而 `HttpRequest: Debug` 只打码头；P2-B3 IPC 兜底 `redact()` 只认 `sk-` 前缀；P2-B4 代理凭据可明文落库并进错误 params；P2-B5 元宝通道 `--no-sandbox`；P2-B6 元宝 profile 落临时目录。
- P3：oauth accept 无超时、`wss://` 校验与能力不符、3 个持凭据类型派生 Debug。

### 6.3 文案合规与 i18n（Galileo）
- 规则 6 **实质合规**：词典 22 ns × 两侧 5016 叶、种子 6885 条、198 个模板、15 个 fixture 逐条裁定 **0 条确认违规**；`PendingReview` 默认全链路有测试钉死，无自动置 approved/published 路径。
- 规则 7 键集 **2508 vs 2508 零差异**；组件层硬编码仅 1 处漏网（`PromptTable.tsx:50 title:'Prompt'`）。
- **P1-C1**：demo 种子语料（唯一会上屏的 6885 条）**没有任何规则 6 自动守卫**——今天干净靠人工纪律。
- **P1-C2**：真后端把中文枚举标签塞进 DTO（`group_name = intent.label_zh()`）原样上屏，en-US 残留守卫对此结构性失明（守卫跑在刻意不镜像中文表的 demo 后端上）。
- P2-C1 导出原生对话框标题硬编码「导出」；P2-C2 `PromptSet.notes` 中文散文（已知 backlog）；P2-C3 `geo-domain` 15+ 处领域文案；P2-C4 人工录入不跑红线扫描而 CSV 导入跑（手工补丁可直接发布，需产品裁定）。
- P3：前端 `bannedZh` 词表比权威 `adlaw_terms.txt` 少 22 条；同义键 en 三译；守卫下界与注释过期（60 vs 实测 253）。

---

## 7. 缺陷清单（统一编号）

### P0
无。

### P1（均为"守卫/加固缺口"，非已发生故障）
| 编号 | 缺陷 | 来源 | 复现/证据 |
|---|---|---|---|
| P1-01 | 百度站长 CDP `--remote-allow-origins=*` + 进程不回收，profile 持客户登录态 | 审计 B | `search_browser.rs:230-241` |
| P1-02 | demo 种子语料无规则 6 自动守卫 | 审计 C | `seed.test.ts` 无 adlaw 扫描 |
| P1-03 | 真后端 DTO 夹中文枚举标签，en-US 守卫结构性失明 | 审计 C | `geo-domain/src/prompt.rs:215` → `PromptTable.tsx:83` |

### P2
| 编号 | 缺陷 | 来源 | 复现 |
|---|---|---|---|
| **P2-01** | **归档项目数据在 UI 完全不可达**：侧栏项 disabled、项目切换器过滤、列表行仅「取消归档/导出」，无打开入口 | 本次实测 E12b | 项目列表→显示已归档→云栖协作平台行 |
| P2-02 | `{kind}/not_found` 手抄清单 5 vs 实跑 13，守卫单向 | 审计 A | `error.rs:396-407` |
| P2-03 | DTO 形状零跨端守卫 | 审计 A | `demo/types.ts:74` |
| P2-04 | `search_board` 真后端 3 字段恒空，demo 有数据 | 审计 A | `search_service.rs:245-247` |
| P2-05 | `validate_ws_url` 不校验 host | 审计 B | `search_browser.rs:176-185` |
| P2-06 | Bing Key 进 URL + Debug 只打码头 | 审计 B | `search_oauth.rs:439-446` |
| P2-07 | `redact()` 只认 `sk-` | 审计 B | `error.rs:201-234` |
| P2-08 | 代理凭据可明文落库/进错误 params | 审计 B | `geo-store/src/settings.rs:220-236` |
| P2-09 | 人工录入不跑红线扫描，手工补丁可直接发布 | 审计 C | `site_patch.rs:252` |
| P2-10 | 导出原生对话框标题硬编码「导出」 | 审计 C | `ipc/export.rs:183` |

### P3 / 观察
| 编号 | 项 | 来源 |
|---|---|---|
| **P3-01** | **favicon 404**：`index.html` 无 `<link rel="icon">`，`/favicon.ico` 404，demo 每次加载 1 条控制台错误 | 本次实测 |
| P3-02 | 诊断页默认轮次=最后一轮（进行中）与概览「最近有结论轮次」锚定不一致；从概览「看诊断」跳过去整页空态（规格 §311 明确为设计，建议跳转带 round 参数） | 本次实测 |
| P3-03 | KB 新增后新条目不在当前分组视图，无自动定位/高亮 | 本次实测 |
| P3-04 | 生产 bundle 单 chunk 2.45MB（gzip 731KB），无 code splitting | 本次实测 |
| P3-05 | dev 控制台偶发 rc-util「There may be circular references」（antd 三方噪声） | 本次实测 |
| P3-06 | 元宝通道 `--no-sandbox` / profile 落临时目录 | 审计 B |
| P3-07 | 前端 `bannedZh` 与 `adlaw_terms.txt` 漂移 22 条 | 审计 C |
| P3-08 | 注释/文档数字过期（43 vs 44、105、60 vs 253 等） | 审计 A/C |
| O-01 | en-US 下种子数据为中文（数据面混排，可接受） | 本次实测 |

---

## 8. 未覆盖与限制

1. **原生窗口 GUI 级走查未做**（无 Accessibility 授权；dev 二进制未打包，cua 不可解析）。桌面端以 805 条集成测试 + 启动日志 + 数据目录证据背书。
2. **真实第三方链路未触发**：GSC OAuth、Bing API Key、百度/元宝浏览器通道均需真实凭据/扫码，按规则 11 不在自动化内执行；仅验证了启动刷新与拒绝路径。
3. demo 的「排一轮采集」按设计不真发请求（新轮次停排队中），真实采集执行由 Rust 集成测试（fixture/wiremock）覆盖。
4. 性能/内存/长稳、安装包签名与自动更新、License、DB 加密不在本轮范围（current-state 已列待办）。

---

## 9. 结论与放行建议

- **门禁与回归**：全绿，可提交前基线。
- **demo 走查**：主闭环与全局页无阻断问题；**建议先修 P2-01（归档不可达）与 P3-01（favicon）再交产品走查**，二者均为一行级改动。
- **桌面端**：启动与持久化链路健康；真窗口走查留给产品负责人人工执行。
- **安全/合规**：无已发生的泄漏或违规；P1-01~03 建议按「先补失败测试再改实现」（规则 1）排入下一轮，其中 P1-03 与 P2-02 可纯函数层红→绿，不动命令面。

---

## 10. 修复回填（2026-11-07 第二轮，按本报告 §7 逐条）

> 执行方式：主任务持有共享接缝（`error.rs`、命令载荷、i18n、前端页面），3 个写集互不相交的子任务并行修 Rust 切片；全部按规则 1 先红后绿；修完重跑全量门禁 + 浏览器复验。

### 10.1 门禁复跑（修复后）

| 门禁 | 结果 |
|---|---|
| `cargo test --workspace` | ✅ **831 passed / 0 failed**（修复前 805，新增 26 条回归用例） |
| `cargo fmt --all --check` | ✅ |
| `cargo clippy --workspace --all-targets -D warnings` | ✅ 0 warning |
| `vitest run` | ✅ **122 文件 / 1674 用例**（修复前 120/1656） |
| `eslint --max-warnings 0` / `tsc -b && vite build` | ✅ |
| 浏览器复验（demo） | ✅ 4/4：favicon 404 消失且零控制台错误；归档项目可打开概览；概览→诊断落在有结论轮次；KB 新增立即可见且筛选复位 |

### 10.2 逐条处置

| 编号 | 处置 | 证据 |
|---|---|---|
| P2-01 归档不可达 | **已修**：项目名改为可点（`ProjectTable` 新增 `onOpenOverview`），归档行同样可打开概览 | `ProjectListPage.test.tsx` 新增用例红→绿；浏览器复验 V1 |
| P3-01 favicon 404 | **已修**：`index.html` 加 `<link rel="icon">` + `public/favicon.svg` | 新增 `src/__tests__/index-html-favicon.test.ts`（钉 link + 钉文件存在）；复验 V0 |
| P3-02 诊断跳转空态 | **已修**：概览三处跳诊断带 `?round=<锚定轮>`；诊断页读参数并对非法值回落默认 | `OverviewPage.test.tsx` / `DiagnosisPage.test.tsx` 各 2 条新用例；复验 V2 |
| P3-03 KB 新增不可见 | **已修**：表格改更新时间倒序（新条目恒在第一页）+ 新增成功后筛选复位 | `KnowledgeBasePage.test.tsx` 新用例；3 条既有用例改为按标题取行/搜索隔离（不再绑死行序）；复验 V3 |
| P1-01 通配 origin | **已修（通配部分）**：取证 tungstenite 客户端握手**不发 Origin**（`client.rs:223-246` 仅 5 个头）后整行删除 `--remote-allow-origins=*`，测试断言启动参数不含该 flag | 子任务 Ampere；**进程不回收**保留（既有设计：用户要在同一窗口继续操作），留产品裁定 |
| P1-02 种子语料零守卫 | **已修**：新增 `src/demo/seed-adlaw-guard.test.ts`，词表读 `crates/geo-domain/data/adlaw_terms.txt` 单一真值源，豁免只走显式 ALLOWLIST（4 条、逐条理由）+ 反向探针 + 下界 | 子任务 Boyle；首版红命中 11 条（5 串），补 ALLOWLIST 后 8/8 绿 |
| P1-03 DTO 中文枚举标签 | **已修**：`PromptItem::new` / csv 导入 / 手工录入 / 编辑四条路径 `group_name` 一律留空；前端 `PromptTable` 回落词典标签（弱文本，不抢 `.ant-tag` 判据锚点） | 子任务 Boyle（geo-domain）+ 主任务（prompt_service / PromptTable）；`PromptSetPage.test.tsx` en-US 用例红→绿 |
| P2-02 not_found 手抄清单 | **已修**：`include_str!` 构建期派生 12 个发射点文件的 kind 集合，与「契约清单 + INTERNAL 清单」做**双向相等**断言；INTERNAL 另断言不得进共享契约 | `error.rs` 新增 2 条守卫；`error::` 31/31 绿 |
| P2-05 ws host 白名单 | **已修**：`url::Url` 解析 + host 必须回环，非回环一律 `invalid_ws_url` | 子任务 Ampere，红→绿 |
| P2-06 Debug/错误串泄漏 | **已修**：`HttpRequest: Debug` 的 url 走 `MaskedUrl`；另补 `mask_secret_params` 抹掉 reqwest 错误串里 `apikey=/key=/token=/access_token=` 的值（该串会进滚动日志） | 子任务 Ampere + 主任务补错误串一层；geo-llm 20/20 绿 |
| P2-07 redact 只认 sk- | **已修**：前缀扩到 `sk- / ya29. / 1//`，并抹 `Bearer <token>` 的 token 本体；孤立前缀不误伤 | `error.rs` 2 条新用例红→绿 |
| P2-08 代理凭据 | **已修**：store 与 service 双层拒绝 authority 含 `@` 的地址（`validation/failed {field,reason}`，**不回显 value**）；协议非法的回显抹 userinfo | 子任务 Kant；geo-store 150+9 绿、geo-desktop lib 120 绿 |
| P2-09 手工补丁不扫红线 | **已修（add 路径）**：`SitePatchService::add` 标题+正文跑 compliance，命中整条拒；approved 语义不变 | 子任务 Kant，2 条集成测试红→绿；**`save` 改正文的残留绕过**留产品裁定（存量清洗策略未定） |
| P2-10 导出对话框标题 | **已修**：`export_write_file` 增可选 `title`，前端 8 个调用点传 `t('common.exportDialogTitle')`（zh 导出 / en Export），Rust 缺省回落 ASCII | `CsvToolbar.test.tsx` 新用例红→绿；契约条数不变（108） |
| P3-06 元宝沙箱/profile | **已修**：删 `.sandbox(false)`；profile 改走 `AppState::browser_profile_dir/yuanbao` | 子任务 Ampere；旧临时 profile 不迁移（老用户重扫一次，已记录） |
| P3-07 词表漂移 | **已修**：`dictionary.test.ts` 的 zh 判据改读 `adlaw_terms.txt` 生成；序数负向前瞻与值级语境豁免（`绝对`→「绝对化用语」风险标签）保留并钉住 | 31/31 绿；对照组探针改为点名断言（`100%` 同时点亮词表与 en 判据属正确行为） |
| P3-08 过期数字 | **已修**：43→44（4 处）、设置判据 12→13、扫描面 63/224→253、抽取面 117→141、词典 ns 21→22 | 注释级，随门禁复跑确认无行为变化 |
| P2-03 DTO 跨端守卫 | **缓修**：需 ts-rs/快照方案设计，属守卫基建不是 bug；本轮以 5 条命令人工比对兜底 | 见 §6.1 |
| P2-04 search_board 三字段 | **缓修**：DR-111 数据源未接；台账 E-67 口径已更新为「仅自建索引三件套仍空」 | 差异台账 §4k |
| P3-04 bundle 拆包 | **缓修**：性能优化，另开 task（不改行为） | build 警告仍在 |
| P3-05 rc-util 噪声 | **不修**：antd/rc-util 三方 dev 噪声，非本仓代码 | — |
| O-01 en 种子中文 | **接受**：数据面非文案面 | §3 |

### 10.3 台账续号

差异台账新增 **E-81**（demo `site_patch_add` 不扫红线 vs 真后端扫）、**E-82**（demo 不镜像 proxy 凭据判据），并修正 E-67 口径（指标/AI 汇总/C 类留档已真实，仅自建索引三件套仍空）。
