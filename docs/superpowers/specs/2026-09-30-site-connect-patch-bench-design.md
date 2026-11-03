# GEO 桌面客户端 · 站点接入与补丁工作台（M6.5 落地层）设计规格

> 生成日期：2026-09-30 · 分支：`feat/settings-redesign-demo-i18n` · 状态：demo 侧已落地，Rust 侧零改动
> DR 编号续到 **DR-45 … DR-58**；DR-1 … DR-44 全部沿用。
> 上游需求真值源：`docs/GEO客户端-MVP产品定义-v1.md` §3.8（M6 行动中心）与 §3.12（明确不做）。
> 🔴 本轮新增 **11 条命令只有 demo 侧实现**，差异登记见
> `2026-09-23-demo-vs-backend-known-divergences.md` §4e（E-55 … E-57）。

## 1. 需求原文与拆解（2026-09-30）

产品负责人原话：

> demo 的行动中心既然有关于站点的优化方案和整改要求，看如何将站点引入，方便直接根据需要进行修改，
> 可以先调研全球市场是否有成熟方案，方案确定后再调整代码。

拆成四问：

1. **行动中心开出来的处方，落点在哪？** 种子那 10 条里有 4 条 `site_structure` + 2 条
   `fact_correction` 的落点是**客户自己的官网**（补定义句与参数表、上 `llms.txt`、放行 AI 爬虫、
   补 FAQ 区块与 `FAQPage` 标记、资质口径统一、服务承诺页）。今天的界面对这些处方只能做两件事：
   翻状态、生成一份文稿。「文稿 → 官网上真的变了」这一段是断的。
2. **"把站点引入"是什么形态？** 是把站点当成一个可读写的外部系统接进来（连接器），
   还是把站点的**待改点**当成一等对象管起来（补丁台账）？两者代价差一个量级。
3. **全球有没有成熟方案？** 有，而且 2025–2026 这一年正好从"只给建议"跨到"能下发"（§2）。
4. **我们能做到哪一步而不越线？** 产品定义 §3.12 明确 ❌ 自动向第三方平台发布内容、❌ 浏览器插件；
   AGENTS 规则 3 要求密钥永不落库、规则 9 要求 demo 不实现领域算法/不联网。⇒ §3 的裁定。

## 2. 全球市场调研：五条成熟路径

### 2.1 覆盖层 / 边缘写回（**不改 CMS，把补丁叠加在站点之上**）

**Ahrefs Patches**（`ahrefs.com/patches`、帮助中心 `articles/9775727-how-patches-work-in-site-audit`，
2026-09 仍在更新）是这一族最完整的样板，形态几乎就是"行动中心 + 写回"：

- **入口在审计报告里**：可打补丁的 issue 带一个闪电图标，行内直接出现 "Patch it" 输入框；
- **AI 出草案**（"Ask AI" / 批量 "Batch AI"），人做质量控制；
- **状态机 = draft / published / unpublished**，草稿自动保存，发布后可随时撤回；
- **全量历史**（"Show history"：什么时候发布、谁改过草稿）+ 一个专门的 **Patches 报表**
  （按状态与 URL 筛选、可导出、页头显示当前已发布补丁数）；
- **两种下发通道**：
  1. **JS 片段**：往站点每页 `<head>` 里加一小段脚本，脚本去拉 Ahrefs 托管的 JS 文件，
     补丁在**客户端**生效。⚠ 官方自己写明：不执行 JS 的爬虫看不到改动（Google 会渲染，所以通常无碍）；
  2. **Cloudflare Worker**：用户给一个**按 zone 最小授权**的 API token
     （`Account > Workers Scripts: Edit`、`Zone > Workers Routes: Edit`、`Zone > Zone: Read`），
     Ahrefs 用它**一次性**装好 Worker，然后**立刻丢弃 token**（不保留长期访问）；
     Worker 里只有打补丁的逻辑，**补丁数据是 Ahrefs 侧的一个 JSON**，Worker 实时拉取；
     用户手改了 Worker 脚本可以一键 "Redeploy worker"。服务端生效 ⇒ 原始 HTML 也带改动，
     `canonical` / `robots` 这类"两个版本都要对"的标签必须走这一条；
- **当前覆盖面很窄**：首个正式版只支持 **Title 与 Meta description**，redirects / canonicals /
  robots / 内链在路线图上；
- **定位原话**：Patches 是 "a quick and temporary fix" —— 来不及排期开发时先顶上、可回滚，
  最终还是要改回源码。发布动作需要付费加购（Max Project Boost）。

**Scrunch AI 的 AXP / Agent Pages**（GEO 原生，帮助中心 `articles/12845899`，2025-11-15）
把同一思路用在了"给 AI 看的那一份"上：

- CDN 层给 **AI 检索代理**服务一份**AI 优化镜像**，人类访问与搜索引擎收录**完全不变**；
- 客户在自己 Cloudflare 上部署一段 **snippet 规则**，只把 AI UA（`ChatGPT-User`、`OAI-Searchbot`、
  `PerplexityBot`、Meta external agents、`googlebot-extended`、`Applebot`、Mistral、Claude、
  `ScrunchAI-Testbot`）改写到 Scrunch 托管的 origin（形如 `01k962hy…agentxp.net`），
  原始 hostname 用请求头带过去；
- 服务的内容：无 JS 依赖的服务端渲染 HTML、结构化摘要与上下文块、澄清过的实体定义与主张、
  去掉/简化动态组件；
- **审批前跑 pass-through**（AI 拿到的还是人类那一份）；工作流是 Content Delivery 里按
  **URL 路径**新增一份 Markdown/HTML → **Deploy** → 看 Optimized Pages / Active Deployment /
  **Recent System Activity**（操作日志）/ **Version History**（可查看并重部署旧配置）；
- **URL 不变** ⇒ AI 引用指向的还是真实页面，人点引用落到真站；
- 🔴 **对 `llms.txt` 的公开立场**：AXP **不依赖** `llms.txt`，理由是
  "Modern consumer AI systems like ChatGPT, Perplexity, or Gemini do not reliably read or use
  LLMs.txt files"（可按客户要求生成，但默认不必要）。

**Semrush SplitSignal** 是更早的同一传输层先例：靠往站点注入一段脚本做 SEO A/B 分流测试。

### 2.2 CMS 连接器（写回内容管理系统）

- **WordPress REST API + Application Passwords**（WP 5.6+ 内置）是全球也是国内的主流桥：
  「站点 URL + 用户名 + 应用程序密码」→ 推成 **draft** 文章/页面。国内的自动成文工具
  （SEONIB 一类）与大量教程走的都是这条路（或更老的 XML-RPC）。
- 插件族（Rank Math / Yoast / AIOSEO / WordLift / Smart SEO Tool）在 WP 内部改
  title / meta / schema / robots / sitemap；WordLift 走"知识图谱 + JSON-LD"。
- **边界**：只覆盖 WP 站点；改的是**内容**，改不了服务器根目录的 `llms.txt` / `robots.txt`
  （除非插件代管），也改不了模板与结构化标记的落点。

### 2.3 仓库 / AI 编码代理（写回源码）

- **Screaming Frog SEO Spider 22**（2025-09-15）内置 **MCP server**，让 Claude / Cursor 这类
  代理直接驱动爬虫做审计、报告与排期；**Ahrefs** 同样上线了 SEO MCP 与 "Ask Ahrefs"。
- GitHub Copilot coding agent / Codex Cloud / Cursor 背景代理把"改站点"变成一次 **PR**。
- **边界**：要求站点有仓库（Vercel / Netlify / Cloudflare Pages / Astro / Next 这类现代栈）。
  国内中小企业的官网极少满足；但**服务商/代运营**这条客户线（M9）满足度反而高。

### 2.4 落地包 + 人工交接 + 索引推送（零凭据）

- 生成**可上传/可粘贴的静态文件包**与**交接单**，交给站长或外包执行。
  产品定义 §3.8 第 4 类处方已经点名"并可生成本地站点可上传的静态文件包"⇒ 这条不是新发明，
  是把既有承诺做实。
- 索引侧的成熟动作是 **IndexNow**（Bing / Yandex / Seznam / Naver 即时提交，Ahrefs 自动提交）；
  中国侧对应**百度站长平台主动推送 API**（需站点验证 + 配额）。

### 2.5 中国侧的边缘能力与现实约束

- **腾讯云 EdgeOne 边缘函数**：边缘节点上的 Serverless JS，规则引擎可改缓存策略、URL 重写、
  HTTP 头，官方场景就包含 A/B test 与响应改写 ⇒ Cloudflare Workers 的直接对位；
  中国大陆加速需 ICP 备案。**阿里云 ESA / EdgeScript** 同族。
- **现实约束（决定方案的那一条）**：目标客户是"年营收 500 万~5 亿元、市场人员 1~3 人"的中小企业，
  官网常见形态是 ① 建站 SaaS（凡科 / 上线了 / 云·企业官网，基本无公开写 API）、
  ② 传统 CMS（WordPress / dedecms / 帝国）、③ 虚拟主机 + FTP、④ **外包代管**
  ——客户自己常常**没有服务器权限**。这决定了"必须改源码"的路径不可能当默认路径。

### 2.6 调研结论

1. **没有"一键改站"的银弹**：Ahrefs 把写回做成了"**临时的、可回滚的覆盖层**"，
   而且首版只敢碰 title / meta description；Scrunch 干脆**不改站点**，只在 CDN 层给 AI
   另发一份。两家都选择"**不动客户的源码与 CMS**"。
2. **成熟产品的共同点**（我们照抄的四件事）：
   **AI 出草案 + 人审**、**draft/published/unpublished 三态**、**全量操作历史与版本回退**、
   **下发通道与内容解耦**（同一份补丁可以走 JS 片段、边缘函数，也可以只导出成文件）。
3. **凭据的最小化纪律值得逐字抄**：按 zone 最小授权的 token、**用完即弃**、
   逻辑在客户侧而数据在我们侧、可一键重新部署。
4. **`llms.txt` 要降调门**：Scrunch 的公开立场与我们的处方 `demo-act-002` 有张力。
   裁定：**保留**该处方（放行 AI 爬虫那半边是硬收益），但在补丁的 `target_hint` 与
   落地包说明里写清"`llms.txt` 目前主要被开发者类工具与部分检索层读取，消费级 AI 助手
   不保证读取"⇒ 不夸大（AGENTS 规则 6 的同族纪律）。

## 3. 方案裁定（DR-45 … DR-50）

- **DR-45 · 引入的是"补丁台账 + 下发通道"，不是"站点写回引擎"**。
  新增两个一等对象：`SitePatch`（一条**可下发、可撤回、可回滚、带历史**的站点改动）与
  `SiteChannel`（这个项目的站点**能被怎样改**）。MVP **不真下发**：`publish` 只翻状态、
  记事件、并把补丁渲染成可交付的文件。
  理由：① 客户站点大多不由客户自己改（§2.5），**零凭据的落地包**是唯一人人可用的通道；
  ② 真下发要托管长期凭据，与规则 3 的风险预算不匹配；③ Ahrefs 也是先把"台账 + 状态机 + 历史"
  做扎实，下发通道只有两种且都可随时关掉。
- **DR-46 · 四条下发通道**（`SiteChannelKind`）：
  `bundle` 落地包（默认，零凭据）/ `cms` WordPress 连接器 / `edge` 边缘函数
  （Cloudflare Worker · 腾讯云 EdgeOne · 阿里云 ESA）/ `repo` 仓库与 AI 编码代理。
  🔴 **不做浏览器插件**（§3.12 ❌）；🔴 **不做站外平台自动发布**（§3.12 ❌）⇒
  `source_layout` 类处方（补百科词条、行业媒体稿、B2B 平台报价）**不进补丁台账**，
  界面上置灰并说明"这条落在站外平台"。
- **DR-47 · 补丁状态机三态 + 一条命令**（`site_patch_transition`）：
  `draft → published → unpublished`，外加 `rollback`（把草案恢复成上一次发布的快照）。
  三个动作共用同一条命令：它们都是"校验 → 翻状态 → 可能改快照 → 记一条事件"，
  拆三条就要把守卫抄三遍（同 `action_update_status` 只有一条的口径）。
  🔴 **编辑已发布的补丁不会自动撤回它**：改的是 `body`（草案），`published_body`（上次发布的
  快照）原样保留，界面据 `body !== published_body` 派生出"有未发布的修改"标记。
  这比 Ahrefs 的自动草稿更显式，也不会让"我改了两个字符"静默改变线上状态。
- **DR-48 · 凭据一律不进 demo，也不进库**（规则 3）。
  `SiteChannel` 只存**非敏感**配置（站点 URL、用户名、Worker 路由、仓库地址）与一个
  `secret_ref` 引用串；`credentials_state` 三档 `not_required` / `missing` / `stored`，
  demo 里**永远不会是 `stored`**，界面上明写"演示模式不收任何密码与 token"。
  真后端要落这一条，需要把 `secret_set` 从 `provider` 泛化到 `(kind, subject)`
  （新增 `keyring://site/<kind>/<project_id>`）⇒ 已登记为差异 E-56。
- **DR-49 · 站点档案与页面清单是"引入站点"的最小闭环**。
  `SiteProfile`（域名 / 建站形态 / 谁在管这个站 / 备注）+ `SitePage[]`
  （URL / 角色 / 标题 / 最近自检时间 / 是否可抓）。页面清单在 demo 里是**静态预置**
  （规则 9：真后端由爬虫发现），它的作用是让补丁的 `target_url` 有一份**可选清单**，
  而不是让用户手打 URL。
- **DR-50 · 与行动中心双向咬合**：
  处方行多一个「站点补丁」入口 → 跳到 `/projects/:id/site?from=<action_id>`，
  站点页据此**自动打开生成弹窗**并预选那条处方；补丁行反过来显示它来自哪条处方、
  可跳回行动中心。闭环归因因此多一条可核的链：处方 → 补丁 → 发布事件 → 下一轮复测。

## 4. 契约：DTO（`api/types-site.ts`，DR-51）

- **DR-51 · 枚举与形状**（全部 snake_case，与 serde 同形；每个枚举都配 `*_VALUES` 运行时清单
  与 `AssertComplete` 编译期网，照 `types-library.ts` 的既有做法）：

| 枚举 | 取值 | 说明 |
| --- | --- | --- |
| `SitePlatform` | `wordpress` / `static` / `custom` / `saas_builder` / `ecommerce` / `unknown` | 建站形态；决定哪几条通道可行 |
| `SiteOwnership` | `self` / `agency` / `no_access` / `unknown` | 谁在管这个站；`no_access` ⇒ 只能走 `bundle` |
| `SiteChannelKind` | `bundle` / `cms` / `edge` / `repo` | DR-46 的四条通道 |
| `SiteChannelStatus` | `not_configured` / `pending_verify` / `ready` / `failed` | 通道状态 |
| `SiteCredentialsState` | `not_required` / `missing` / `stored` | DR-48；demo 恒不为 `stored` |
| `SitePatchKind` | `llms_txt` / `robots_txt` / `jsonld` / `html_fragment` / `meta_title` / `meta_description` / `canonical` / `alt_text` / `internal_link` / `entity_consistency` | 前 3 类对应处方里点名的 `llms.txt` / `robots.txt` / `FAQPage` 标记；`entity_consistency` 对应"三处口径一致" |
| `SitePatchStatus` | `draft` / `published` / `unpublished` | DR-47 |
| `SitePatchTransition` | `publish` / `unpublish` / `rollback` | `site_patch_transition` 的入参 |
| `SitePatchEventKind` | `created` / `saved` / `published` / `unpublished` / `rolled_back` / `exported` | 历史事件 |

  DTO：`SiteProfile` / `SitePage` / `SiteChannel` / `SitePatch` / `SitePatchEvent` /
  `SitePatchDraft` / `SiteBoard`（一次往返拿全五块，照 `action_board` 的取舍）。
  `SitePatch.review_status` **复用** `ContentStatus`（AI 生成默认 `pending_review`，规则 6）；
  `SitePatch.source` **复用** `LibrarySource`（`manual` / `generated` / `imported`）。
  🔴 两个复用都是刻意的：再造一套同形枚举就是 `entity.contentStatuses` 那个已被收掉的缺陷类。

## 5. 命令面（11 条，DR-52）

- **DR-52** · `IPC_COMMANDS` 由 72 → **83**。逐条：

| 命令 | 入参 | 返回 | 备注 |
| --- | --- | --- | --- |
| `site_board` | `project_id` | `SiteBoard` | profile + pages + channels + patches 一次拿全 |
| `site_profile_save` | `project_id, platform, ownership, note` | `SiteProfile` | 页面清单不在这里改（DR-49） |
| `site_channel_upsert` | `project_id, kind, endpoint, username, note` | `SiteChannel` | 同 kind 覆盖；🔴 不收凭据（DR-48） |
| `site_channel_remove` | `project_id, kind` | `SiteChannel[]` | 幂等；回**剩余快照** |
| `site_channel_test` | `project_id, kind` | `SiteChannel` | 🔴 demo 回**预置自检结果**，不联网（规则 9） |
| `site_patch_generate` | `project_id, action_id, kinds` | `SitePatch[]` | 从预置池按处方挑；回**新增那几条** |
| `site_patch_add` | `project_id, draft` | `SitePatch` | 手动新建；`source` 由后端固定 `manual` |
| `site_patch_save` | `patch` | `SitePatch` | 就地改草案；不动 `published_body`（DR-47） |
| `site_patch_transition` | `patch_id, transition` | `SitePatch` | DR-47 的三态 |
| `site_patch_history` | `patch_id` | `SitePatchEvent[]` | 时间正序 |
| `site_patch_delete` | `project_id, ids` | `SitePatch[]` | 幂等；回**剩余快照** |

  **刻意不加的命令**：导出（复用 `export_write_file`）、页面清单（读既有 `asset_list` 与
  `site_board`）、凭据（复用 `secret_*` 的形状，真后端泛化）、处方（复用 `action_board`）。

## 6. 导出物（前端组装 + 既有 `export_write_file`，DR-53）

- **DR-53** · `api/site-compose.ts` 组装五种产物，全部走既有落盘命令（同 `library-compose.ts`）：
  1. **落地包清单**（`geo-site-bundle-<project>.md`）：按补丁分节的 Markdown，每节含
     目标 URL、贴在哪、正文、验收动作 —— 给外包/站长的**交接单**；
  2. **`llms.txt`**（`geo-llms-<project>.txt`）：只收 `kind === 'llms_txt'` 且
     `review_status === 'approved'` 的补丁；
  3. **`robots.txt` 放行片段**（`geo-robots-<project>.txt`）：只收 `robots_txt`；
  4. **`patches.json`**（`geo-site-patches-<project>.json`）：边缘函数实时拉取的那份数据，
     形状照 Ahrefs 的分工（逻辑在客户侧、数据在我们侧）；
  5. **边缘函数代码**（`geo-site-worker-<project>.js`）：一段可读的 Worker 骨架，
     顶部注释写明 Cloudflare / EdgeOne / ESA 三家的落点差异与"token 用完即弃"的纪律；
  6. **发布留档 CSV**（`geo-site-log-<project>.csv`）：补丁 × 事件的扁平表，
     给"谁在什么时候把什么改上线了"留证据（对齐 M7 的证据附录思路）。
  🔴 **2/3/4 只收 `review_status === 'approved'`**（照 `composeFaqJsonLd` 的口径，规则 6）：
  待审的 AI 草案不该被贴到官网上。零条可用时回 `null`，界面置灰并说明原因。
  🔴 文件名一律 ASCII（下载属性里的中文会掉，`report-compose.ts` 同一条纪律）。
  🔴 组装函数需要的**界面文案**（节标题、表头、免责声明）由调用方经 `t()` 传进来，
  `site-compose.ts` 自身不含中文（照 `report-compose.ts`）。

## 7. UI 与导航（DR-54）

- **DR-54** · 新增二级项 **站点接入**（`nav.site`），路由 `/projects/:id/site`，
  排在 `action` 之后、`report` 之前：闭环顺序变成
  实体卡 → 关键词库 → FAQ 库 → 题库 → 采集 → 解析 → 诊断 → **行动 → 站点接入** → 报告。
  页面四块（自上而下）：
  1. **站点档案**：域名（只读，来自 `Project.website`）、建站形态、谁在管、备注、
     页面清单表（URL / 角色 / 标题 / 最近自检 / 是否可抓）；
  2. **落地通道**：四张卡（状态标签 + 配置 + 「自检」按钮 + 一句"这条通道能做什么/需要什么"）；
  3. **补丁工作台**：筛选（状态 / 类型 / 通道 / 落点或标题搜索）+ 表格（目标页面、类型、状态、通道、
     "有未发布的修改"标记、审核态）+ 展开行（草案正文、`target_hint`、来自哪条处方）
     + 行内动作（编辑 / 发布 / 撤回 / 回滚 / 历史 / 删除）+ 工具条
     （从处方生成、手动新建、导出、删除选中）。
     🔴 展开行里**刻意没有**"最近事件"：`site_patch_history` 是按补丁查的（没有批量口径），
     给一张 8 行的表配 8 次查询去换一个折叠起来看不见的信息不值；
     历史在行内那个「历史」按钮里一次看全。
  4. **常驻提示**：`site.staticNote`（页面清单与自检结果是预置静态值）与
     `site.demoBody`（演示模式**不会**真的改到线上站点）。
  🔴 `source_layout` 类处方在行动中心里那个「站点补丁」按钮**置灰**并带 tooltip 说明（DR-46）。

## 8. i18n（DR-55）

- **DR-55** · 新增 namespace `site`（zh-CN / en-US 各一份，`locales/*/index.ts` 同步）。
  `enumLabel` 前缀新增 **13** 个 ⇒ `i18n/enum-label-prefixes.test.ts` 的钉死清单 46 → **59**：
  10 个枚举表（`site.platforms` / `site.ownerships` / `site.channelKinds` /
  `site.channelStatuses` / `site.credentialsStates` / `site.patchKinds` / `site.patchStatuses` /
  `site.eventKinds` / `site.pages.roles` / `site.export.kinds`）
  + 3 张**散文表**（`site.channels.about` / `site.channels.endpointPlaceholder` / `site.export.about`
  ——它们端的是一整句说明而不是枚举标签，但取值同样经 `enumLabel`，故一并进钉死清单）。
  审核态**复用** `action.contentStatuses`（不新增前缀，DR-51）。
  插值变量一律不叫 `count`（i18next 会走复数分支）。

## 9. 🔴 demo 的能力边界（规则 9 / 规则 3 / 规则 6，DR-56）

- **DR-56** · 六件 demo **不做**的事，界面上都要写清楚：
  1. **不真下发**：`publish` 只翻状态 + 记事件；线上站点一个字节都不会变（`site.demoBody` 常驻）；
  2. **不联网自检**：`site_channel_test` 回种子里预置的结论（规则 2 测试禁止联网的同族纪律）；
  3. **不发现页面**：`SitePage[]` 是静态预置，真后端由爬虫发现（规则 9）；
  4. **不生成补丁正文**：`site_patch_generate` 从**按处方预置**的池子里逐字端出，不调模型；
  5. **不收凭据**：任何密码 / token 都不进内存、不进库、不进错误 params（DR-48）；
  6. **不算收益**：补丁不承诺"改完提及率涨多少"，归因仍只看 M6 的对照卡片（规则 6）。

## 10. 数据与种子（`demo/seed/site.ts`）

- 1 份档案（澜舟：`custom` + `agency`，备注写明"服务器由外包代管，客户只有 CMS 后台账号"）；
- 6 个页面（首页 / 产品页 / 资质页 / 服务页 / 关于 / 新闻详情，URL 与 `SEED_ASSETS` 的
  `owned_page` 同域同路径口径）；
- 4 条通道（`bundle` = `ready`、`edge` = `pending_verify`、`cms` / `repo` = `not_configured`）
  + 每条一份预置自检结论；
- **8** 条补丁（6 已发布 / 1 已撤回 / 1 草案）+ **17** 条事件，逐条挂回既有处方，
  且**发布时间与处方的 `completed_at` 对齐**：`demo-act-001` → `html_fragment` 已发布
  + `meta_description` 已撤回（被外包换模板覆盖）；`demo-act-002` → `llms_txt` + `robots_txt` 已发布；
  `demo-act-003` → `entity_consistency` 已发布（手动录入）；`demo-act-004` → `jsonld` 草案 + 待人工审核；
  `demo-act-007` → `html_fragment` 已发布；`demo-act-010` → `html_fragment` 已发布
  ⇒ 归因卡片、处方状态与补丁台账三者横看竖看不矛盾；
  🔴 已发布那几条的 `published_body` 由不变式**派生**（`= body`），不在种子行里抄第二遍：
  几百字的 HTML / JSON-LD 抄两遍必然漂移，改了一处忘了另一处，回滚就会把补丁滚回一个旧版本；
- 一个**按处方分组的生成池** `SEED_SITE_PATCH_POOL`（`Record<action_id, rows[]>`）：
  没进池子的处方 ⇒ 生成回**空数组**，界面提示"这条处方没有可用的补丁模板，请手动新建"。
  🔴 池子里的 `body` 是**字面量**代码/文案，绝不程序化拼（规则 9 的同族纪律，
  照 `PromptSeedRow.text` 的要求）。

## 11. 测试与守卫影响面（判据只增不减）· 含落地回填

### 11.1 本轮新增的三份测试

- `demo/handlers/site.test.ts`（29 例）+ `demo/handlers/site-patch.test.ts`（41 例）：
  11 条命令的正/反路径（认不出的 id ⇒ `validation/failed`、删除幂等、`transition` 的三个动作、
  `published_body` 快照与回滚、事件按时间正序、🔴 错误 params 里绝不出现凭据字段）；
- `api/site-compose.test.ts`（25 例）：六种产物的形状 + **只收 `approved`**（`patches.json` 只收
  `published`）+ 零条可用回 `null` + 文件名全 ASCII + 🔴 Worker 骨架**代码全 ASCII**
  （中文只出现在顶部三行注释里，且 zh/en 两版除注释外逐字相同）；
- `pages/SitePage.test.tsx`（22 例）：四块渲染、四个筛选、三个动作的置灰理由、
  审核 → 发布 → 撤回 → 回滚 → 删除的完整生命周期、`?from=<action_id>` 自动开弹窗并抹参数、
  `source_layout` 与"池子里没有"两种空态、两个导出物的口径。

### 11.2 既有守卫的**钉死数字**（括号里是落地后的真值）

- `demo/backend.test.ts`：命令面本轮 +11 条 ⇒ 72 → 83；🔴 与 M1.2 知识库那一轮在同一个工作区
  **并行**落地，两轮都收口后实际钉的是 **90**；
- `i18n/enum-label-prefixes.test.ts`：46 → **59**（13 个新前缀，构成见 DR-55）；
- `components/SideNav.test.tsx`：9 → **10** 个二级项（「站点接入」插在行动中心与报告之间）；
- `i18n/dictionary.test.ts`：合规扫描面 15 → **16** 个 namespace（+`site`；与 M1.2 那轮并行后是 17）；
- `i18n/no-hardcoded-strings.test.ts`：components **63** 个文件（57 个 .tsx）、pages **23** 个、
  扫描面合计 **88**、`DEMO_SEED_EXPECTED` **19**（+`seed/site.ts`）；
- `pages/en-us-page-residual.test.tsx`：`seed/site.ts` 进减法清单（18 个 seed 模块）⇒
  `DATA_STRINGS` 真值 585 → **652**，上界按本文件既有的 +15% 留白抬到 **750**；
  🔴 短尾（≤4 字）**一条没变**——补丁正文里的 `项目` / `过滤风速` 这些短词是整段正文的**内部片段**，
  而减法清单收的是种子导出的**整串**，所以 M-1 那个风险面没有变宽；
  🔴 对照组（②③）改用 `CONTROL_DATA_STRING`（一条不含标记的数据串）而不是 `DATA_STRINGS[0]`：
  最长的那条现在是**字面量 HTML** 补丁正文，用 `innerHTML` 注入会被解析成真 DOM、一个 `<div>`
  炸成几十个文本节点，对照组会假红（页面上不会这样：正文走 `<pre>{row.body}</pre>`，是单个文本节点）；
  另加一条 SitePage 的 en-US 用例（标题 `Site Connect`）。
- `demo/seed.test.ts`：时间戳总数 → **230**（其中站点接入 48 条）；新增一整组
  「补丁 ↔ 处方 ↔ 归因三者自洽」判据（12 例）：id 唯一 / position = 数组序、`action_id` 都能解析、
  🔴 `done` 的处方名下必有一条已发布且 `published_at` 逐字等于 `completed_at`、
  🔴 `todo`/`in_progress` 的处方名下**只可能有草案**、已发布 ⇒ `published_body === body`、
  生成池与台账按 `(action_id, kind, target_url)` 互斥、`source_layout` 两侧都不出现、
  域名是 `SEED_PROJECTS[0].website` 的镜像、事件时刻只可能是补丁的三个时间戳之一。

### 11.3 🔴 落地时被测试逼出来的两处**生产代码**修改

1. `components/SiteProfileCard.tsx`：删掉外部的 `Form.useForm()` 实例。
   `key={profile?.id ?? 'none'}` 那个 remount 技巧**原本是白做的**——rc-field-form 的 store 活在
   hook 里、不随 `<Form>` 的 remount 重建，remount 时 `setInitialValues(values, true)` 走的是
   `setValues({}, initialValues, store)`，**旧 store 压在新 initialValues 之上**。
   首屏档案还没到，store 里已经写进 `platform: 'unknown'`；等真档案到了、`key` 变了、`<Form>` 重挂了，
   三个下拉仍然是「尚未确认」。不传 `form` 让每次挂载各自建 store，`key` 才有意义。
2. `demo/handlers/site-patch.ts` 的 `rollback` **不改** `status`（原设计文案写的是"状态回 `draft`"，
   已在 §12 第 4 条改掉）：rollback 只把**草案**拉回上次发布的快照，线上那一版从头到尾没动过，
   把状态翻成 `draft` 等于谎称"这处改动没上线"——而它明明还在线上生效。

## 12. 走查清单（`mise run web`）

1. 行动中心 → `demo-act-008`（术语页）那行点「站点补丁」→ 落到站点接入页，生成弹窗已预选该处方；
   🔴 别拿 `demo-act-002` 走这一步：它名下那两条（`llms_txt` / `robots_txt`）早已发布、**不在生成池里**
   （池子与台账按 `(action_id, kind, target_url)` 互斥），点下去只会得到「已经都在台账里了，没有新增」；
2. 勾上 2 类（`html_fragment` / `jsonld`）生成 ⇒ 表格里出现两条 `draft` + `pending_review`；
3. 把其中一条的审核态翻成「已通过」（这一步自己也会留一条 `saved` 事件）⇒「发布」解禁；
   点发布 ⇒ 状态 `published`、`published_body` 落成快照、事件多一条；
4. 撤回 ⇒ `unpublished`；改一条已发布补丁的正文 ⇒ 行上出现「有未发布的修改」且「回滚草案」解禁；
   回滚 ⇒ 草案恢复成上次发布的快照，🔴 **状态仍是 `published`**（线上那一版从头到尾没动过，
   翻成 `draft` 等于谎称「没上线」）；
5. 历史抽屉 ⇒ 事件按时间正序，每条都能看出是谁（哪个动作）在什么时候做的；
6. 导出落地包 ⇒ 预览里能看到交接单正文；导出 `patches.json` 与 Worker 代码 ⇒ 可下载；
7. `source_layout` 类处方（`demo-act-005`）的「站点补丁」按钮**置灰**，tooltip 说明理由；
8. 通道卡：`bundle` 显示"无需凭据"；`cms` / `edge` 显示"演示模式不收凭据"；自检按钮回预置结论；
9. 切 en-US：整页除数据外无中文；
10. 刷新页面 ⇒ 一切回种子（`resetDemoDb`）。

## 13. 与真后端的差异登记

见 `2026-09-23-demo-vs-backend-known-divergences.md` **§4e（E-55 … E-57）**：
E-55 = 11 条命令 Rust 侧一条都不存在（"demo 独有命令"这一族 32 → **43**）；
E-56 = 凭据面（`secret_set` 只认 `provider`，站点通道需要新的 `kind`）；
E-57 = 自检与页面清单是静态值（规则 9）。

## 14. Plan C：真后端落地路线

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| P0 | `site_profile` / `site_page` / `site_patch` / `site_patch_event` 四张表 + 迁移；11 条命令按本契约实现；`secret_set` 泛化到 `(kind, subject)`；落地包组装落进 Rust（`csv_io.rs` 同族） | 本轮冻结的契约 |
| P1 | **真下发**第 1 条通道：`edge`（Cloudflare Worker 一次性安装 + token 用完即弃 + `patches.json` 托管）；`repo`（生成 diff 与交接 Prompt，仍由用户提 PR） | 客户侧云账号 |
| P2 | `cms`（WordPress REST + 应用密码，**只写 draft**）；IndexNow / 百度主动推送；补丁效果与下一轮复测的自动归因 | P1 的凭据面 |
| 不做 | 浏览器插件、站外平台自动发布、代管客户长期凭据、无审批的自动上线 | §3.12 ❌ |
