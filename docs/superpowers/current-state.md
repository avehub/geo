# 当前状态与里程碑回填

> **状态快照**：2026-11-10（命令面仍为 2026-11-06 核对的 108 条）。本文是当前状态与执行回填，**不是需求真值源**；冲突时以产品定义、对应 spec、差异台账为准。
>
> **何时读**：改 demo、命令面、站长数据、项目概览、文章管理、站点接入前。
>
> **更新纪律**：命令增删时同步本文「当前命令面」表与差异台账；不要把未发生或无法验证的状态写进来。

## 1. 当前命令面（2026-11-06 核对）

| 项 | 数量 | 真值源 |
|---|---:|---|
| `IPC_COMMANDS` | 108 | `apps/desktop/ui/src/api/client.ts` |
| `demoBackend` 键 | 108 | `apps/desktop/ui/src/demo/backend.ts` |
| Rust `generate_handler![]` | 108 | `apps/desktop/src-tauri/src/ipc/mod.rs` |
| demo-only | 0 | `contracts/ipc-command-surface.json` 的 `pending` |

**108 = 108 条 Rust + 0 条 demo-only。** `demoBackend` 必须 108 条全覆盖（漏一条 `tsc -b` 就红）；桌面端点进 demo-only 命令报 `ipc/unknown_command`，按规则 8 **不屏蔽**。

### demo-only 族

| 轮次 | 命令族 | 条数 | 差异 |
|---|---|---:|---|
| M3–M7 | `collection_start` / `collection_task_retry` | 0 | §4b E-33（已全部转正） |
| Plan B | `app_environment` / `llm_models_list` | 0 | §4c E-46…E-51（已全部转正） |
| M1.5 | `keyword_*` / `faq_*` | 0 | §4d E-52…E-54（已全部转正） |
| M6.5 | `site_patch_generate` | 0 | §4e E-55…E-57（已全部转正） |
| M1.2b | `kb_*` | 0 | §4g E-58…E-66（已全部转正） |
| M6 | `article_*` | 0 | §4g E-63…E-66（已全部转正） |
| M5.5 | `search_*` | 0 | §4h E-67…E-72、§4n E-77（已全部转正） |

### 2026-11-06 GSC OAuth 拉数（命令面 105 → 106）

- 新增 `search_oauth_begin(project_id, kind)`：**现在只支持 `gsc`**（Bing 于同日改走 API Key，见下条）；百度站长没有读 API，其他源一律 `kind/not_allowed`，不伪造 OAuth。
- GSC 走 PKCE + `127.0.0.1:0` loopback，client secret（可选）在 `keyring://llm/google_oauth`，token 在 `keyring://search/gsc`；库里只落 `search_sources.credentials_state=stored` 与 `data_through`。
- 授权成功后立即拉 `searchAnalytics/query`（query × page，近 28 天，截止今天 -3 天），按 `MAPPING_VERSION` 映射并覆盖同周期同源指标；失败只写稳定 `check_detail.code`（`search_oauth_failed` / `search_fetch_failed`），不记录 token。
- demo 对 `search_oauth_begin` 明确回 `validation/failed { field: "oauth", reason: "not_allowed" }`；抽屉只在 `runtime === 'tauri' && kind === 'gsc' && auth_mode === 'oauth'` 渲染授权按钮。
- **GSC 定时拉取（2026-11-06）**：启动即跑一次，之后每 24 小时一次 `refresh_all_gsc`；过期 access token 用 refresh_token 轮换（Google 未回新 refresh_token 时保留旧值），再拉近 28 天 query × page 数据。失败只写源状态与日志，不删旧数据、不弹 UI。
- **报告导出（2026-11-06）**：`export_write_file` 增加 `format: pdf / xlsx`；桌面端报告页 PDF（无头 Chrome 打印 HTML）与 XLSX（CSV → `rust_xlsxwriter`）可用；demo 仍只出 Markdown / HTML / CSV，pdf/xlsx 置灰并返回稳定拒绝。Word/PNG 仍未做。

### 2026-11-06 Bing Webmaster 改走官方 API Key（命令面不变 108）

- 🔴 **Bing 不再走 OAuth**：Bing 的 OAuth 控制台不接受 loopback 重定向地址
  （`http://localhost:…` 被后台判“不是有效的 http 或 https url”，且控制台不支持事后改回调），
  所以 OAuth 授权流程整条移除（`oauth_begin` 现只支持 `gsc`）。
- 凭据是官方 API Key：`keyring://llm/bing_wmt`（`SecretStatusPanel provider="bing_wmt"`，只进钥匙串）。
  取数走 `GetQueryStats?siteUrl=…&apikey=…`（实测可用：`GetUserSites` / `GetQueryStats` /
  `GetRankAndTrafficStats` 均返回真实数据）。
- `bing_wmt` 的绑定字段回落到只用 `siteUrl`（不再要求 `client_id`）。
- `refresh_all_bing`：遍历 `kind='bing_wmt'` 的源，用 API Key 拉近 28 天（截止今天 -1 天）；
  没有 Key 就跳过、不改源状态；失败只写 `search_fetch_failed`（`reason=upstream`），不伪造数据。
  `lib.rs` 已接入，与 GSC 共用“启动即跑一次 + 每 24 小时”的节奏。
- `BingAuth` 保留 `Bearer` 变体（JSON API 契约的一部分），但**没有任何流程会产出 token**。

### 2026-11-06 demo 文案运行时门禁收口

- **原则**：所有「演示模式 / 预置样本 / 不联网 / 不调模型」短语只在 `runtime === 'demo'` 上屏；桌面端要么显示 live 口径，要么不显示。
- **本轮补齐**：知识库页头 `kb.demoHint`、生成弹窗 `kb.generate.demoNote`、素材预览 `kb.entry.mediaNote`、知识库导出提示；自动采集屏 `project.autobuild.demoNotice` / `urlExtra`；设置页模型列表 `modelList.hint` / `empty`、关于段 `about.phase2`、权限卡 `permissionsCard.desktopOnly`；文稿导出不可用格式 `action.export.desktopOnly`；报告白标 `whiteLabel.defaultHint`。
- **公共检查码去 demo 化**：`site_cms_not_configured` / `search_binding_blocked` 的文案不再夹带「演示模式不收密码 / 不发请求」；WordPress 通道说明也改成运行时中立，demo 的凭据边界只由 `site.channels.demoCredentials` 承担。
- **测试**：demo 与 tauri 两侧分别钉住（`*.demo.test.tsx` / `*.live.test.tsx`），设置段测试不再用 demo 文案断言 tauri 运行时。

### 2026-11-06 百度站长路径 C：控制系统 Chrome（命令面 106 → 108）

- 新增 `search_browser_open(project_id, kind)` 与 `search_browser_capture(project_id, kind, ws_url, period_start, period_end)`，**只支持 `baidu_ziyuan` / `baidu_ziyuan_ai`**；其它 kind 回 `validation/failed { field: "kind", reason: "not_allowed" }`。
- `open` 用 `headless_chrome::browser::default_executable()` 找系统 Chrome/Edge，`std::process::Command` 启动到独立 profile（`<browser_profile_dir>/<kind>`），轮询 `http://127.0.0.1:<port>/json/version` 取 `webSocketDebuggerUrl`；**不 kill Chrome**，用户继续在窗口里操作。
- `capture` 只读当前可见 `<table>`（`Tab::evaluate` 一段脚本转 TSV），逐张交给既有 `SearchService::import_metrics`；
  🔴 脚本必须以 **JSON 字符串**返回：`headless_chrome` 的 `Tab::evaluate` 把 `return_by_value` 写死为 `false`，
  直接回数组时 `RemoteObject.value` 恒为 `None`（这一条曾表现为「读取当前页永远失败」）。**列映射不重写**。第一张有数据的表成功即返回；全部失败回 `validation/failed { field: "payload", reason: "parse_failed" }`，`detail.tables[]` 带每张表的行级摘要。
- 合规：不代登录、不输入账号密码、不绕验证码、不读 cookie / localStorage、不调私有 XHR；界面只在 `runtime === 'tauri' && (baidu_ziyuan | baidu_ziyuan_ai)` 渲染两个入口。
- 取数区间由页面锚点推导（`period_end = asOf`、`period_start = asOf - 27 天`），不取系统今天。
- 失败统一 `browser/unavailable { reason }`（`chrome_not_found` / `launch_failed` / `debug_port_timeout` /
  `connect_failed` / `no_tab` / `no_table_found` / `evaluate_failed` / `invalid_ws_url` / `browser_disabled` /
  `browser_task_failed`），前端按 `reason` 渲染可操作提示；**不再**用 `validation/failed + not_allowed`
  把真实原因藏成“系统浏览器不被允许”。
- demo 对两条命令固定回 `validation/failed { field: "browser", reason: "not_allowed" }`；侧滑在 demo 下不渲染入口。

## 2. 当前 demo 边界

- **领域算法**：去重率、字段完整率、样本量分级、机会判定等只在 Rust 纯函数里真算；demo 只呈现预置值或静态清单（规则 9）。
- **站点接入**：demo 不真的改线上站点；`publish` / `unpublish` / `rollback` 只翻状态 + 记事件 + 生成交接文件；`site.demoBody` / `site.staticNote` 常驻。
- **文章管理**：demo 没有真定时任务；桌面端有一个 **60 秒轮询**的排期扫描器（启动即跑一次，之后每分钟扫 `enabled=1 AND next_run_at <= now`），到点调模型生成文章并把排期推进；标题重复时不新增文章但照常推进，避免每分钟重试。生成物一律 `pending_review`。
- **站长数据**：demo 的 OAuth 一条都没实现；Tauri 侧 2026-11-06 起支持 GSC OAuth 拉数。demo 仍只走导入 / 填报 / 汇总 / 筛选 / 机会处置。归一 / 求和 / 重算 / 筛选 / 区间收敛在前端 `api/search-compose.ts` 真做；机会清单是静态 6 条。
- **项目概览**：M9 组合只有数据层、没有页面；`summarizePortfolio` 只给计数 + 每个指标的 min/median/max 分布 + 逐项目行。

### 开发构建的 macOS 钥匙串授权（2026-11-06）

- `tauri dev` 的二进制是 linker-signed ad-hoc（`codesign -dv` 显示 `Signature=adhoc`），
  cdhash 每次重编都会变；而 Keychain 条目的 ACL 记的是**创建它那次构建**的 cdhash。
  旧条目在新构建里走解密路径时，macOS 会弹
  「geo-desktop 想要使用你存储在 com.gaodekuai.geo 中的机密信息」。
- 🔴 `secret_status` 已改成 `SecretStore::exists`：macOS 用
  `SecItemCopyMatching` + `kSecReturnAttributes`（不取 data）只查存在性，**不触发**该授权框
  （实测对旧 ACL 条目 6ms 返回）。真正的 `get`（测试连接 / 生成文章 / 采集）仍会走解密路径，
  开发构建下可能再次弹框；macOS 26.5 上已观察到输完密码后卡在 securityd `decrypt` 的情况。
- 恢复办法（开发机）：退出应用 → 钥匙串访问里删除 service `com.gaodekuai.geo` 的旧条目
  （或把该条目的「访问控制」改成允许所有应用）→ 重启后重新保存 Key。
  生产构建用稳定签名，不会因重编而失效。
- 前端侧同时补了失败出口：`secret_status` 失败不再永远停在「读取中」，而是显示错误码文案 + 「刷新」，
  且该查询 `retry: false`（避免一次失败连弹多次系统授权框）。

### 2026-11-06 复现补充：登录钥匙串的 partition ACL（macOS 26.5）

- 上面那条「旧条目弹授权框」的成因比 cdhash 变化更具体：登录钥匙串里的 generic password
  会自动带一条 `___PARTITION___` ACL。ad-hoc 构建创建条目时，partition 记成
  `cdhash:<创建它那次构建>`；Apple 自带工具创建时则是 `apple-tool:`。**partition 不匹配时，
  即使把条目的访问控制改成「允许所有应用」也照样弹框**（实测 `security add-generic-password -A`
  的条目在 `apple-tool:` partition 下仍会被其它进程拒绝）。
- `keyring` 的 `set_password` 对已存在条目只改数据、**不重写 ACL / partition**。因此旧条目
  即使重新保存 Key 也修不好，必须删除后重建。
- 更隐蔽的一种：二进制在应用运行期间被重编替换。securityd 会按**磁盘上的新二进制**写 ACL，
  却按**内存里的旧进程**写 partition；两套身份互不相认，于是「输完密码点允许」后
  `SecurityAgent` 直接退出（日志：`user did not approve 'allow'`、
  `SecurityAgentConnection ... dying`、`CSSM Exception 225=e1`），界面看起来就是点了没反应。
  登录钥匙串随后可能卡在 `derivePassphraseIfNecessary` / `cssm_GenerateKey` 循环，
  连新建条目都会停住；此时**重启 macOS** 是最可靠的恢复手段。
- 代码侧已补三道出口（`crates/geo-store/src/secret.rs`）：
  1. `KeyringSecretStore::set` **先删后建**：保存 Key 会刷新 ACL / partition，不需要用户
     再去钥匙串访问里手工删条目。
  2. macOS 开发构建在启动时记录可执行文件指纹；运行期间二进制被替换后，所有密钥操作
     直接返回 `config/invalid reason=secret_unavailable value=binary_replaced`，
     **不再调用** `Security.framework`，避免弹出那个卡死的授权框。
  3. 钥匙串调用跑在独立线程上，10 秒超时返回 `value=keychain_timeout`；Tauri IPC
     不再可能被 securityd 永久挂住。
- 恢复顺序：先重启 macOS（清掉卡死的 securityd）→ 重启应用 → 在设置里重新输入 Key 并保存
  → 再点「测试连接」。若旧条目还在，保存时的「先删后建」会替换它；也可以先点「删除」。
- 生产构建用稳定签名，partition 不会随重编变化，不触发这条路径。

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
- 2026-11-06：**页面提示栏位置统一**——页面级提示固定在 `PageHeader` 副标题下。新建项目「两条路字段口径一致」提示从两张卡片下方移到页头下；项目列表的表格操作提示从表尾移到页头下。判据是 `NewProjectPage.test.tsx` / `ProjectListPage.test.tsx` 的 DOM 顺序断言（提示在页头之后、主体之前）。

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
  - **知识库切片**：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` / `kb_entry_verify` / `kb_generate` 已全部落 Rust；迁移 `20261104000004_kb.sql` 建 `kb_entries` + `kb_entry_revisions`。更新逐字段 diff 留痕（正文截断 120 字符），删除重排 `position` 且不删留痕，核实写 `verified_at` 留痕；生成调模型并按模块产出 `generated` + `pending_review`，命中红线词整批拒绝。
  - **站点档案 / 通道切片**：`site_board` / `site_profile_save` / `site_channel_upsert` / `site_channel_remove` / `site_channel_test` 已落 Rust；迁移 `20261104000005_site_profile_channels.sql` 建 `site_profiles` + `site_channels`。页面清单暂由项目自有页面资产投影（真后端由爬虫发现）。通道自检对边缘函数真发一次 GET，其余通道只报还缺配置 / 凭据；`check_detail` 为结构化 `{ code, params }`。
  - **补丁台账切片**：`site_patch_add` / `site_patch_save` / `site_patch_transition` / `site_patch_history` / `site_patch_delete` 已落 Rust；迁移 `20261104000006_site_patches.sql` 建 `site_patches` + `site_patch_events`。手动补丁三态状态机、发布快照、事件历史、已发布拒删、删除重排 `position` 与事件级联均已落地；`site_patch_generate`（依赖行动中心）与 `site_channel_test`（`check_detail` 需稳定码）仍 demo-only。
  - **站长数据切片（第一段）**：`search_board` / `search_source_upsert` / `search_source_remove` / `search_opportunity_update` / `search_source_test` 已落 Rust；迁移 `20261104000007_search_sources_opportunities.sql` 建 `search_sources` + `search_opportunities`。源目录的 9 个 kind / 分组 / 区域 / 绑定字段 / 凭证引用串全部由 `geo-domain::search` 的目录表推导；自检对可探测源真发一次 HTTP GET，OAuth 源只报缺少授权，人工源不需探测。`check_detail` 已改为结构化 `{ code, params }`（前端 `CheckDetailText` 按词典渲染）。
  - **站长数据切片（第二段）**：`search_metric_import_csv` 已落 Rust，迁移 `20261105000008_search_metrics.sql` 建 `search_metrics` / `search_ai_overviews` / `search_native_extras`。当前**只承诺百度《AI 流量分析》五列**（关键词 / 页面 + 规范列名），支持行级容错、同周期同源覆盖、0 数据行成功、`data_through` 推导与源状态回写；`search_board` 返回真实指标与 AI 汇总。其它源的映射表仍待后续切片。
  - **M3–M7 读路径（第一段）**：`collection_board` / `collection_round_get` / `collection_record_list` / `collection_record_get` 已落 Rust；迁移 `20261105000009_collection_read.sql` 建轮次 / 引擎汇总 / 任务 / 记录 / 引用五张表。采集页可渲染空态或已有数据；写路径（`collection_start` / `collection_task_retry`）与解析 / 诊断 / 行动 / 报告仍 demo-only。
  - **M4 读路径**：`insight_list` / `fact_check_list` 已落 Rust；迁移 `20261105000010_insight_fact.sql` 建 `answer_insights` / `fact_check_issues` / `fact_check_summaries`。解析页可按引擎 / 复核队列 / 提及 / 风险筛选，核查页返回问题清单与汇总。纠正与结办仍 demo-only。
  - **M6 闭环归因（2026-11-05）**：迁移 `20261105000013_action_events.sql` 建处方状态事件账本；`action_update_status` 每次状态变化追加事件，重建看板不清账。当前轮重建时按「上一轮结束 → 本轮结束」窗口取 `done` 事件生成 `AttributionCard`，对照两轮的 Brand Coverage / Top3 / 事实错误数；没有事件不生成卡片。
  - **M6 行动看板自动生成（2026-11-05）**：诊断快照重建后 `ActionService::rebuild_actions` 调 `geo-domain::action_build::build_actions` 生成处方：事实纠错（按字段聚合）、覆盖率不足、推荐位次不足、提及份额 / 竞品反超、无阻塞问题时的复测兜底。动作 id 按「轮次 + 规则键」确定，重建时保留人工改过的 `status` / `completed_at`；模板目录随看板返回，已生成文稿与归因卡片保留。动作标题 / 文案按 `AppSettings.language` 输出中/英文。
  - **M5 诊断快照自动生成（2026-11-05）**：解析完成后 `InsightService::rebuild_diagnosis` 调 `geo-domain::diagnosis_build::build_diagnosis` 重算四份快照：`overview` / `competitors` / `funnel` / `engines`。口径先按本轮最小闭环落地，常量集中在 `diagnosis_build.rs`：五维权重 `[0.30, 0.20, 0.15, 0.25, 0.10]`、引用广度满分 20 个域名、覆盖率下降阈值 10 个百分点、事实准确率下限 0.90、负面占比上限 0.20、竞品反超阈值 5 个百分点。样本量按**不同题目**算；重复采样不重复计样本。告警已读状态按 `(kind, metric, detail)` 在重建时继承，不会被重算洗掉；人工纠正提及 / 结办核查问题后也会立即重算诊断与处方。
  - **M4 自动解析流水线（2026-11-05）**：采集完成后 `InsightService::parse_round` 自动补齐解析：LLM 抽取提及 / 位次 / 情感 / 回答形态 / 风险 / 事实问题 / 引用来源，落 `answer_insights` / `fact_check_issues` / `collection_citations`，并重算 `fact_check_summaries`。解析使用用户当前配置的「模型服务商」，与采集引擎 Key 相互独立；幂等跳过已解析记录，启动续跑会补齐中断的解析。解析失败只记日志、不回滚采集；`REVIEW_CONFIDENCE_FLOOR` 已收进 `geo-domain`，前端测试通过 `test/truth-source.ts` 解析真值源。
  - **M5 / M6 读路径**：`diagnosis_overview` / `diagnosis_competitors` / `diagnosis_funnel` / `diagnosis_engines` / `action_board` 已落 Rust；迁移 `20261105000011_diagnosis_action_read.sql` 建 `diagnosis_snapshots` + `action_boards`。诊断四视图按轮次读整份类型化快照（缺失回 `null` / `[]`），行动看板按项目读快照（缺失回空数组）；写路径与告警已读 / 处方状态仍 demo-only。
  - **采集执行（A 方案）**：`collection_start` / `collection_task_retry` 已落 Rust。只走官方 API，复用「模型服务商」Key 覆盖豆包 / DeepSeek / Kimi / 千问 / 百度五家；元宝 / 秘塔标 `Skipped`。`collection_start` 建轮次 + `题目数 × 引擎数 × 重复次数` 条任务后立即返回，后台顺序执行；`collection_task_retry` 只重跑 `failed` 任务并 +1 尝试次数。采集只落原始回答，提及 / 位次 / 情感仍待 M4 解析。
  - **文章管理（Article Studio）**：10 条 `article_*` 已落 Rust；迁移 `20261105000012_articles.sql` 建方向 / 模板 / 排期 / 文章四张表。方向与文章生成调模型，产物恒 `pending_review`；槽位替换统一走 `geo-domain::article::render_prompt`。没有后台 cron，`next_run_at` 只是显示值；`article_list` 的 review 与 `article_direction_add` 的 id 仍按 demo 契约承担写副作用（E-64 契约债）。
  - **内容生成与站点补丁生成**：`content_generate` / `site_patch_generate` 已落 Rust。两者都调模型并跑红线词扫描，产物恒待审（文稿 `pending_review`、补丁 `draft` + `pending_review`）；模板目录内置在 `geo-domain::action`，补丁通道按类型映射。
  - **本机环境与模型清单**：`app_environment` / `llm_models_list` 已落 Rust。环境事实读真实数据目录、库文件大小与已应用迁移数；三项系统权限没有原生探针，如实回 `not_determined`，`export_dir` 恒 `null`。模型清单按界面草稿地址真发 `GET {base_url}/models`，Key 只读钥匙串。
  - **M7 报告组装**：`report_render` 已落 Rust（`geo-domain::report` + `ReportService`）。从既有诊断快照 / 核查问题 / 行动看板 / 证据记录组装三种版本（老板版只有结论，执行版全节，白标版去掉漏斗与核查明细），`include_evidence` 追加证据附录；不调模型、不生成散文。白标未传 `white_label` 时返回 `null`（demo 回落到种子示例机构），`model_versions` 从引擎汇总的 `model` 去重汇总。
  - **M4 / M5 / M6 本地写路径**：`insight_correct` / `fact_check_resolve` / `diagnosis_alert_acknowledge` / `action_update_status` / `content_update_status` 已落 Rust。人工纠正同步提及明细与证据投影；核查结办维护 `resolved_at` 且保留备注；告警已读改 overview 快照；处方完成时间首次盖章、回退清空；文稿只翻审核态。`content_generate` 与采集执行仍 demo-only。
- 判据：关键词 domain 6 + repo 7 + service 11，FAQ domain 5 + repo 7 + service 11，KB domain 6 + repo 7 + service 14，站点 domain 7 + repo 3 + service 5，补丁 domain 5 + repo 6 + service 8，站长数据 domain 10 + repo 5 + service 17，站点 service 9，采集 domain 0 + repo 6 + service 6，M4 domain 0 + repo 3 + service 4，M5/M6 domain 0 + repo 2 + service 5（+本地写路径）；命令面契约 2 条（Rust）/ 5 条（TS）。

### 2026-11-10 发布工程（许可证 / 签名公证 / CI 发布流水线）

裁定与完整步骤：`docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md`（DR-R1 ~ DR-R11）。
**命令面零变更**（仍 108 = 108 Rust + 0 demo-only），本轮不动 Rust / 前端生产代码。

- **许可证**：定为**专有（All Rights Reserved）**，新增 `LICENSE`；`Cargo.toml` 的
  `license = "UNLICENSED"` 保持不变（SPDX 里这就是「未授予开源许可」的正确表达）。
  补 `SECURITY.md`（漏洞走私密邮箱，含安全不变量与已知风险面）、`CONTRIBUTING.md`、
  `docs/README.md`（文档分级索引 L0–L4）。
- **版本号单一真值源**：`scripts/version.sh`（`get` / `check` / `set` / `next`），
  同步 `tauri.conf.json` + `Cargo.toml` workspace + `ui/package.json` + `Cargo.lock`。
  实测 `set 0.1.1` → `set 0.1.0` 往返后四个文件逐字节还原，且 `Cargo.toml` 只改
  `[workspace.package].version` 一行，依赖版本未被误伤。
- **发布流水线**：新增 `.github/workflows/release.yml`（tag `v*` 触发 + `workflow_dispatch`），
  `preflight` → `create-release`(draft) → `build`(macOS arm64 / macOS x64 / Windows x64)
  → `checksums`(SHA256SUMS + 三平台齐全才转正式发布)。Release 正文模板
  `.github/release-notes-template.md`（含 SmartScreen 如实说明与免责声明）。
  `ci.yml` 的 bundle job 降级为「未签名打包冒烟」，并**修正了产物路径**
  （原写 `apps/desktop/src-tauri/target/…`，实际在 `<repo>/target/release/bundle/`）。
- **签名选型**：macOS = Developer ID Application + App Store Connect API Key 公证
  （不用 Apple ID 专用密码，理由见 DR-R4）；Windows = **Azure Artifact Signing**
  （原 Trusted Signing）+ `artifact-signing-cli`。**EV 证书不再选**：2024 年起 Microsoft
  已取消其 SmartScreen 即时信誉，价格优势消失（DR-R3）。
- **发布门禁**：`scripts/release-check.sh`（9 组检查：必备文件 / 版本一致 / tag 一致 /
  gitignore 覆盖 / 已跟踪文件审查 / 工作区与全历史密钥扫描 / 绝对化用语 / 法务占位符 /
  release.yml 与 §7 清单反向核对）；`scripts/verify-bundle.sh` 核验签名身份 / hardened runtime /
  公证 / staple 票据 / SHA-256。
- **凭据向导**：`scripts/setup-signing.sh`（`mise run signing:wizard`，8 个 stage），
  值写到仓库外 `~/.config/gdk-geo/signing.env`，经 `gh` 写入 Secrets / Variables。
- **实测证据**（Apple Silicon 宿主机）：`tauri build --bundles dmg,app` 3m51s 产出
  `gdk-geo_0.1.0_aarch64.dmg`（8.8 MB）；`verify-bundle.sh` 对该**未签名**产物正确报 FAIL 7 项。
  全 git 历史 1670 个 blob 扫描只命中 3 个测试哨兵串，无真实凭据。
- **本机坑**：`spctl --status` = `assessments disabled`，本地 Gatekeeper 判定**不是证据**；
  且该命令在 disabled 时退出码为 1，配 `pipefail` 会让 `spctl --status | grep -q …` **静默失效**。
- **仍待办**：① 确认 Apple 账号是付费 Program 且本人是 Account Holder；② 跑 `signing:wizard`
  配齐 Secrets；③ ~~Azure Artifact Signing 组织验证~~（2026-11-13 作废：中国大陆主体无公共信任资格，改走 Store MSIX，见本节末 2026-11-13 条目）；④ 补齐
  `SECURITY.md` 安全邮箱与 `docs/legal/*` 的 17 个 `【待填】`（法务复核）；⑤ 干净 Mac /
  干净 Windows 实测（含 Windows 11 Smart App Control）；⑥ 官网下载页；⑦ 自动更新（0.2，DR-R8：
  `createUpdaterArtifacts` 一旦打开就**强制要求** `TAURI_SIGNING_PRIVATE_KEY`，必须五件事同一提交做完）。
- **🔴 写隐私政策时发现两处发布前必修的不一致**（详见发布规格 §9 第 12、13 项）：
  ① 设置页显示的「日志目录」是 `<app_data_dir>/logs`，但 `lib.rs:71` 实际写 `app_log_dir()`，
  macOS 上是两个不同目录 ⇒ 隐私政策的删除指引不准确；
  ② 设置页「数据外发」四个 `share_*` 开关**没有任何业务代码读取**，而文案写的是
  「控制哪些数据在上报诊断时允许离开本机」——**这条上报通道根本不存在**（全仓无遥测），
  对外发布构成误导。两项都受规则 1（TDD）/ 规则 7（双语）/ 规则 8（demo 优先）约束，
  本轮**未夹带修改**，只登记。

### 2026-11-13 Windows 签名改道：Store MSIX 主通道（Azure Artifact Signing 作废）

- **裁定**（发布规格 DR-R3 修订）：中国大陆主体拿不到 Artifact Signing 公共信任（组织限 US/CA/EU/UK、
  个人限 US/CA、组织还需 ≥3 年可验证税务记录）；且两个 Microsoft 账号均**无 Azure 订阅**。
  Windows 主通道改走 **Microsoft Store MSIX**：认证通过后微软重签——免费、无 SmartScreen 警告、
  Smart App Control 开启的机器可装；开发者注册费已取消；非游戏应用可接自有支付并保留 100% 收入。
  直下载 NSIS 通道短期**不签名**（下载页如实写明提示与绕过步骤），后续补商业 CA 的 OV 云签名。
- **帐户实测**：Partner Center 个人开发者帐户状态=活动（卖家 ID 97279770、发布者显示名"众友合"）；
  `稿得快GEO` 名称已保留（Store ID 9MSXNS1VDQ50、PFN `F73A5A8D.GEO_hbxpqea2bc6ae`）。
  首版先用个人帐户跑通；公司帐户（邓白氏编号已取得）后续新建承接品牌——个人→公司**不可转换**。
- **仓库落地**：`release.yml` 新增 `msix` job（`tauri build --bundles none` →
  `scripts/msix-manifest.sh` 渲染清单 → `makeappx pack`；产物**仅** workflow artifact
  `store-msix-x64`，不进 Release asset——未自签 MSIX 在 Store 之外装不了）；清单模板
  `apps/desktop/src-tauri/msix/AppxManifest.xml`（Identity 三要素与 Partner Center 逐字一致）；
  守护测试 `scripts/tests/msix-manifest.test.sh` 接入 `mise run test`；原 Azure 签名两步与六个
  `AZURE_*` 引用从 `release.yml` / `setup-signing.sh` / 规格 §7 全清（§7 行标记作废）。
- **仍待办**：① 补完 Store 提交（商店一览 / 属性 / 年龄分级 / AI 披露）并上传首版 MSIX；
  ② 干净 Windows 机实测容器化数据路径（`Packages\<PFN>\LocalCache\…`）与 SAC 开启态；
  ③ 直下载通道 OV 证书立项（邓白氏即核身材料）；④ 隐私政策删除指引按通道拆分（叠加未决风险 #12）。

## 4. 维护方式

- 命令增删：先改 `apps/desktop/ui/src/api/client.ts` 的 `IPC_COMMANDS` 与 demo 后端，再更新本文「当前命令面」表和差异台账；Rust 侧是否落地以规格/台账为准，不按 demo-only 命令机械补注册。
- 新增里程碑：先写 spec/plan，落地后再回填本文；不要在本文写“计划中”当成“已实现”。
- 发现 demo 与真后端差异：按差异台账 §1 的判据登记，编号从文件末尾续号；本文只做摘要，不替代台账。

### 2026-11-05 Plan C 真实搜索 / 诊断口径 / 设置真相收口

- **采集（M3）**：`CollectionService` 改为“官方搜索 + 该引擎回答”的采样口径：
  - Kimi `POST /v1/tools/search`、百度千帆 `/v2/ai_search/web_search`、豆包搜索 `/search_api/web_search` 先取结构化结果，再用本家对话模型基于结果回答并保存引用；
  - 千问用 Chat Completions 的 `enable_search: true` + `search_options` 单次调用，解析 `search_info.search_results`；
  - DeepSeek 无官方搜索接口，借用 Kimi（优先）/ 百度搜索，通道记 `gateway`；
  - 秘塔用官方 `/v1/search` + 用户当前对话模型，Key 存 `keyring://llm/metaso`（设置页「采集与频控」新增秘塔搜索 Key）；
  - 元宝改为本地 Chrome 浏览器自动化：打开 yuanbao.tencent.com，用户自己扫码登录，提交问题后截图到应用数据目录的 `screenshots/`；不代登录、不绕验证码。
  - 采集引用写入 `collection_citations`；解析阶段不再用模型自述 sources 覆盖已有平台引用，只补空缺。
- **诊断（M5）**：五维权重改回产品定义 `[0.35,0.25,0.15,0.15,0.10]`；推荐力按 Top1/Top3/仅提及加权；情感扣负面；事实准确分母改为涉及本品牌的回答；信源健康按「自有+权威占比×60 + 域名归一×40」。`brand_coverage_margin` / `score_margin` / `TrendPoint.coverage_margin` 改为 **± 区间半宽**（Wilson 95% / 加权和），不再是环比差值。
- **站长机会（M5.5）**：`geo-domain::search_opportunity::build_search_opportunities` 实现 DR-100 六条规则；`search_board` 每次读取先重算并持久化，按 `(rule_id, title_key)` 继承人工 adopted/ignored。
- **站点补丁池（M6.5）**：`site_board.pool` 由行动看板的 ActionCategory 派生；`source_layout` 不生成补丁；Tauri 下生成弹窗可用。
- **设置真相（E-48）**：`AppSettings` 增加 `privacy` / `storage` / `model.protocol`，老库缺字段可读；`app_environment.export_dir` 读 `storage.last_export_dir`；`anthropic` 可保存但调用前报 `unsupported_protocol`；`secret_*` 额外接受搜索专用 `metaso`。
- **报告**：结论区补上一轮环比 `delta`（覆盖率百分点、总分、事实错误数仅在可读时给）。
- **分发**：Tauri bundle targets 改为 `all`；CI 增加 macOS + Windows 的 `workflow_dispatch` 安装包构建（未签名）。
- **仍待办**：百度统计 OAuth、真实站点写回、DOCX/PNG 导出、License/自动更新/DB 加密/诊断日志打包、portfolio_overview / archive v2、采集并发上限（当前顺序执行，已接最小间隔与重试次数）。
