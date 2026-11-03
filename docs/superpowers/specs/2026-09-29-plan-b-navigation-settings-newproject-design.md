# GEO 桌面客户端 · Plan B：导航重构 + 设置页信息架构 + 新建项目双入口 设计规格

> **文档状态**：已按产品负责人 2026-09-29 的回复定稿主体；**§9 有三处本轮新发现的裁定点待过目**
> **关系**：本文件执行 `2026-09-18-geo-desktop-demo-i18n-settings-design.md` 的 **Plan B**（§4.5–§4.9），
> 并**修订**其中与本文冲突的条目（见 §12）；DR-1…DR-10 与 M3–M7 那份 spec 的 DR-11…DR-24 全部沿用。
> **实施计划**：`docs/superpowers/plans/2026-09-29-plan-b-navigation-settings-newproject.md`
> **需求真值源**：`docs/GEO客户端-MVP产品定义-v1.md` §3.3（M1）、§3.10（M8）
> **范围**：**只改前端 demo**（`apps/desktop/ui`）。Rust 侧本轮零改动，新增的差异登记进
> `2026-09-23-demo-vs-backend-known-divergences.md`（编号从 E-46 起）。

---

## 1. 背景与目标

Plan A 交付了 i18n 基座与 demo 假后端，M3–M7 那一轮交付了五个业务页面。但有两块**设计了却没实现**：

- **设置页信息架构**（2026-09-18 spec DR-5 / §4.5）：当时明写「不重构设置页信息架构（Plan B）」，
  所以今天的 `pages/SettingsPage.tsx` 仍是**单页双列卡片**（模型服务商 / 代理 / 采集并发与频控 /
  API Key / 语言与通知），没有左侧二级菜单。
- **外观、权限与隐私、数据与存储**（DR-6 / DR-9 / §4.7 / §4.9）：**一行代码都没落地**——
  `AppSettings` 里没有 `appearance` / `privacy` / `storage` 三个段落，界面上也没有主题、字号、
  权限、数据目录的任何入口。

同时产品负责人在 2026-09-29 提出了**导航与新建项目流程**的调整，这两项不在任何既有 spec 里。

**目标**

- **G1** 导航改成符合桌面应用常规习惯的两级结构：**项目**与**设置**是一级，业务页面是跟随项目的二级。
- **G2** 设置页按 §4.5 落成**左侧二级菜单 + 分段路由**，并补齐外观、语言、权限与隐私、数据与存储、关于。
- **G3** 新建项目支持**两个入口**：填网址自动采集，或手动录入；手动录入的字段与自动采集的产出一一对应。
- **G4** 模型段支持「国内外厂商 + 知名中转站」、**按配置的接口地址与密钥拉取模型列表**、
  自定义服务商可选**协议**。
- **G5** 把 2026-09-29 的 5 条裁定与本轮新增差异**全部落进台账**，不留口头结论。

## 2. 非目标（本轮明确不做）

- 🔴 **扩展段（skill 安装与导入、客服机器人）整体推到二期**（产品负责人 2026-09-29 明示）。
  设置页**不出现**「扩展」这一组；`关于` 段里也**不留置灰占位**——留一个点不动的入口比不出现更容易被当成缺陷。
  👉 这一条**修订**了 2026-09-18 spec §4.5 把扩展放在 `about` 里的设计。
- **服务商档案制（DR-3 的 `provider_profiles` 增删改）不在本轮**：它要新表与迁移，属 Plan C（见 §9-A）。
- **不改任何 Rust 代码**、不加迁移、不加 `#[tauri::command]`。
- **不做真实的权限申请与目录选择**：demo 里这两类按钮**置灰并说明「由桌面端提供」**
  （沿用 M7 对 docx/pdf/png 的既有形态，E-42①）。
- **不做「一键清除数据」**（2026-09-18 spec §4.9 已定为 P0-D）。
- **不引新依赖**：暗色主题走 antd 自带的 `theme.darkAlgorithm`，不引 CSS 框架、不引 color-scheme polyfill。

## 3. 产品负责人的裁定（2026-09-29，逐条留痕）

| # | 裁定 | 落地位置 |
|---|---|---|
| 1 | 「查看和**合并**项目列表」= **展开/收起**（不是项目数据合并） | §5 导航；「＋」放在「项目」这一行最右端 |
| 2 | 「权限（读取、写入权限等）」做成**数据目录**形态，不做字面的读写开关（与 DR-9 一致） | §9-B（本轮把它与「数据与存储」的边界重新划过） |
| 3 | 新建项目按推荐来：第一屏两个大卡片二选一；自动采集演「抓取中 → 抽取中 → 完成 X%」并逐字段确认；手动录入**沿用 5 步向导** | §7 |
| 4 | 设置分组里**暂时取消「扩展」**，作为二期开发功能 | §2、§6 |
| 5 | 上一轮 5 条开放问题的裁定 | 已记进 `2026-09-28-…-design.md` §11 与差异台账 E-40/E-42/E-44/E-45 |

## 4. 决策记录（DR）

编号续 M3–M7 那份 spec（DR-1 … DR-24）。

| # | 决策 | 被否方案与理由 |
|---|---|---|
| DR-25 | 导航用**单棵 antd `Menu`（`mode="inline"`）**表达两级：`项目` 是一个可展开的 `SubMenu`，展开后是项目清单，选中某个项目后**它自己再展开**成 7 个业务二级项；`设置` 是**另一个一级项，用 `Sider` 的底部固定区渲染**（不在 Menu 的 items 里跟着滚） | 用两棵树（上面项目树 + 底部设置按钮）：设置就掉出键盘导航与 `aria` 树了；用 Tabs/顶部导航：与左侧二级菜单的设置页（DR-5）形态打架 |
| DR-26 | 「＋」新建项目**不放进 Menu 的 label 里**，而是渲染在「项目」这一行的**右侧额外槽**（antd `Menu` 的 item `label` 可以是 ReactNode，但点击会冒泡成选中）⇒ 用 `label` 内嵌 `<Button>` + `onClick` 里 `stopPropagation` | 把「＋」做成 Menu 的一个子项（key=`new`）：它会拿到菜单项的选中态与键盘焦点顺序，读屏会念成「新建项目，菜单项 3 of 12」，而它是个动作不是导航目标 |
| DR-27 | 设置页路由 `/settings/:section`，section 用**稳定 slug**（`general` / `models` / `collection` / `storage` / `about`），`/settings` 重定向到 `general` | 用 index 路由（`/settings/0`）：重排就静默错位，与 `wizard-steps.ts` 头注释里那条既有教训同一缺陷类 |
| DR-28 | 分段保存语义按 2026-09-18 spec §4.5：`general` / `collection` / `storage` **即时自动保存**（500ms 防抖），`models` **显式保存**（按钮 + 「有未保存的修改」标记） | 全部显式保存：外观与语言这类偏好要「点了就看得到」，多一次保存按钮只会被读成「没生效」；全部即时保存：模型段的 base_url / Key 半包提交会冲掉别的段落（`settings_update` 是整包写） |
| DR-29 | 外观状态**不进 `AppSettings`**，进 `store/preferences.ts`（localStorage） | 进 `AppSettings`：主题是**首帧**就要确定的事，等 `settings_get` 往返回来才切会闪一次白；且 `AppSettings` 是 Rust 契约，为一个纯前端偏好去改它不划算。🔴 这**修订**了 2026-09-18 spec §4.6 的 `settings.appearance`：改为 `preferences.theme` / `preferences.fontScale` |
| DR-30 | 暗色只走 antd 的 `theme.darkAlgorithm` + `ConfigProvider`，**不新增 CSS class、不改 `src/index.css`**；原生控件的配色用 JS 写 `document.documentElement.style.colorScheme` | 在 `index.css` 里加 `[data-theme='dark']` 选择器：Tailwind 的扫描面与产物选择器集有常驻守卫（`src/tailwind-sources.test.ts`），新增选择器要过审，而 antd 的 CSS-in-JS 已经能覆盖全部组件 |
| DR-31 | `AppLayout` 里 4 处硬编码颜色（`#fff` / `#f0f0f0` ×2 / `#1677ff`）换成 antd token（`colorBgContainer` / `colorBorderSecondary` / `colorPrimary`） | 保留硬编码：暗色下标题栏会是刺眼的白色（2026-09-18 spec §4.6 已点名这 4 处） |
| DR-32 | **界面语言**与**生成内容语言**是两个字段、两个控件，并排放在 `通用 → 语言` 下：界面语言写 `preferences.locale`（`zh-CN` / `en-US`），生成内容语言写 `settings.language`（`zh_cn` / `en_us`，`Language` 联合与 Rust `geo-domain::Language` 今天**都已有这两档**，无需改契约） | 只留一个「语言」：今天 `settings.page.uiLanguage` 的标签写着「界面语言」，绑的却是 `settings.language`（**生成内容**的语言，见 `demo/seed/settings.ts` 头注释「两个『语言』不是一回事」）——这是个**已经存在的错标**，合成一个只会把它固化 |
| DR-33 | 中转站**作为新的 provider id 进预设表**（词典 `settings.providers.*` + 种子 `SEED_SETTINGS.providers`），不做档案制 CRUD | 见 §9-A：这是本轮**待你过目**的裁定点 |
| DR-34 | 拉取模型列表用**新命令 `llm_models_list`**（入参 = 界面上的草稿配置：provider / protocol / base_url + 可选的临时 Key），demo 按 provider 返回**预置清单**并把加载态与失败态演出来 | 复用 `llm_providers`：那条命令回的是 `ProviderInfo[]`（厂商目录），与「某一套具体配置下有哪些模型」是两个问题；塞进去会让它的返回形状变成联合类型 |
| DR-35 | 权限与数据目录用**一条新命令 `app_environment`** 一次给全（`{ app_version, build_number, permissions, storage }`），不拆成 `permission_status` / `storage_info` 两条 | 拆两条：首屏要两次往返，而这两组数据都是「本机环境事实」，同一个概念；「打开目录」与「去系统设置」两个动作**本轮不加命令**（demo 里做不了，按钮置灰说明即可，Plan C 再加 `storage_open_dir` / `open_system_settings` / `permission_request`） |
| DR-36 | 新建项目的自动采集路径**先建项目再抽取**：模式选择屏 → 填网址 → `project_create`（只带 website）→ `entity_card_autobuild` → 跳到实体卡页**逐字段确认** | 先抽取再建项目：`entity_card_autobuild` 的入参是 `project_id`（契约已冻结），要改签名就得动 Rust；而「先建后抽」正好复用 M1 已有的字段状态机（`ai_extracted` → `confirmed`），逐字段确认**不需要新界面** |

## 5. 导航信息架构（DR-25 / DR-26）

```
┌──────────────────────────────┐
│ 稿得快 GEO                    │  ← Header（沿用，颜色改 token）
├──────────────────────────────┤
│ 演示数据横幅                   │  ← DemoBanner（沿用）
├────────────┬─────────────────┤
│ 📁 项目    ＋│                 │
│  ▸ 澜舟除尘 │                 │  ← 展开/收起：点「项目」这一行
│    品牌实体卡│                 │
│    Prompt题库│                │  ← 选中项目后，项目自己再展开成 7 项
│    多引擎采集│                 │
│    解析与核查│                 │
│    诊断与归因│                 │
│    行动中心  │                 │
│    报告与分享│                 │
│  ▸ 宏宇泵业  │                 │
│  ▸ …（归档的置灰）             │
│              │                │
│ ⚙ 设置       │                │  ← Sider 底部固定，不随菜单滚动
└────────────┴─────────────────┘
```

- **未选项目时**：只展开项目清单，7 个业务二级项**不出现**（而不是置灰）——今天的形态是「置灰的 7 项」，
  在两级结构里置灰项会撑出一屏点不动的菜单。
- **点「项目」这一行**：展开/收起项目清单（裁定 1 的「合并」）；**不导航**。项目清单里点某个项目 →
  选中它、展开它的 7 项、并导航到该项目的**品牌实体卡**（M1 是闭环起点）。
- **内容区的 `ProjectListPage` 保留**：搜索、归档、删除、导出、改标签这些**管理动作**放在表格里，
  左侧栏只负责**切换**。路由 `/projects` 仍是它。
- **路由不变**：`/projects`、`/projects/new`、`/projects/:id/{overview,entity-card,prompts,collection,insight,diagnosis,action,report}`、
  `/settings/:section`。左侧栏的选中态照旧由 `location.pathname` 推导。
  > 2026-10-29 追加：`/projects/:id/overview` 是**项目概览首页**，点项目默认落到它（`/projects/:id`
  > 重定向），设计见 `2026-10-29-project-overview-home-design.md`。

## 6. 设置页信息架构（DR-27 / DR-28）

```
/settings/general     通用：外观（主题 / 字号）· 语言（界面语言 + 生成内容语言）· 代理 · 权限与隐私 · 通知
/settings/models      模型服务商：厂商（含中转站）· 协议（仅自定义）· 接口地址 · 拉取模型列表 · 模型名 · API Key · 测试连接
/settings/collection  采集与频控：并发、队列、RPM、最小间隔、重试
/settings/storage     数据与存储：数据库路径与大小、截图目录、日志目录、导出目录、迁移版本
/settings/about       关于：版本、构建号、开源许可
```

🔴 **没有「扩展」这一组**（裁定 4，二期）。

**与 2026-09-18 spec §4.5 的两处差异**：① `about` 里不再放扩展占位；② `general` 里的「权限与隐私」
与独立的 `storage` 段的边界按 §9-B 重划。

**每段一个文件**（AGENTS 代码风格：单文件超约 400 行就拆）：`pages/settings/SettingsLayout.tsx` +
`pages/settings/sections.ts`（slug 清单与词典键，数据与组件分离，手法同 `components/wizard-steps.ts`）+
`pages/settings/{General,Models,Collection,Storage,About}Section.tsx`。
今天的 `pages/SettingsPage.tsx`（357 行）拆完之后只留一个重定向壳。

## 7. 新建项目双入口（DR-36）

**路由**：`/projects/new` = 模式选择屏（新增）；`/projects/new/wizard` = 手动录入（沿用现有 5 步向导）。

```
/projects/new
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ 🌐 填网址自动采集         │  │ ✍️ 手动录入              │
  │ 抓取官网 → AI 抽取实体卡  │  │ 5 步向导，字段与自动采集  │
  │ 你来逐字段确认            │  │ 的产出一一对应            │
  └─────────────────────────┘  └─────────────────────────┘
```

**自动采集路径**（裁定 3）：填网址 → 前端把演示进度分三段播出来（`抓取中` → `抽取中` → `完成 N% 字段`）
→ `project_create` → `entity_card_autobuild` → 跳 `/projects/:id/entity-card`，字段以 `ai_extracted`
状态呈现，用户在那里**逐字段确认**（M1 已有的能力，不需要新界面）。

🔴 **demo 不联网**（AGENTS 规则 2）：进度是**演出**，产物是 `entity_card_autobuild` 今天回的预置实体卡。
界面上必须常驻一句「演示模式不抓取网页，抽取结果是预置数据」——与 M3「不采集」、M4「不跑模型」同一口径。
进度分三段而不是一步到位，是因为**这条链路的等待形态本身就是要验收的东西**（真后端抓取要几十秒）。

**手动录入路径**：沿用 5 步向导（品牌 → 网站与核心页 → 产品与服务 → 地域行业标签 → 竞品），
字段集与 `entity_card_autobuild` 的产出**逐字段对齐**（裁定 3 的「录入信息数据和页面可以根据自动采集流程」）。
👉 判据：`components/wizard-steps.ts` 的 `WIZARD_STEP_FIELDS` 展平后的字段集，必须覆盖
`EntityCard` 里所有 `ai_extracted`/`confirmed` 状态字段的键——这条用测试钉，不靠人眼比。

## 8. 契约变更（前端先冻结，Plan C 落地）

**新增 2 条 IPC 命令**（`IPC_COMMANDS` 60 → 62）：

| 命令 | 入参 | 返回 |
|---|---|---|
| `llm_models_list` | `{ provider, protocol, base_url, api_key? }`（界面上的**草稿值**，Key 可选、只在内存） | `{ models: string[], source: 'preset' \| 'upstream' }` |
| `app_environment` | 无 | `{ app_version, build_number, permissions: { notification, files_and_folders, screen_recording }, storage: { data_dir, db_path, db_size_bytes, screenshots_dir, log_dir, export_dir, migrations_applied } }` |

**`AppSettings` 新增两段**（`api/types.ts`）：

```ts
export interface PrivacyConfig {
  share_entity_card: boolean;   // 默认 true
  share_prompts: boolean;       // 默认 true
  share_crawled_text: boolean;  // 默认 true
  share_diagnostics: boolean;   // 默认 false
}
export interface StorageConfig {
  last_export_dir: string | null;
}
// AppSettings 追加： privacy: PrivacyConfig; storage: StorageConfig;
// ModelConfig 追加： protocol: 'openai_compat' | 'anthropic';
```

🔴 `appearance` **不进** `AppSettings`（DR-29），进 `store/preferences.ts`：
`PreferencesData = { locale, theme: 'light'|'dark'|'system', fontScale: 'sm'|'md'|'lg' }`。

**权限枚举**：`PermissionState = 'granted' | 'denied' | 'not_determined' | 'unsupported'`
（沿用 2026-09-18 spec §4.7）。demo 里三项都回 `'unsupported'`——浏览器**确实**没有这些系统权限，
回 `'granted'` 是假声明。

**provider 预设表扩展**（DR-33，**待 §9-A 过目**）：在现有 6 家 + `custom` 之外增加中转站。

## 9. 🔴 三处待你过目的裁定点

这三处是我在读代码时才发现的，都有既成事实或既有裁定挡在前面，所以单独列出来。
**我按下面的推荐先做**，你若不同意，改动面都局限在单个 task 内。

### A. 中转站怎么进厂商清单（DR-33）

**事实**：`crates/geo-llm/src/provider.rs` 的 `LlmProvider::all()` 今天**恰好 7 个**（6 家 + `custom`），
而 `demo/seed.test.ts` 有一条**漂移守卫**把种子的 provider 表钉在 zh-CN 词典的 `settings.providers` 上
（id 集合、顺序、`label_zh` 逐字）。所以加中转站必然要动其中一侧。

**推荐**：把 5 个中转站作为**新的 provider id** 加进词典与种子（`openrouter` / `siliconflow` /
`302ai` / `yunwu` / `deepbricks`），**不动 Rust**，并在差异台账登记「Rust `LlmProvider::all()` 今天 7 个、
demo 12 个 ⇒ 桌面端会少 5 个，Plan C 必须补齐枚举」。
这与 E-33（20 条命令 demo 独有）是同一套做法：**demo 先冻结契约，Rust 后跟**。

- ✅ 每家有自己的 `provider` id ⇒ 有自己的钥匙串位（`keyring://llm/openrouter`），多家 Key 可并存。
- ⚠ 代价：合并前**桌面端的厂商下拉会少 5 项**（就是 E-33 那类可感知差异）。
- ❌ 被否：把中转站做成 `custom` 的「快捷预设」——不动契约，但 5 家会**共用一个 `custom` 密钥位**，
  用户同时用 OpenRouter 和硅基流动就只能存一个 Key，那是功能性缺陷不是差异。
- ❌ 被否：本轮就做 DR-3 的档案制（用户可增删改厂商）——要新 DTO + 4 条命令 + Plan C 的新表，
  超出「demo 里定稿界面」的范围。**档案制仍是 Plan C 的义务**，本条不减它的责。

👉 **已按推荐执行（2026-09-30）**：词典与种子同批加到 **12** 项（6 家国内厂商 → 5 家中转站 → `custom` 末位），
Rust 一行未动；差异登记为 **E-47**（含 Plan C 的三件落地义务：扩枚举变体、扩 `PROVIDER_ALIASES`、补预设 `base_url`）。
漂移守卫的期望值已跟着改（`demo/seed.test.ts`），每家新 provider 自动长出自己的钥匙串位（`keyring://llm/<id>`）。

### B. 「权限」与「数据与存储」的边界（裁定 2 的落地形态）

你在裁定 2 里把「数据目录（数据库/截图/导出位置 + 更改 + 打开）」和「4 项隐私开关 + 通知权限状态」
一起放进了「权限」。但 2026-09-18 spec §4.7 与 §4.9 是**分开的两件事**，塞进一个面板会让
「权限」这个词同时指「系统授权」和「文件在哪」。

**推荐**：按既有 spec 的线拆开——
- `通用 → 权限与隐私`：**系统权限状态**（通知 / 文件与文件夹 / 屏幕录制）+「去系统设置」跳转（置灰）
  \+ **4 项数据外发隐私开关**。回答的是「这个应用被允许做什么、会把什么发出去」。
- `数据与存储`（独立一级分段）：**数据库路径与大小 / 截图目录 / 日志目录 / 导出目录 / 迁移版本**
  \+「更改目录」「打开目录」（置灰）。回答的是「我的数据在哪、占多大」。

⚠ 若你坚持合成一个「权限」面板，我就把 `数据与存储` 整段并进去、设置页只剩 4 组，改动量差不多。

👉 **已按推荐执行（2026-09-30）**：设置页是 **5 段**（通用 / 模型服务商 / 采集与频控 / 数据与存储 / 关于），
「权限与隐私」（3 项系统权限状态 + 4 项数据外发开关）在 `通用` 段，「数据在哪、占多大」独立成 `数据与存储` 段；
三个桌面端动作（打开目录 / 更改目录 / 去系统设置）置灰并说明。差异登记为 **E-49**。

### C. 「语言」到底是哪一个（DR-32）

**事实**：今天设置页那个下拉的标签写着「界面语言」，绑的却是 `settings.language`——那是**生成内容的语言**
（`demo/seed/settings.ts` 头注释明写「两个『语言』不是一回事」），而且只有一个选项 `zh_cn`，
提示语还写着「P0-A 只做中文，多语言列 P1」。界面语言其实是 `preferences.locale`，
管道（i18n + antd locale + dayjs + localStorage）**已经全建好了，只差一个入口**。

**推荐**：`通用 → 语言` 下并排放**两个**控件——
- **界面语言**：简体中文 / English → 写 `preferences.locale`，**即时生效**（管道已就绪）。
- **生成内容语言**：简体中文 / 英文 → 写 `settings.language`（`zh_cn` / `en_us`，
  `Language` 联合与 Rust `geo-domain::Language` **今天都已有这两档**，不改契约）。

并把错标的 `settings.page.uiLanguage` 改掉。⚠ 两者**刻意不做联动**（界面用英文、内容生成中文是完全合法的组合）。

👉 **已按推荐执行（2026-09-30）**：`通用 → 语言` 下并排两个控件，界面语言写 `preferences.locale`（即时生效、不进库），
生成内容语言写 `settings.language`；错标的 `settings.page.uiLanguage` 与那句过期的「P0-A 只做中文」提示已改掉。
「改一个不动另一个」这条判据在 `pages/settings/GeneralSection.test.tsx` 里**双向**钉住；差异登记为 **E-51**。

## 10. 与真后端的差异（本轮新增，登记为 E-46 起）

1. `llm_models_list` / `app_environment` 两条命令 **demo 独有**（E-33 那一族，20 → 22 条）。
2. provider 预设表 demo **12 项** vs Rust `LlmProvider::all()` **7 项**（§9-A）。
3. `AppSettings.privacy` / `.storage` / `ModelConfig.protocol` 三个字段 **Rust 侧不存在**。
4. `permissions` 三项在 demo 里恒为 `'unsupported'`；「打开目录」「更改目录」「去系统设置」置灰。
5. 自动采集的进度是**演出**，产物是预置实体卡（与 M3「不采集」、M4「不跑模型」同族）。
6. 界面语言（`preferences.locale`）与生成内容语言（`settings.language`）**不同步**，且前者**不进数据库**。

## 11. 测试与守卫影响面

| 守卫 / 测试 | 影响 |
|---|---|
| `i18n/enum-label-prefixes.test.ts` | `EXPECTED_PREFIXES` 39 → 增加 `settings.protocols` / `settings.themes` / `settings.fontScales` / `settings.permissions` / `common.languages` |
| `pages/en-us-page-residual.test.tsx` | 设置页那一条要改成**逐 section** 扫（5 个分段路由）；新建项目模式选择屏要加一条 |
| `i18n/dictionary.test.ts` | zh/en parity 自动覆盖新键；合规扫描清单若按 namespace 登记则要加新 namespace |
| `demo/seed.test.ts` | provider 漂移守卫的**期望值**要跟着 §9-A 改（词典与种子同批改，守卫本身不动） |
| `demo/backend.test.ts` | 键集合相等断言自动跟着 `IPC_COMMANDS` 走（60 → 62） |
| `components/AppLayout.test.tsx` | **重写**：两级菜单、展开/收起、「＋」的 `stopPropagation`、未选项目时二级项不出现 |
| `pages/SettingsPage.test.tsx`（11 条） | **按 section 拆分**到 `pages/settings/*.test.tsx`，断言逐条平移不许丢 |
| `src/index.css` / `tailwind-sources.test.ts` | **不动**（DR-30）：不新增 class、不新增选择器 |

## 12. 对既有文档的覆盖关系

| 被覆盖条目 | 本文的裁定 |
|---|---|
| 2026-09-18 spec §4.5 的 `/settings/about` 含扩展占位 | **删掉扩展**（裁定 4，二期） |
| 2026-09-18 spec §4.6 的 `settings.appearance` | 改为 `preferences.theme` / `preferences.fontScale`（DR-29） |
| 2026-09-18 spec §4.6 的 `localStorage['geo.appearance']` | 合进既有的 `geo.preferences` 一个 key（少一个防闪读取点） |
| 2026-09-18 spec §4.7 的 `permission_request` / `open_system_settings` | 本轮**不加命令**，按钮置灰（DR-35），Plan C 再加 |
| 2026-09-18 spec §4.9 的 `storage_info` / `storage_open_dir` | 合并进 `app_environment`（DR-35）；`storage_open_dir` 推到 Plan C |
| 2026-09-18 spec §4.3 的档案制（DR-3） | **不在本轮**，仍是 Plan C 的义务（§9-A） |
| M3–M7 spec §6 的五页页头形态 | **不变**；只是导航入口从一级变二级 |

## 13. 执行结果回填（2026-09-30）与两处 DR 修订

本节由落地轮补写：Task 1–9 已全部执行，`mise run check` 的门禁数字见差异台账文首的「2026-09-30 增补」那段。
下面只记**与本文原文不一致的地方**，其余一律按原文执行（各 task 的判据都在对应的 `*.test.ts(x)` 里）。

### 13-1 DR-25 修订：底部「设置」是**第二棵 `Menu`**，不是一个裸按钮

本文 DR-25 写的是「单棵 antd `Menu`」，并把「两棵树（上面项目树 + 底部设置**按钮**）」列为被否方案——
被否的理由是"设置会掉出键盘导航与 `aria` 树"。落地时取的是**第三条路**：上面一棵 `Menu`（项目 SubMenu）、
底部另一棵**只有一项的 `Menu`**（设置），各自包一个带 `aria-label` 的 `<nav>`（`nav.projectsAria` /
`nav.settingsAria`）。这样两个约束同时成立：设置固定在底部不跟着滚（DR-25 的目的），
又仍然是**菜单项**、仍在键盘导航与 `aria` 树里（DR-25 的裁定理由）。
👉 判据在 `components/SideNav.test.tsx` ①：用 `nav[aria-label]` 当结构锚点断言"两棵各只有一个一级 `<li>`"，
而不是靠 DOM 顺序（顺序断言在两棵 Menu 都渲染时会假绿）。

### 13-2 DR-36 修订：字段状态机的词表是 `pending → official`，不是 `ai_extracted → confirmed`

本文 §7 与 DR-36 用了 `ai_extracted` / `confirmed` 两个词，**本仓库不存在这两个状态**：
`FieldStatus` 只有 `official` / `pending` / `disputed`（真值源 `crates/geo-domain/src/entity_card.rs:49-54`），
界面上的标签是「官方口径 / 待确认 / 存疑」。裁定本身不变（先建后抽、逐字段确认不需要新界面），
只是词表按真值源改写：抽取出来的字段一律 **`pending`（待确认）**，用户在实体卡里核对后改成 **`official`（官方口径）**。

🔴 顺带修掉一处 demo 与真后端的不一致：`entity_card_autobuild` 给**没有卡的项目**建新卡时，
此前直接照抄种子的 `field_status`（6 个字段一上来就是「官方口径」），与真值源
`entity_card.rs:243-250` 的 `from_extraction`（一律 `FieldStatus::Pending`）不符，也与
「抽出来的字段由你逐个确认」这句界面承诺自相矛盾。现已改成新建卡一律 `pending`
（种子卡自身的混合状态**不动**：那是 M1 状态筛选器的走查数据）。判据在 `demo/handlers/entity-card.test.ts`。

### 13-3 Task 7 的对齐判据按真值源重写（裁定 3 的可执行形态）

本文 §7 给的判据是「`WIZARD_ALL_FIELDS` 覆盖 `ENTITY_FIELD_KEYS`」。这条**照字面写不出来**：
向导收的是 `ProjectDraft` 的 13 个键（品牌名、竞品、行业、标签…），实体卡是 `EntityFields` 的 11 个字段
（成立年份、资质、价格区间…），两套键名本来就不同源，真后端靠 `fields_from_draft`
（`crates/geo-domain/src/entity_card.rs:508-540`）把前者的**一部分**推成后者。
落地时按裁定的**意图**（"录入信息数据和页面可以根据自动采集流程"）重写成四条可执行判据，
在 `components/wizard-steps.test.ts`：

- **A** `WIZARD_ALL_FIELDS` == `ProjectDraft` 的键集（少一个键就建不出合法草稿）；
- **B** 新增的 `DRAFT_TO_ENTITY_FIELDS` 映射表两头都真实存在（草稿键在向导里、实体卡键在 `ENTITY_FIELDS` 里）；
- **C** 「草稿推得出的 6 个」+「只能靠抓取/抽取补齐的 5 个」== 实体卡全部 11 个字段
  ⇒ 两条入口最终落在**同一张卡**上，没有一个字段两边都够不着；
- **D** 反向：每个向导字段要么进映射表、要么被 `PROJECT_ONLY_FIELDS` 点名（竞品、行业、标签这些是项目级资料），
  冒出第三个来历不明的字段就红。

🔴 映射表是**判据的数据面**，不驱动任何运行时行为（AGENTS 规则 9：推导仍在 Rust 的 `fields_from_draft`）。
它镜像真值源，改它必须同时改 Rust——这句话写在 `components/wizard-steps.ts` 的头注释里。

### 13-4 新增的差异条目

本轮 6 条差异登记为 **E-46 … E-51**（§10 那 6 条逐条落地），见差异台账新增的 **§4c**。
其中 E-50 额外记了三件本文没写的事：项目名先用网址 host 占位、抽取成功后用 `standard_name` 回填、
抽取失败时 `project_delete` **回滚**刚建的项目（真后端的 `autobuild` 失败不会删项目）。
