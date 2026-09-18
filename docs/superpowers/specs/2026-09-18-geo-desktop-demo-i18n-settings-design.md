# GEO 桌面客户端 · Demo 优先工作流 + i18n 基座 + 设置重构 设计规格

> 文档状态：已评审（2026-09-18 与产品负责人两轮 grilling 定稿）
> 关系：本文件是 `2026-09-16-geo-desktop-p0-design.md` 的**增量修订**，覆盖其中与本文件冲突的条目（见 §10）；未提及的部分仍以原文档为准。
> 需求真值源：`docs/GEO客户端-MVP产品定义-v1.md`（v1.1 宽松化修订，2026-09-18）

---

## 1. 背景与目标

P0-A 交付后，产品负责人在实机验收中提出 5 个问题：

1. 浏览器打开 `http://localhost:1420` 报 `调用 project_list 失败：Cannot read properties of undefined (reading 'invoke')`
2. 设置页同样报 `调用 settings_get 失败：…`
3. 桌面端配置的项目信息，浏览器刷新后看不到
4. 设置页需要重新设计（通用 / 模型 / 权限 / 扩展），并要求"模型列表可由接口 + 密钥拉取"、"自定义可选协议"
5. 已配置接口的情况下，测试连接仍报"自定义服务商必须填写接口地址"

根因已定位：

- 1/2/3 是**同一根因**：`@tauri-apps/api/core` 的 `invoke` 依赖 WebView 注入的 `window.__TAURI_INTERNALS__`，浏览器里没有；而 `README.md` 把 `mise run web` 描述成"浏览器调试用"，UI 侧又没有任何非 Tauri 环境检测。数据本身存在 Tauri app data dir 的 SQLite 里，浏览器侧没有后端进程，看不到属**设计如此**，不是同步缺陷。
- 5 是**两个缺陷叠加**：① `provider_test` → `client_for` 读的是**数据库里已保存的设置**，而设置页是草稿式（点"保存设置"才落库）；② `validate_settings` 不校验 `custom` 的 `base_url` 必填，导致"选了自定义 + 地址空着"能保存成功，报错被推迟到运行时。

同时确立一条**工作方式变更**：产品定义在落地前会频繁修改，因此改为 **demo 优先**——先在纯前端 demo（静态数据、不连后端）里把界面、交互、文案、信息架构定稿，再统一落到桌面端与 Rust 后端。

**本规格的目标**：

- G1 让"浏览器打开"成为一条**受支持的路径**（demo 模式），而不是报错现场。
- G2 建立**中英双语基座**，且错误提示随界面语言返回对应文案。
- G3 把模型服务商从**写死的枚举**改成**用户可自由增删改的档案**，并支持 OpenAI 兼容与 Anthropic 两种协议、支持从接口拉取模型列表。
- G4 重构设置页信息架构（通用 / 模型服务商 / 采集与频控 / 数据与存储 / 关于），符合常规桌面应用操作习惯。
- G5 修好测试连接的语义（测界面上填的值），并在保存时就拦下非法配置。

## 2. 非目标（本轮明确不做）

- 浏览器端连接真实后端（HTTP 桥 / sidecar）：安全面与"本地优先"定位冲突，永久排除在本规格外。
- 浏览器 demo 里跑领域算法（去重、字段完整率、样本量分级）：这些是 Rust 纯函数，demo 只呈现预置静态结果（见 §4.1 能力边界）。
- skill 安装与导入、客服机器人：设置里只留置灰占位，运行时形态需另开设计。
- 成本价目的产品化展示：代码保留、UI 不展示（§4.8）。
- 云同步、多端一致、团队协作权限、白标（M9/M10）。
- 除中英外的第三语言。

## 3. 决策记录（DR）

| # | 决策 | 被否方案与理由 |
|---|---|---|
| DR-1 | 非 Tauri 环境自动进入 **demo 模式**（同一份 UI + 纯 TS 假后端 + 静态种子数据），顶部常驻"演示数据"横幅 | ①仅显示"请在桌面端打开"提示页：浪费了 demo 优先的工作方式；②HTTP 桥让浏览器连真后端：本机任意网页可跨源访问，需 token/回环绑定/CSRF 防护，与"密钥不出机器"冲突 |
| DR-2 | 错误 i18n 采用 **后端只回 `code + params`，前端按 locale 查词典** | 后端按 `settings.language` 返回文案：会在 Rust 里养一套双语词典，P0-D 出报告时还要再养一套；且 CSV/报告等非 UI 消费方不该受界面语言影响 |
| DR-3 | 服务商改为**档案制** `provider_profiles`（内置预设作为可编辑可删的种子），协议成为档案的一个字段 | 继续用固定枚举：加一家厂商/中转站就要发版，与"对所有用户开放自由配置自己的模型"直接冲突 |
| DR-4 | 协议本轮支持 `openai_compat` 与 `anthropic` 两种；Anthropic 的结构化输出**降级**为 prompt 约束 + 已有的"带错误说明重试 1 次" | Anthropic 走 tool-use 强制 JSON：更稳但实现与测试量翻倍，等 P0-B 抽取准确率成为验收项时再做 |
| DR-5 | 设置页用**左侧二级菜单**；保存语义**混合**：模型段显式保存 + 测试连接，通用段即时自动保存 | 顶部 Tabs：扩展性差（后续还要加数据与存储、关于）；整包保存：半包提交会冲掉未改的段落，且凭证类配置不该被"顺手保存" |
| DR-6 | 外观支持 浅色/深色/跟随系统 + 字号 小/中/大，持久化到 `settings.appearance`，前端 localStorage 先行防闪白 | 只做两态：跟随系统是 macOS 用户的常规预期，成本仅一个 `matchMedia` 监听 |
| DR-7 | 语言本轮做 **zh-CN + en-US** 全量（含存量页面文案抽取） | 只做基座 + 新页面：会长期处于半中半英状态；且存量约 284 行中文测试断言在"测试固定 zh locale"前提下不需要改，现在做最便宜 |
| DR-8 | 成本记账**代码不动、UI 不展示**，产品文档放宽为"用量看板"（token / 查询次数），金额估算降级为商业化阶段可选项 | ①彻底删除 pricing：要改 11 个文件 56 处并动 P0-B 硬配额接缝；②改成用户自填单价：属架构调整，本轮不做 |
| DR-9 | 权限面板 = **系统通知权限状态与跳转** + **数据外发隐私开关**（4 项）+ 记住导出目录 | "读取/写入权限"在单机桌面应用里没有可授予对象（应用读写自己的 app data dir 不需要 TCC 授权），照字面做会是空面板 |
| DR-10 | 分三期交付：Plan A（i18n 基座 + demo 后端）→ Plan B（设置页在 demo 里定稿）→ Plan C（桌面端与后端落地）；**Plan B 未经产品负责人回"定稿"不得开工 Plan C** | 一次性做完：demo 优先的意义就在于让界面先收敛，后端跟着定稿的契约走 |

## 4. 架构变更

### 4.1 运行时形态与 IPC 适配层（DR-1）

```
apps/desktop/ui/src/api/
  runtime.ts     detectRuntime(): 'tauri' | 'demo'   // '__TAURI_INTERNALS__' in window
  client.ts      call(cmd, args) → tauriInvoke | demoInvoke   // 组件不感知
apps/desktop/ui/src/demo/
  backend.ts     Record<IpcCommand, Handler>          // 类型强制：漏一个命令就编译不过
  db.ts          内存态 store（刷新重置）
  seed/*.json    静态种子：项目、实体卡、题库、设置、服务商档案
```

- 组件与页面**一行不改**即可在两种运行时下工作：所有 IPC 仍只经 `src/api/client.ts`。
- demo 后端是**纯 TS 内存实现**，可写（增删改在内存里生效），刷新即重置；不发任何网络请求。
- demo 运行时顶部常驻横幅：「演示数据 · 所有改动仅存在于本页面，不会写入本机数据库」。
- `mise run web` 即 demo 入口；新增 `mise run demo:preview`（`vite build && vite preview`）产出可分享的静态站。
- **能力边界（必须写进 README 与横幅）**：demo 只验证界面、交互、文案、信息架构；去重率、字段完整率、样本量分级等**算法结果是预置静态值**，不代表桌面端真实计算结果。

### 4.2 错误契约 i18n（DR-2 / DR-7）

后端（`IpcError` 形状变更，向后兼容新增字段）：

```rust
pub struct IpcError {
    pub code: String,                        // 稳定错误码，如 "validation/failed"
    #[serde(default)]
    pub params: BTreeMap<String, String>,    // 语言中立参数：field / id / kind / reason / expected / limit …
    pub message: String,                     // 兜底文案（日志与词典未命中时用），不再承诺中文散文
    pub detail: Option<serde_json::Value>,   // 不变，仍走 redact 脱敏
}
```

- `GeoError::Validation { field, reason }` 的 `reason` 语义由"中文散文"改为**稳定 reason key**（小写下划线，如 `required` / `invalid_url` / `too_long` / `duplicate`）。约 40 处 `validation(...)` 站点与 ~15 处 `conflict/config` 站点需要改。
- `Display` 改为面向日志的紧凑格式：`validation/failed field=brand_name reason=required`。
- 上游原文（LLM/站点返回的英文报文）不进词典，放 `params.upstream`，UI 以次要文本展示。
- 前端 `describeIpcError(error, t)`：`t('errors.' + code, params)`，词典未命中回退 `error.message`；`unwrapIpcError` 里"调用 X 失败"这类拼接文案同样走词典（`errors.ipc/invoke_failed`）。
- 词典：`src/i18n/locales/{zh-CN,en-US}/{common,fields,errors,settings,project,prompt,entity}.ts`；key 由 `resources.ts` 推导出类型，缺 key 编译不过。
- **完整性测试**：zh 与 en 的 key 集合必须相等、值非空；所有出现在 Rust 里的 `code` 字面量必须在词典中有对应条目（用一份导出的 code 清单快照做断言）。
- 现存 ~39 处断言中文错误文案的 Rust 测试需要改为断言 `code` + `params`。

### 4.3 服务商档案制（DR-3）

```sql
CREATE TABLE provider_profiles (
  id            TEXT PRIMARY KEY,      -- 内置预设用稳定 id（等于旧 provider 字符串），用户新增用 UUIDv4
  name          TEXT NOT NULL,         -- 用户可见显示名
  protocol      TEXT NOT NULL,         -- openai_compat | anthropic
  base_url      TEXT NOT NULL,         -- custom/中转站/内网网关都靠它
  default_model TEXT,                  -- 可空：留空则必须填模型名
  timeout_secs  INTEGER NOT NULL DEFAULT 60,
  temperature   REAL NOT NULL DEFAULT 0.3,
  enabled       INTEGER NOT NULL DEFAULT 1,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

- **Key 引用**：内置预设 `id` 直接沿用旧的 provider 字符串（`deep_seek` / `moonshot` / …），因此 `secret_ref = keyring://llm/{id}` 与既有钥匙串条目**天然兼容，无需迁移密钥**；用户新增档案用 `keyring://llm/profile/{uuid}`。
- `settings.model` 段落改为 `{ profile_id, model_override }`；读取旧 JSON（含 `provider` 字段）时按同 id 映射到内置档案，保证老库能开。
- 内置种子档案（可编辑、可禁用、可删）：DeepSeek、Moonshot、火山方舟、阿里百炼、百度千帆、腾讯混元、OpenAI、Google Gemini（OpenAI 兼容端点）、Anthropic、OpenRouter、硅基流动 SiliconFlow、302.AI、AiHubMix。
- `LlmProvider` 枚举降级为**协议 + 预设元数据**的内部实现细节，不再是 IPC 契约的一部分；`llm_providers` 命令由 `provider_profile_list` 取代。

### 4.4 协议适配与模型列表（DR-4）

- `geo-llm`：`HttpRequest` 增加 `method`（默认 `POST`），以支持 `GET {base_url}/models`；`fixture_key` 仍为 `sha256(url + body)`，既有 fixture 不受影响。
- 请求构造按协议分派：
  - `openai_compat`：`POST {base}/chat/completions`，`Authorization: Bearer`，JSON 模式用 `response_format={"type":"json_object"}`。
  - `anthropic`：`POST {base}/messages`，headers `x-api-key` + `anthropic-version: 2023-06-01`，`system` 为独立字段，`max_tokens` 必填（默认 1024），响应取 `content[0].text`，用量取 `usage.input_tokens/output_tokens`。
- 模型列表：`GET {base}/models` + 鉴权头，两种协议返回形状一致（`{data:[{id}]}`）。**降级口径**：拉取失败不阻塞保存，UI 回退手填并给出双语提示「该服务商未提供模型列表接口，请手动填写模型名」。
- Anthropic 的 JSON 模式为降级实现，UI 在协议说明处标注「不支持严格 JSON 模式，结构化抽取失败率略高」。
- 测试一律 `wiremock` / `FixtureTransport`，禁止联网；各家是否真支持 `/models` 只能在有 Key 时手动录制 fixture（写进 `scripts/record-fixtures.sh`）。

### 4.5 设置页信息架构（DR-5）

```
/settings/general    通用：外观（主题/字号）· 语言 · 代理 · 权限与隐私 · 通知
/settings/models     模型服务商：档案列表 + 新增/编辑/删除 + Key + 测试连接 + 模型列表拉取
/settings/collection 采集与频控：并发、队列、RPM、最小间隔、重试
/settings/storage    数据与存储：数据库路径与大小、日志目录、迁移版本、打开目录、导出目录
/settings/about      关于：版本、构建号、开源许可、扩展（置灰占位：skill 安装与导入 / 客服机器人）
```

- 路由 `/settings/:section`，左侧二级菜单（antd `Menu` mode=inline），默认重定向到 `general`。
- 保存语义：`general` / `collection` / `storage` 段**即时自动保存**（改动后 500ms 防抖写入 + 轻提示）；`models` 段**显式保存**（按钮 + "有未保存的修改"标记 + 测试连接独立于保存）。
- 测试连接使用**界面上的草稿值**（含未保存的 base_url / 模型名 / 超时），Key 未保存时可临时随测试传入（只在内存，不落库、不进日志）；草稿 Key 为空则回落钥匙串里已存的值。
- `validate_settings` 补齐：`protocol=openai_compat|anthropic` 时 `base_url` 必填且必须 http(s)；`default_model` 与 `model_override` 不能同时为空。保存时即拦，不把错误推迟到运行时。

### 4.6 外观（DR-6）

- `settings.appearance = { theme: 'light'|'dark'|'system', font_scale: 'sm'|'md'|'lg' }`。
- 前端：`ThemeProvider` 依据 theme 切 antd `darkAlgorithm`，依据 font_scale 切 `token.fontSize`（13 / 14 / 16）与根元素 `font-size`；`system` 用 `matchMedia('(prefers-color-scheme: dark)')` 并监听变化。
- 首屏防闪：`main.tsx` 在 React 挂载前从 `localStorage['geo.appearance']` 同步读一次并写到 `<html data-theme>`。
- `AppLayout` 的 4 处硬编码颜色（`#fff` / `#f0f0f0` / `#1677ff`）改为 antd token（`colorBgContainer` / `colorBorderSecondary` / `colorPrimary`）。

### 4.7 权限与隐私（DR-9）

- **系统通知**：新增 `tauri-plugin-notification`（该插件不接管 `log`，与 `lib.rs:145` 禁用的 `tauri-plugin-log` 无冲突）。命令 `permission_status()` → `{ notification: 'granted'|'denied'|'not_determined'|'unsupported' }`、`permission_request(kind)`、`open_system_settings()`（用 opener 插件打开 `x-apple.systempreferences:com.apple.preference.notifications`）。
- **数据外发开关** `settings.privacy`：`share_entity_card` / `share_prompts` / `share_crawled_text` 默认 `true`，`share_diagnostics` 默认 `false`（P0-B 才消费）。在 service 层调用 LLM 前检查，未允许则返回 `privacy/denied`（params 带 `scope`），UI 双语提示「该功能需要把〈实体卡〉发送给你配置的模型，请在 设置 → 通用 → 权限与隐私 中允许」。
- **导出目录**：`settings.storage.last_export_dir`，导出对话框以此作为默认路径。

### 4.8 成本口径（DR-8）

- 代码不动：`Pricing` 表、`chat_with_cost`、`Usage.cost_cny` 全部保留（P0-B 硬配额与后续商业化都要用）。
- UI 改动：测试连接结果去掉「成本」行，只保留 模型 / 耗时 / token 用量；`ProviderInfo.input_per_mtok/output_per_mtok` 不再在前端展示。
- 文档改动：`docs/GEO客户端-MVP产品定义-v1.md` 升 v1.1，「成本看板」→「用量看板」，「成本误差 ≤15%」移出 P0 验收，金额估算标注为商业化阶段可选项。

### 4.9 数据与存储面板

- 新命令 `storage_info()` → `{ db_path, db_size_bytes, log_dir, migrations_applied, app_version }`；`storage_open_dir(kind: 'data'|'logs')`。
- 「一键清除数据」仍属 P0-D（涉及 License 与确认流程），本轮只做只读展示 + 打开目录。

## 5. 数据模型与迁移

- 新迁移 `2026_09_18_001_provider_profiles.sql`（建表 + 内置种子 INSERT）、`2026_09_18_002_settings_sections.sql`（无 DDL，仅说明：`appearance` / `privacy` / `storage` 三个段落按需写入 `settings` 表，段落化存储无需改表）。
- `settings` 段落新增（全部 `serde(default)`，老库可读）：`appearance`、`privacy`、`storage`；`model` 段落新增 `profile_id` / `model_override`，保留 `provider` / `model` / `base_url` 字段做兼容读取。
- ID = UUIDv4 文本；时间 = RFC3339 UTC；枚举序列化 = snake_case 且即存储值（沿用原 spec §3）。

## 6. IPC 契约变更

| 变更 | 命令 | 说明 |
|---|---|---|
| 新增 | `provider_profile_list` / `_get` / `_create` / `_update` / `_delete` / `_reorder` | 档案 CRUD；删除内置档案等价于禁用 |
| 新增 | `provider_profile_models` | 入参为**草稿值**（profile_id 或 base_url+protocol+临时 key），返回 `{ models: [String], degraded: bool, reason: Option<String> }` |
| 新增 | `permission_status` / `permission_request` / `open_system_settings` | 通知权限 |
| 新增 | `storage_info` / `storage_open_dir` | 数据与存储面板 |
| 变更 | `llm_provider_test` | 增加可选草稿入参 `{ profile_id?, base_url?, protocol?, model?, timeout_secs?, api_key? }`；`api_key` 只在内存使用 |
| 变更 | `settings_get` / `settings_update` | 增加 `appearance` / `privacy` / `storage` 段落；`model` 段落改为 profile 引用 |
| 移除 | `llm_providers` | 由 `provider_profile_list` 取代 |
| 不变 | 其余 39 个命令（现共 40 个，去掉 `llm_providers`） | 但所有错误返回统一带 `params` |

前端 `IPC_COMMANDS` 清单与 demo 后端 `Record<IpcCommand, Handler>` 是**同一份类型约束**：命令增减在编译期就会两侧同时报错。

## 7. 分期与交付

| 期 | 内容 | 交付判据 |
|---|---|---|
| **Plan A** | i18n 基座（错误契约 + 双语词典 + 存量页面抽取）· demo 假后端 · 运行时检测 · README/文档放宽 · 去掉成本展示 | `mise run web` 打开即 demo，可走完 建项目→实体卡→题库→导出 全流程（静态数据）；切英文全站无中文残留；`mise run check` 全绿 |
| **Plan B** | 设置页重构**在 demo 里定稿**：二级菜单 · 通用（外观/语言/代理/权限与隐私/通知）· 数据与存储 · 关于与扩展占位 · 模型服务商段 UI（含档案 CRUD、模型列表拉取交互、草稿测试连接） | 产品负责人在 demo 里逐段走查并回「定稿」 |
| **Plan C** | 桌面端与后端落地：`provider_profiles` 表与迁移 · 协议抽象 + Anthropic · `/models` 拉取 · `llm_provider_test` 草稿语义 · `validate_settings` 补校验 · 通知权限 · 隐私开关接线 · 外观/存储持久化接线 | `mise run dev` 原生窗口跑通全部设置能力；`mise run check` 全绿；真实 Key 手测清单通过 |

**纪律**：Plan B 未定稿不得开工 Plan C（DR-10）。每期结束跑一次完整门禁并贴输出。

## 8. 测试策略

- **Rust 单测**：错误 `code + params` 契约；协议请求构造（OpenAI / Anthropic 的 URL、headers、body 形状）；`/models` 解析与降级；档案 repo CRUD 与内置种子幂等；`settings` 新段落 roundtrip + 旧 JSON 兼容读取；`validate_settings` 新校验规则。
- **Rust 集成**：`wiremock` 起本地服务验证 Anthropic `/messages` 与 `/models`、重试与超时、用量记账；`FixtureTransport` 验证端到端生成管线不回归。
- **UI Vitest**：demo 后端每个命令的形状契约；i18n 词典完整性（zh/en key 集合相等、无空值、code 全覆盖）；`detectRuntime` 两种分支；设置页各段渲染 + 自动保存防抖 + 草稿测试连接；暗色主题 token 快照。
- **既有测试**：固定 `zh-CN` locale 运行，约 284 行含中文的断言保持不变；~39 处断言中文错误文案的 Rust 测试改为断言 `code + params`。
- 全部测试禁止联网（AGENTS.md 规则 2）。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| demo 假后端与真实后端漂移 | `IPC_COMMANDS` 单一清单 + demo 后端用 `Record<IpcCommand, Handler>` 类型强制；命令形状变更必须同时改两侧，编译期即报错 |
| 错误 reason key 化遗漏，英文界面出现中文兜底 | 词典完整性测试用「Rust 侧导出的 code 清单快照」做断言；`describeIpcError` 未命中时打 `console.warn` 便于发现 |
| 存量页面文案抽取漏字符串 | 分文件迁移 + 每文件迁移后跑一次 `rg '[\u4e00-\u9fa5]'` 自查（排除注释）；Plan A 收尾做一次全仓扫描 |
| Anthropic 结构化输出不稳 | 已有"带错误说明重试 1 次"兜底 + UI 明确标注降级；tool-use 方案列 P0-B |
| 各服务商 `/models` 支持度未知且不能联网验证 | 降级为手填；有 Key 时用 `scripts/record-fixtures.sh` 手动录制，把已知支持度写进 `fixtures/llm/README.md` |
| 暗色主题下第三方组件（ECharts）配色不跟随 | ECharts 主题在 `ThemeProvider` 里按当前 theme 传 `echarts.registerTheme`，图表组件统一从 context 取 |
| 通知插件与既有 tracing 初始化冲突 | `lib.rs:145` 的断言只禁 `tauri-plugin-log`；notification 插件不接管 log，落地前用启动测试验证不 panic |

## 10. 对既有文档的覆盖关系

| 原条目 | 本规格的处理 |
|---|---|
| 原 spec §1.2「i18n（UI 仅中文）列 P1」 | **覆盖**：本轮做 zh-CN + en-US（DR-7） |
| AGENTS.md 规则 7「UI 仅中文」 | **覆盖**：改为「UI 支持 zh-CN 与 en-US，默认 zh-CN；所有面向用户的文案经词典，不得硬编码」 |
| 原 spec §4.4「`Usage.cost_cny` 为 P0-B 成本看板累积数据」 | 保留代码，**UI 不展示**；成本看板降级为用量看板（DR-8） |
| 原 spec §4.1「`llm_providers` 返回内置预设」 | **覆盖**：改为 `provider_profile_list`（DR-3） |
| 产品文档 §3.1 原则 3「成本透明」、§3.5 验收「成本误差 ≤15%」、§6 S0「单轮成本 ≤¥80」 | **放宽**（产品文档 v1.1）：用量透明为主，金额估算为可选项、不作 P0 验收 |
