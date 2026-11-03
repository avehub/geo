# Plan B · 导航重构 + 设置页信息架构 + 新建项目双入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在**纯前端 demo** 里把导航改成「项目 / 设置」两级结构、把设置页落成左侧二级菜单的五分段形态（补齐外观、语言、权限与隐私、数据与存储、关于），并给新建项目加「填网址自动采集 / 手动录入」双入口。

**Architecture:** 沿用 Plan A 的运行时形态（`api/client.ts` 单点分派 → Tauri `invoke` 或 `demo/backend.ts`）。外观偏好走 `store/preferences.ts`（localStorage，首帧前同步读，不进 `AppSettings`）；设置页拆成 `/settings/:section` 五段、每段一个文件；新增 2 条 IPC 命令（`llm_models_list`、`app_environment`），demo 侧给内存实现，Rust 侧**本轮零改动**、差异登记进台账 E-46 起。

**Tech Stack:** 不引新依赖。React 19.3 / antd 5.29.3（暗色走 `theme.darkAlgorithm`）/ zustand（既有）/ react-router-dom（既有）/ Vitest 5 + Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md`（DR-25…DR-36、§5 导航、§6 设置、§7 新建项目、§8 契约、§9 三处裁定点）。上游：`2026-09-18-geo-desktop-demo-i18n-settings-design.md` §4.5–§4.9（本文按 spec §12 修订其中 6 条）。

## Global Constraints

- **TDD**：先写失败测试跑红，再写最小实现（AGENTS.md 规则 1）。
- **测试禁止联网**：demo 后端不发任何网络请求；「拉取模型列表」「自动采集」都是预置数据 + 演出（AGENTS.md 规则 2、spec §7）。
- **密钥永不落库、永不入日志**：`llm_models_list` 的临时 Key 只在内存里传，不落库、不进日志、不进错误信息（AGENTS.md 规则 3）。
- **文案合规**：中英双语都禁用绝对化用语；生成内容默认 `PendingReview`（AGENTS.md 规则 6）。
- **UI 不得硬编码自然语言**：一律 `t()`；枚举标签一律 `enumLabel(t, '<prefix>', id)`，新增前缀要同步 `i18n/enum-label-prefixes.test.ts` 的 `EXPECTED_PREFIXES`（AGENTS.md 规则 7）。
- **demo 不实现领域算法**：字段完整率、抽取结果只呈现预置静态值（AGENTS.md 规则 9）。
- **命令契约单一真值源**：`IPC_COMMANDS`（`src/api/client.ts`）+ `Record<IpcCommand, DemoHandler>`（`src/demo/backend.ts`），增删命令两侧同时改（AGENTS.md 规则 8）。
- **不动 CSS**：不新增 class、不新增 `src/index.css` 选择器（spec DR-30，守卫在 `src/tailwind-sources.test.ts`）。
- **文件聚焦**：单文件超约 400 行就拆（AGENTS.md 代码风格）。`pages/SettingsPage.tsx` 今天 357 行，拆完只留重定向壳。
- **不改 Rust**：`crates/**` 与 `apps/desktop/src-tauri/**` 本轮一行不动；因此 `mise run check` 的 cargo 部分应与上一轮**同一基线**（22 targets / 515 passed）。
- **门禁**：`mise run check` 全绿才算完成。前端单测用 `cd apps/desktop/ui && ./node_modules/.bin/vitest run --reporter=dot <file>`（**没有** `basic` reporter）。
- **提交**：Conventional Commits，一个 task 一次提交，信息说明「做了什么 + 为什么」；不 push、不改 remote（AGENTS.md 规则 10）。
- **不做的事**：扩展段（skill / 客服机器人）推二期；服务商档案制（`provider_profiles` CRUD）推 Plan C；不加 `storage_open_dir` / `open_system_settings` / `permission_request` 三条命令（按钮置灰）；不做「一键清除数据」。

---

### Task 1: 外观基座（主题 + 字号）

**Files:**
- Modify: `apps/desktop/ui/src/store/preferences.ts`
- Create: `apps/desktop/ui/src/theme/appearance.ts`
- Modify: `apps/desktop/ui/src/Root.tsx`
- Modify: `apps/desktop/ui/src/main.tsx`
- Modify: `apps/desktop/ui/src/components/AppLayout.tsx`
- Test: `apps/desktop/ui/src/store/preferences.test.ts`（追加）
- Test: `apps/desktop/ui/src/theme/appearance.test.ts`（新建）
- Test: `apps/desktop/ui/src/components/AppLayout.test.tsx`（追加 token 断言）

**Interfaces:**
- Produces: `type ThemeMode = 'light' | 'dark' | 'system'`、`type FontScale = 'sm' | 'md' | 'lg'`、`THEME_MODES`、`FONT_SCALES`、`FONT_SCALE_PX: Record<FontScale, number> = { sm: 13, md: 14, lg: 16 }`、`isThemeMode(v)`、`isFontScale(v)`
- Produces: `PreferencesData = { locale: Locale; theme: ThemeMode; fontScale: FontScale }`；`defaultPreferences()`；`readStoredPreferences(): PreferencesData`（**替换**今天的 `readStoredLocale`，容忍只有 `locale` 的旧 payload）；store 增 `theme` / `fontScale` / `setTheme` / `setFontScale`；`resetPreferencesStore()`
- Produces: `themeConfigFor(dark: boolean, fontScale: FontScale): ThemeConfig`（`{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { borderRadius: 6, fontSize: FONT_SCALE_PX[fontScale] } }`）
- Produces: `useResolvedDark(mode: ThemeMode): boolean`（`system` 走 `matchMedia('(prefers-color-scheme: dark)')` 并监听变化）
- Produces: `applyColorScheme(dark: boolean): void`（写 `document.documentElement.style.colorScheme`，**不改 index.css**）
- Consumes（Task 3）：`usePreferences((s) => s.theme)` / `.fontScale` / `setTheme` / `setFontScale`、`THEME_MODES`、`FONT_SCALES`

- [x] 写失败测试（`theme/appearance.test.ts`）：`themeConfigFor(false,'md').token.fontSize === 14`；`themeConfigFor(true,'lg')` 用 `darkAlgorithm` 且 `fontSize === 16`；三档字号逐一对上 `FONT_SCALE_PX`；`applyColorScheme(true)` 之后 `document.documentElement.style.colorScheme === 'dark'`
- [x] 写失败测试（`store/preferences.test.ts` 追加）：默认 `{ locale:'zh-CN', theme:'light', fontScale:'md' }`；`setTheme('dark')` 落盘到 `geo.preferences` 且刷新后恢复；**只有 `locale` 的旧 payload** 被容忍（`theme`/`fontScale` 回落默认，不抛错）；`theme:'neon'` 这类不认识的值回落 `'light'`
- [x] 跑红：`./node_modules/.bin/vitest run --reporter=dot src/theme src/store/preferences.test.ts`
- [x] 实现 `theme/appearance.ts` 与 `store/preferences.ts` 扩展，跑绿
- [x] 改 `Root.tsx`：`const theme = usePreferences(s => s.theme)`、`const fontScale = usePreferences(s => s.fontScale)`、`const dark = useResolvedDark(theme)`；渲染体里调 `applyColorScheme(dark)`（与既有 `applyDayjsLocale(locale)` 同一处、同一条「不得包进 startTransition/Suspense」的护栏，把那条注释一并覆盖到新行）；`ConfigProvider theme={themeConfigFor(dark, fontScale)}`
- [x] 改 `main.tsx`：挂载前 `initI18n(...)` 之后补一次 `applyColorScheme(resolvedDark)`，避免暗色用户首帧闪白（读取用 `readStoredPreferences()`，同步、无 IO）
- [x] 改 `AppLayout.tsx`：`background:'#fff'` → `token.colorBgContainer`；两处 `#f0f0f0` → `token.colorBorderSecondary`；`#1677ff` → `token.colorPrimary`（用 `theme.useToken()`，spec DR-31）
- [x] 追加 `AppLayout.test.tsx` 断言：源码里那 4 处硬编码色值不再出现（用 `src/test/repo-file.ts` 读文件断言，手法同既有真值源测试）
- [x] 跑绿 + `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`
- [ ] Commit `feat(settings): 外观偏好基座（主题/字号）与 AppLayout 颜色 token 化`

### Task 2: 设置页信息架构骨架（机械平移，行为零变化）

**Files:**
- Create: `apps/desktop/ui/src/pages/settings/sections.ts`
- Create: `apps/desktop/ui/src/pages/settings/SettingsLayout.tsx`
- Create: `apps/desktop/ui/src/pages/settings/{General,Models,Collection,Storage,About}Section.tsx`
- Modify: `apps/desktop/ui/src/pages/SettingsPage.tsx`（拆完只留重定向壳）
- Modify: `apps/desktop/ui/src/App.tsx`（`/settings` → `Navigate to="/settings/general"`；新增 `/settings/:section`）
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/settings.ts`（新增 `sections.*` 五个 slug 标签）
- Test: `apps/desktop/ui/src/pages/settings/SettingsLayout.test.tsx`（新建）
- Test: `apps/desktop/ui/src/pages/SettingsPage.test.tsx` → 按 section 拆到 `pages/settings/*.test.tsx`

**Interfaces:**
- Produces: `SETTINGS_SECTIONS = ['general','models','collection','storage','about'] as const`、`type SettingsSection = typeof SETTINGS_SECTIONS[number]`、`isSettingsSection(v)`、`DEFAULT_SETTINGS_SECTION = 'general'`（**slug 而非 index**，spec DR-27）
- Produces: 五个 section 组件，各自 `export default function XSection({ settings, providers, patch, saveState }: SectionProps)`；`SectionProps` 定义在 `pages/settings/sections.ts`
- Produces: 词典键 `settings.sections.{general,models,collection,storage,about}`
- Consumes（Task 3/4/5）：`SectionProps` 的 `patch(next: AppSettings)` 与 `saveState`（`{ dirty, saving, save(), discard() }`）

- [x] 写失败测试（`SettingsLayout.test.tsx`）：`/settings` 重定向到 `/settings/general`；左侧二级菜单**恰好 5 项**且顺序为 `SETTINGS_SECTIONS`；**没有「扩展」**（裁定 4，用 `queryByText` 断言不存在）；不认识的 section（`/settings/nope`）回落到 `general` 而不是白屏；菜单项文案来自词典（zh 下是「通用 / 模型服务商 / 采集与频控 / 数据与存储 / 关于」）
- [x] 跑红 → 建 `sections.ts` + `SettingsLayout.tsx` + 五个 section 文件 + 词典键，跑绿
- [x] **机械平移**今天 `SettingsPage.tsx` 的五张卡片：模型服务商卡 → `ModelsSection`；代理卡 → `GeneralSection`；采集并发与频控卡 → `CollectionSection`；API Key 卡 → `ModelsSection`；语言与通知卡 → `GeneralSection`。`StorageSection` / `AboutSection` 本轮先渲染**空状态**（Task 5 填）
- [x] 把 `SettingsPage.test.tsx` 的 **11 条断言逐条平移**到对应 section 的测试文件，**一条都不许丢**；平移后删掉旧文件
- [x] 改 `App.tsx` 路由；改 `pages/en-us-page-residual.test.tsx` 里 SettingsPage 那一条，改成**逐 section 渲染并各扫一次**（5 条断言，判据函数复用不重写）
- [x] 跑绿：`./node_modules/.bin/vitest run --reporter=dot src/pages/settings src/pages/en-us-page-residual.test.tsx`
- [ ] Commit `refactor(settings): 设置页拆成 /settings/:section 五分段（行为零变化）`

### Task 3: 通用段（外观 · 语言 · 权限与隐私 · 通知）+ `app_environment` 命令

**Files:**
- Modify: `apps/desktop/ui/src/api/client.ts`（`IPC_COMMANDS` +1：`app_environment`；导出 `appEnvironment()`）
- Create: `apps/desktop/ui/src/api/types-app.ts`（`AppEnvironment` / `PermissionState` / `Permissions`）
- Modify: `apps/desktop/ui/src/api/types.ts`（`AppSettings` 追加 `privacy` / `storage`；汇总导出 `types-app`）
- Modify: `apps/desktop/ui/src/demo/backend.ts`（注册 `app_environment`）
- Create: `apps/desktop/ui/src/demo/handlers/app-environment.ts` + `.test.ts`
- Modify: `apps/desktop/ui/src/demo/seed/settings.ts`（`privacy` / `storage` 默认值）
- Modify: `apps/desktop/ui/src/pages/settings/GeneralSection.tsx`
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/settings.ts`（`appearance.*` / `languages.*` / `permissions.*` / `privacy.*`）
- Modify: `apps/desktop/ui/src/i18n/enum-label-prefixes.test.ts`（`EXPECTED_PREFIXES` +4）
- Test: `apps/desktop/ui/src/pages/settings/GeneralSection.test.tsx`

**Interfaces:**
- Produces: `type PermissionState = 'granted' | 'denied' | 'not_determined' | 'unsupported'`、`PERMISSION_STATE_VALUES`
- Produces: `interface AppEnvironment { app_version: string; build_number: string; permissions: { notification: PermissionState; files_and_folders: PermissionState; screen_recording: PermissionState }; storage: { data_dir: string; db_path: string; db_size_bytes: number; screenshots_dir: string; log_dir: string; export_dir: string | null; migrations_applied: number } }`
- Produces: `appEnvironment(): Promise<AppEnvironment>`（`api/client.ts`）
- Produces: `interface PrivacyConfig { share_entity_card: boolean; share_prompts: boolean; share_crawled_text: boolean; share_diagnostics: boolean }`、`interface StorageConfig { last_export_dir: string | null }`
- Produces: 词典枚举前缀 `settings.themes` / `settings.fontScales` / `settings.permissions` / `common.languages`
- Consumes（Task 5）：`AppEnvironment.storage`

- [x] 写失败测试（`demo/handlers/app-environment.test.ts`）：返回形状**逐键**对上 `AppEnvironment`；demo 里 `permissions` 三项**恒为 `'unsupported'`**（spec §8：浏览器确实没有这些系统权限，回 `granted` 是假声明）；`storage.data_dir` 等路径是 ASCII（不踩非注释 CJK 门禁）；`db_size_bytes >= 0`
- [x] 写失败测试（`GeneralSection.test.tsx`）：① 外观两个控件在，切「暗色」后 `usePreferences.getState().theme === 'dark'`（**即时生效、不需保存按钮**，DR-28）；② **界面语言**切 English 后 `i18n.language === 'en-US'` 且页面上出现英文标签（走 `setLocale`，不是 `settings.language`）；③ **生成内容语言**是**另一个**控件，改它只动 `settings.language`、**不动** `i18n.language`（DR-32 的判据，这条最容易写反）；④ 4 项隐私开关默认 `true/true/true/false`；⑤ 权限三项显示「不支持」并且「去系统设置」按钮**置灰**且带说明
- [x] 跑红 → 实现（新命令两侧同时加：`IPC_COMMANDS` + `demoBackend`，漏一侧 `tsc` 就红）→ 跑绿
- [x] 修 `settings.page.uiLanguage` 的**错标**（今天写着「界面语言」却绑 `settings.language`），并把 `languageHint` 那句过期的「P0-A 只做中文，多语言列 P1」改掉（DR-32）
- [x] `EXPECTED_PREFIXES` 39 → 43，跑绿 `i18n/enum-label-prefixes.test.ts`
- [ ] Commit `feat(settings): 通用段（外观/双语言/权限与隐私/通知）与 app_environment 命令`

### Task 4: 模型段（中转站预设 · 协议 · 拉取模型列表）

**Files:**
- Modify: `apps/desktop/ui/src/api/client.ts`（`IPC_COMMANDS` +1：`llm_models_list`；导出 `llmModelsList(...)`）
- Create: `apps/desktop/ui/src/api/types-llm.ts`（`ModelProtocol` / `ModelsListResult` / `LlmModelsQuery`）
- Modify: `apps/desktop/ui/src/api/types.ts`（`ModelConfig` 追加 `protocol`；汇总导出）
- Modify: `apps/desktop/ui/src/demo/backend.ts`、Create `src/demo/handlers/llm-models.ts` + `.test.ts`
- Create: `apps/desktop/ui/src/demo/seed/model-catalogs.ts`（每家厂商的预置模型清单）
- Modify: `apps/desktop/ui/src/demo/seed/settings.ts`（provider 预设 +5 中转站；`model.protocol` 默认值）
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/settings.ts`（`providers.*` +5、`protocols.*`、`modelList.*`）
- Modify: `apps/desktop/ui/src/components/ProviderSelect.tsx`、`src/pages/settings/ModelsSection.tsx`
- Modify: `apps/desktop/ui/src/demo/seed.test.ts`（provider 漂移守卫的**期望值**）
- Test: `apps/desktop/ui/src/pages/settings/ModelsSection.test.tsx`

**Interfaces:**
- Produces: `type ModelProtocol = 'openai_compat' | 'anthropic'`、`MODEL_PROTOCOL_VALUES`
- Produces: `interface LlmModelsQuery { provider: string; protocol: ModelProtocol; base_url: string | null; api_key?: string | null }`、`interface ModelsListResult { models: string[]; source: 'preset' | 'upstream' }`
- Produces: `llmModelsList(query: LlmModelsQuery): Promise<ModelsListResult>`
- Produces: `SEED_MODEL_CATALOGS: Record<string, string[]>`（键集 == provider id 集合，`custom` 除外）
- Produces: 5 个新 provider id：`openrouter` / `siliconflow` / `302ai` / `yunwu` / `deepbricks`（**顺序**：6 家国内厂商 → 5 家中转站 → `custom` 末位；词典与种子必须同序，漂移守卫钉的就是顺序）
- Consumes: Task 3 的 `SectionProps.patch` / `saveState`

- [x] 写失败测试（`demo/handlers/llm-models.test.ts`）：认得的 provider 回该家的预置清单且 `source === 'preset'`；`custom` + 空 `base_url` ⇒ `validation/failed` + `field:'base_url'` + `reason:'required'`（**不新增错误码**，沿用 M3–M7 的口径）；契约外的 `protocol` 收敛成 `'openai_compat'`；🔴 **入参里的 `api_key` 绝不出现在返回值、错误 `params` 或抛出的 message 里**（AGENTS 规则 3，这条要显式断言）
- [x] 写失败测试（`ModelsSection.test.tsx`）：厂商下拉**恰好 12 项**且顺序对上；选「自定义」才出现「模型协议」下拉（选其他家时 `queryByText` 断言不存在）；点「拉取模型列表」→ 出现加载态 → 模型名下拉变成拉回来的清单；拉取失败时显示词典渲染的错误且**不清空**已填的模型名
- [x] 跑红 → 加词典 5 个中转站 + `protocols` + `modelList` → 加种子（provider 表 + `SEED_MODEL_CATALOGS`）→ 加命令两侧 → 实现 handler → 跑绿
- [x] 更新 `demo/seed.test.ts` 的 provider 漂移守卫**期望值**（词典与种子同批加，守卫逻辑不动）；确认 `db.secrets` 自动长出 5 个新钥匙串位（它是 `SEED_SETTINGS.providers.map(...)` 派生的）
- [x] `EXPECTED_PREFIXES` +1（`settings.protocols`），跑绿
- [x] `custom` 的 `label_zh` 从「自定义（OpenAI 兼容）」改成「自定义」——协议现在可选，写死「OpenAI 兼容」就与新行为矛盾（**这是改文案，spec §9-A 已授权**；zh/en 同批改）
- [ ] Commit `feat(settings): 模型段支持中转站预设、协议选择与按配置拉取模型列表`

### Task 5: 数据与存储段 + 关于段

**Files:**
- Modify: `apps/desktop/ui/src/pages/settings/{Storage,About}Section.tsx`
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/settings.ts`（`storage.*` / `about.*`）
- Test: `apps/desktop/ui/src/pages/settings/{Storage,About}Section.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `appEnvironment()` 与 `AppEnvironment.storage` / `.app_version` / `.build_number`
- Produces: 词典键 `settings.storage.{dataDir,dbPath,dbSize,screenshotsDir,logDir,exportDir,migrations,openDir,changeDir,desktopOnly}`、`settings.about.{version,build,licenses,phase2}`

- [x] 写失败测试（`StorageSection.test.tsx`）：五行路径与大小都渲染出来且来自 `app_environment`（不是硬编码）；「打开目录」「更改目录」两个按钮**置灰**并显示「由桌面端提供，演示模式下不可用」（沿用 M7 对 docx/pdf/png 的既有形态与文案口径）；`db_size_bytes` 走人类可读格式（KB/MB）而不是裸字节数
- [x] 写失败测试（`AboutSection.test.tsx`）：版本与构建号来自 `app_environment`；🔴 **`queryByText` 断言「扩展」「skill」「客服机器人」一个都不出现**（裁定 4：二期，连置灰占位都不留，spec §2）
- [x] 跑红 → 实现两个 section + 词典 → 跑绿
- [ ] Commit `feat(settings): 数据与存储段（只读 + 桌面端能力置灰）与关于段`

### Task 6: 导航重构（项目 / 设置 两级）

**Files:**
- Modify: `apps/desktop/ui/src/components/AppLayout.tsx`（重写菜单构造）
- Create: `apps/desktop/ui/src/components/SideNav.tsx`（菜单构造与 `Sider` 底部固定区；`AppLayout` 只留框架）
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/nav.ts`（`newProject` 等）
- Modify: `apps/desktop/ui/src/App.tsx`（`/projects/new` 路由，Task 7 的落点）
- Test: `apps/desktop/ui/src/components/SideNav.test.tsx`（新建）
- Test: `apps/desktop/ui/src/components/AppLayout.test.tsx`（重写导航那一条）

**Interfaces:**
- Produces: `SideNav` 默认导出，无 props（自己读 `useParams` / `useLocation` / `useNavigate` 与 `project_list`）
- Produces: 词典键 `nav.newProject`、`nav.projectsAria`、`nav.settingsAria`
- Consumes: `client.projectList({ query: null, include_archived: true })`

- [x] 写失败测试（`SideNav.test.tsx`）：① 一级项**恰好 2 个**（项目、设置），设置渲染在 `Sider` 的**底部固定区**（用容器结构断言，不是靠顺序）；② 点「项目」这一行**只展开/收起**清单、`location.pathname` **不变**（裁定 1）；③ 「＋」在「项目」这一行内，点它导航到 `/projects/new` 且**不触发展开/收起**（`stopPropagation`，DR-26）；④ 未选项目时 7 个业务二级项**不出现**（`queryByText` 断言，spec §5，不是置灰）；⑤ 选中项目后它展开成**恰好 7 项**且顺序为 实体卡 → 题库 → 采集 → 解析核查 → 诊断 → 行动 → 报告；⑥ 点清单里的项目导航到 `/projects/:id/entity-card`；⑦ 归档项目置灰且不可点
- [x] 跑红 → 实现 `SideNav.tsx` → 跑绿
- [x] 重写 `AppLayout.test.tsx` 的导航断言（原来那条「未选项目时项目级入口置灰」按 ④ 改成「不出现」）；**demo 横幅那两条断言不动**
- [x] 跑 `pages/en-us-page-residual.test.tsx`：新导航文案必须全在词典里（整页无 CJK 判据会自动抓）
- [ ] Commit `feat(nav): 项目与设置两级导航，项目清单内联展开、＋号新建`

### Task 7: 新建项目双入口

**Files:**
- Create: `apps/desktop/ui/src/pages/NewProjectPage.tsx`（模式选择屏）
- Create: `apps/desktop/ui/src/pages/AutoBuildProjectPage.tsx`（填网址 → 演出进度 → 建项目 + 抽取）
- Modify: `apps/desktop/ui/src/App.tsx`（`/projects/new` → `NewProjectPage`；`/projects/new/auto` → `AutoBuildProjectPage`）
- Modify: `apps/desktop/ui/src/components/wizard-steps.ts`（导出展平后的字段集，供对齐判据用）
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/project.ts`（`new.*` / `autobuild.*`）
- Test: `apps/desktop/ui/src/pages/NewProjectPage.test.tsx`
- Test: `apps/desktop/ui/src/pages/AutoBuildProjectPage.test.tsx`
- Test: `apps/desktop/ui/src/components/wizard-steps.test.ts`（新建：字段对齐判据）

**Interfaces:**
- Produces: `WIZARD_ALL_FIELDS: readonly string[]`（`WIZARD_STEP_FIELDS` 展平去重）
- Consumes: `client.projectCreate`、`client.entityCardAutobuild`（DR-36：**先建后抽**，不改命令签名）
- Produces: 词典键 `project.new.{title,autoTitle,autoDesc,manualTitle,manualDesc}`、`project.autobuild.{urlLabel,urlPlaceholder,start,stageCrawling,stageExtracting,stageDone,demoNotice,failed}`

- [x] 写失败测试（`wizard-steps.test.ts`）：`WIZARD_ALL_FIELDS` **覆盖** `ENTITY_FIELD_KEYS`（实体卡里所有带 `ai_extracted`/`confirmed` 状态的字段键）——这就是裁定 3「录入信息数据和页面可以根据自动采集流程」的可执行判据，**不靠人眼比**；反向也断言：`WIZARD_ALL_FIELDS` 里没有实体卡不认的字段
- [x] 写失败测试（`NewProjectPage.test.tsx`）：两张卡片都在、文案来自词典；点「填网址自动采集」→ `/projects/new/auto`；点「手动录入」→ `/projects/new/wizard`；整页无 CJK 残留（en-US 下）
- [x] 写失败测试（`AutoBuildProjectPage.test.tsx`）：① 空网址点「开始」就地拦下、不发请求；② 非 demo 域名（`assertDemoDomain` 那支）显示词典渲染的错误；③ 合法网址 → 依次出现 `抓取中` → `抽取中` → `完成 N% 字段` 三段（**三段都要能观测到**，不能一步跳完）；④ 🔴 全程常驻「演示模式不抓取网页，抽取结果是预置数据」；⑤ 成功后导航到 `/projects/:id/entity-card`，且实体卡字段是 `ai_extracted` 状态（逐字段确认在那一页做，DR-36）
- [x] 跑红 → 实现两个页面 + 词典 + 路由 → 跑绿
- [x] `pages/en-us-page-residual.test.tsx` 加两条（模式选择屏、自动采集屏）
- [ ] Commit `feat(project): 新建项目双入口（网址自动采集 / 手动录入），字段集与实体卡对齐`

### Task 8: delta 口径统一到百分点（裁定 3）

**Files:**
- Modify: `apps/desktop/ui/src/api/types-diagnosis.ts`（`AlertItem.delta` 的注释与语义）
- Modify: `apps/desktop/ui/src/components/format.ts`（`alertDeltaText` 与 `metricDeltaText` **合成一个**）
- Modify: `apps/desktop/ui/src/demo/seed/diagnosis.ts`（比率类告警的 `delta` 乘 100）
- Modify: 全部消费方（`components/AlertList.tsx` 等）
- Test: `apps/desktop/ui/src/components/format.test.ts`、`src/demo/seed.test.ts`、`src/components/AlertList` 相关页面测试

**Interfaces:**
- Produces: `metricDeltaText(t, unit, delta)` **单一**入口；删除 `alertDeltaText`
- Produces: `AlertItem.delta` 的新口径 = 与 `ReportMetricBlock.delta` **同一个**（比率类是百分点，条数类是条数）

- [x] 写失败测试（`format.test.ts`）：`metricDeltaText(t,'percent',13) === '+13 个百分点'`；`metricDeltaText(t,'count',-12) === '-12 条'`；🔴 **断言 `alertDeltaText` 不再被导出**（`expect(Object.keys(format)).not.toContain('alertDeltaText')`）——留着旧函数就等于口径没统一
- [x] 写失败测试（`seed.test.ts`）：`SEED_ALERTS` 里每条比率类告警的 `delta` 与对应两轮 overview 的差值**乘 100 后逐条相等**（这是「统一」的可执行判据，不是改个注释）
- [x] 跑红 → 改种子 → 合成函数 → 改消费方 → 跑绿
- [x] 全量跑 `./node_modules/.bin/vitest run --reporter=dot`，确认 M5/M7 两侧显示的数字**逐字相同**（同一个 +13 个百分点）
- [x] 把差异台账 **E-40** 改标「已对齐 · 留此仅作台账」，并把 `2026-09-28-…-design.md` §11-3 的状态从「方向未定」改成「已统一到百分点」
- [ ] Commit `refactor(format): 统一 delta 口径为百分点，合并两个格式化函数（裁定 3 / E-40）`

### Task 9: 守卫、文档与门禁收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`（新增 §4c，E-46 起）
- Modify: `docs/superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md`（§9 三处裁定点的最终结论回填）
- Modify: `AGENTS.md`（若设置页分段路由成为新的必读事实）
- Test: 全部守卫文件

**Interfaces:** 无新接口。

- [x] 按 spec §10 那 6 条逐条登记 **E-46 … E-51**（编号从台账末尾续，不重号不跳号）；每条按 §1 的判据归类（「demo 不许实现算法」或「镜像成本 > 漂移风险」），并写明代价
- [x] 复核全部守卫：`enum-label-prefixes`（前缀数 39 → **44** ✅）、`en-us-page-residual`（页面/分段扫描 10 → **16** ✅——原计划写 17 是把「设置页 1 条拆成 5 条」算成了净增 5，实际净增 4，再 +2 个新建项目屏 = 16；另有 3 条防空跑用例，文件合计 19 条）、`no-hardcoded-strings`（components 36 → **37**、pages 17 → **19**、抽取面 55 → **58** ✅）、`dictionary.test.ts` parity ✅、`backend.test.ts` 键集合（60 → **62** ✅）、`tailwind-sources`（**零变化** ✅：`src/index.css` 一行未动）
- [x] `mise run check` 全绿（`CHECK_EXIT=0`，2026-09-30）；cargo 部分与上一轮**同一基线**：**22 targets / 515 passed / 0 failed**（Rust 侧本轮一行未改）；前端 `eslint --max-warnings 0` 干净、vitest **66 files / 914 tests** 全绿、`tsc -b && vite build` 通过
- [ ] `mise run demo:preview` 起一次构建产物，人工确认暗色主题下**没有白色残留块**（jsdom 测不出真实渲染）
- [ ] Commit `docs(plan-b): 登记 E-46…E-51 与守卫面变化，收口 Plan B`

### 手动验收（需真人，控制器不代跑）

- [ ] `mise run web`：左侧栏点「项目」展开/收起；点「＋」新建；选一个项目看 7 个二级项；设置固定在左下角
- [ ] 设置五段逐个点一遍；切暗色 + 大字号，确认**全站**（含 antd 弹窗、抽屉、表格、空状态）都跟着变，无白色残留
- [ ] 切界面语言到 English，确认即时生效且**生成内容语言**没跟着变（DR-32）
- [ ] 模型段：选中转站、选自定义看协议下拉、点「拉取模型列表」
- [ ] 新建项目：走一次自动采集（看三段进度与「演示数据」提示），走一次手动录入（5 步）
- [ ] 走查清单见 spec §7 与 `2026-09-28-…-design.md` §12

## Self-Review

**1. Spec 覆盖**：§5 导航 → Task 6；§6 设置 → Task 2/3/4/5；§7 新建项目 → Task 7；§8 契约（2 条新命令 + `privacy`/`storage`/`protocol`）→ Task 3/4；DR-29/30/31 外观 → Task 1；DR-32 语言 → Task 3；DR-33 中转站 → Task 4；DR-34 模型列表 → Task 4；DR-35 `app_environment` → Task 3/5；DR-36 先建后抽 → Task 7；裁定 3（delta 统一）→ Task 8；裁定 4（无扩展）→ Task 5 的 `queryByText` 断言；§10 差异登记 → Task 9；§11 守卫影响面 → Task 9。**无缺口**。

**2. Placeholder 扫描**：每个 task 都给了具体文件、具体接口签名、具体断言内容；无 TBD / 「适当处理」/「同 Task N」。Task 5 的 `Storage`/`About` 在 Task 2 里先渲染空状态**是刻意的分步**，不是占位——Task 2 的交付物是「路由与骨架可用、行为零变化」，独立可测。

**3. 类型一致性**：`ThemeMode`/`FontScale`（Task 1 Produces）在 Task 3 的 Consumes 里同名；`SectionProps`（Task 2）在 Task 3/4 的 Consumes 里同名；`AppEnvironment`（Task 3 Produces）在 Task 5 的 Consumes 里同名；`ModelProtocol`/`ModelsListResult`（Task 4）自洽；`WIZARD_ALL_FIELDS`（Task 7）自洽。`alertDeltaText` 在 Task 8 被**删除**，Task 4/5 不引用它（已核：只有 `components/AlertList.tsx` 与 `format.test.ts` 引用）。

**4. 顺序依赖**：Task 1 → Task 3（外观控件要 store）；Task 2 → Task 3/4/5（section 骨架）；Task 3 → Task 5（`app_environment`）；Task 6 → Task 7（`/projects/new` 路由由 Task 6 加、Task 7 填页面）。Task 8 与 Task 1–7 **无依赖**，可并行。
