# Plan A · i18n 基座 + Demo 假后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `mise run web` 打开即是可用的纯前端 demo（静态数据、可走完 建项目→实体卡→题库→导出 全流程），并建立中英双语基座：后端错误只返回稳定 `code + params`，文案由前端按当前语言渲染，存量页面文案全部迁入词典。

**Architecture:** 前端在 `src/api/client.ts` 单点分派运行时——Tauri WebView 走 `invoke`，浏览器走 `src/demo/backend.ts`（纯 TS 内存假后端，实现同一份 `IPC_COMMANDS` 契约）；组件与页面完全不感知。i18n 用 `react-i18next`，词典按 namespace 组织在 `src/i18n/locales/{zh-CN,en-US}/`，错误码清单以 `contracts/error-codes.json` 作为前后端**共享真值源**（Rust 侧 `include_str!` 断言，TS 侧类型化导入）。后端 `IpcError` 新增语言中立 `params`，`GeoError` 的自由文本 `reason` 改为稳定 reason key。

**Tech Stack:** 新增前端依赖 `i18next@26.4.2`、`react-i18next@17.0.14`（不引 language-detector，语言由设置/localStorage 显式决定）。其余沿用现有栈：Rust 1.98.1 / Tauri 2.11 / sqlx 0.9 / React 19.3 / antd 5.29.3 / Vite 8.3 / Vitest 5 / TypeScript 6.0.3。

**Spec:** `docs/superpowers/specs/2026-09-18-geo-desktop-demo-i18n-settings-design.md`（§4.1 demo 运行时、§4.2 错误契约、§7 分期、§8 测试策略）；上游背景见 `docs/superpowers/specs/2026-09-16-geo-desktop-p0-design.md`。

## Global Constraints

- **TDD**：先写失败测试跑红，再写最小实现（AGENTS.md 规则 1）。
- **测试禁止联网**：HTTP/LLM 走 `fixtures/` 或 `wiremock`；demo 后端不发任何网络请求（AGENTS.md 规则 2、spec §4.1）。
- **密钥永不落库、永不入日志**；demo 后端的 `secret_set` 只写内存，且必须在 UI 上标注"演示模式不会写入系统钥匙串"（AGENTS.md 规则 3）。
- **依赖方向不可反向**：`geo-domain` 不依赖本仓其他 crate 且不做 IO（AGENTS.md 规则 4）。
- **文案合规**：中英双语都禁用绝对化用语（`保证排名/霸屏/第一/最`、`guaranteed ranking/#1/best/100%`）（AGENTS.md 规则 6）。
- **UI 不得硬编码自然语言**：所有面向用户的字符串经 `t()`；测试固定 `zh-CN` locale 运行，存量约 284 行中文断言因此保持不变（AGENTS.md 规则 7）。
- **demo 不实现领域算法**：去重率、字段完整率、样本量分级只呈现预置静态值（AGENTS.md 规则 9）。
- **命令契约单一真值源**：`IPC_COMMANDS`（`src/api/client.ts`）+ `Record<IpcCommand, Handler>`（`src/demo/backend.ts`），增删命令两侧同时改，编译期报错（spec §6）。
- **门禁**：`mise run check` 全绿才算完成；无 mise 激活时用 `export PATH="/opt/homebrew/bin:$PATH"` 后 `mise exec -- cargo …` / `mise exec -- pnpm …`。
- **提交**：Conventional Commits，一个 task 一次提交，信息说明"做了什么 + 为什么"。
- **不做的事**：不改 `pricing` / `cost_cny` 后端代码（spec DR-8）；不新增 `provider_profiles` 表（Plan C）；不重构设置页信息架构（Plan B）；不 push、不改 remote（AGENTS.md 规则 10）。

---

### Task 1: 错误码契约清单（前后端共享真值源）

**Files:**
- Create: `contracts/error-codes.json`
- Test: `apps/desktop/src-tauri/src/error.rs`（追加 `#[cfg(test)]` 用例）
- Test: `apps/desktop/ui/src/i18n/error-codes.test.ts`（Task 7 才补词典断言，本任务先建导入与形状断言）

**Interfaces:**
- Produces: `contracts/error-codes.json` 形状 `{ "codes": [ { "code": string, "params": [string], "note": string } ] }`；TS 侧 `import catalog from '../../../../../contracts/error-codes.json'`（**从 `apps/desktop/ui/src/i18n/` 上 5 层**才到仓库根，已实测；3 层只到 `apps/desktop/`）后 `catalog.codes` 可用；Rust 侧 `const ERROR_CATALOG: &str = include_str!("../../../../contracts/error-codes.json");`（4 层，正确）
- Produces: 现存全部 code 的完整清单（`validation/failed`、`{kind}/not_found` 的 **5** 个具体值、`state/conflict`、`config/invalid`、`data/invalid`、`io/failed`、`llm/*` 7 个、`crawler/*` **7** 个、`compliance/violation`、`prompt_set/empty_import`、`upstream/*` 13 个、`ipc/*` 4 个）
  - `{kind}/not_found` 只有 5 个：`project` / `entity_card` / `prompt_set` / `prompt_item` / `competitor`。**不含 `asset`** —— `repo/asset.rs` 只有 add/list/delete，没有「读单条资产」的路径，全仓无 `not_found("asset")` 调用点；Plan C 若真加该路径，再连契约一起加。
  - `crawler/*` 是 7 个不是 6 个：`CrawlerError` 的 6 个变体 + `crawler/empty`（壳内 `IpcError::new("crawler/empty", …)`，发射点 `apps/desktop/src-tauri/src/services/entity_card_service.rs:105`，已有集成测试断言）。它不是 `CrawlerError` 变体，因此没有 `upstream/crawler/empty`。
- Produces: IPC 层**四个**码一次收全——`ipc/internal`（壳内错误，已有）、`ipc/invoke_failed`（Task 9 起由前端 `invoke` 失败时发射）、`ipc/unknown_command`（Task 11 起由 demo 后端运行时守卫发射）、`ipc/unknown`（`client.ts:92` 今天就有的空 `code` 兜底）。后三者本轮暂无 Rust 发射点，**这是预期的**，任何测试都不得因此失败；契约文件此后不再被后续 task 修改。

- [ ] 用 `rg -o '"[a-z_]+/[a-z_]+"' -g '*.rs' apps crates | sort -u` 生成初稿，剔除 MIME 与路径字面量（`application/json`、`text/html`、`fixtures/http` 等），补上动态拼出的 `{kind}/not_found` 具体值（`project` / `entity_card` / `prompt_set` / `prompt_item` / `competitor` / `asset`）
- [ ] 写失败测试（Rust）：解析 `ERROR_CATALOG`，断言 `IpcError::from(GeoError::not_found("project","x")).code` 等代表错误的 code 都在清单里

```rust
#[test]
fn every_code_the_backend_emits_is_in_the_shared_catalog() {
    let catalog: serde_json::Value = serde_json::from_str(ERROR_CATALOG).expect("清单可解析");
    let known: Vec<&str> = catalog["codes"]
        .as_array()
        .expect("codes 是数组")
        .iter()
        .map(|entry| entry["code"].as_str().expect("code 是字符串"))
        .collect();
    let emitted = vec![
        IpcError::from(GeoError::not_found("project", "x")).code,
        IpcError::from(GeoError::validation("brand_name", "required")).code,
        IpcError::from(LlmError::MissingSecret).code,
        IpcError::from(StoreError::Conflict("dup".into())).code,
        IpcError::from(CrawlerError::Timeout { url: "u".into() }).code,
        IpcError::internal("boom").code,
    ];
    for code in emitted {
        assert!(known.contains(&code.as_str()), "{code} 不在 contracts/error-codes.json 里");
    }
}
```

- [ ] 跑红：`mise exec -- cargo test -p geo-desktop error::tests::every_code` → 编译失败（`ERROR_CATALOG` 未定义）
- [ ] 建 `contracts/error-codes.json` 与 `ERROR_CATALOG` 常量，跑绿
- [ ] 写失败测试（TS）：`error-codes.test.ts` 断言 JSON 可导入、每条都有非空 `code` 与 `params` 数组、`code` 无重复
- [ ] 跑红 → 实现（仅 JSON 与导入，无生产代码）→ 跑绿：`mise exec -- pnpm --dir apps/desktop/ui run test src/i18n/error-codes.test.ts`
- [ ] Commit `feat(contracts): 错误码清单成为前后端共享真值源`

### Task 2: `IpcError` 增加语言中立 `params`

**Files:**
- Modify: `apps/desktop/src-tauri/src/error.rs`
- Modify: `apps/desktop/ui/src/api/types.ts`（`IpcErrorPayload` 加 `params?: Record<string,string>`）
- Test: `apps/desktop/src-tauri/src/error.rs` 的 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 1 的 `ERROR_CATALOG`
- Produces: `IpcError { code: String, params: BTreeMap<String,String>, message: String, detail: Option<Value> }`；构造子 `IpcError::new(code, message)`（params 空）、`IpcError::with_params(code, params)`、`.with_param(k, v)`、`.with_detail(v)`；序列化字段名 `code` / `params` / `message` / `detail`
- Produces: TS `IpcErrorPayload.params?: Record<string, string>`

- [ ] 写失败测试：`not_found` 错误的 `params` 含 `kind=project` 与 `id=abc`；`validation` 含 `field` 与 `reason`；序列化后 JSON 有 `params` 对象；`redact` 仍对 `params` 的值生效（塞 `sk-xxx` 必须变 `***`）
- [ ] 跑红：`mise exec -- cargo test -p geo-desktop error::tests`
- [ ] 最小实现：加字段 + `#[serde(default)]` 不需要（Rust 侧序列化），但 `From` 各实现填充 params；`redact` 遍历 params 值
- [ ] 跑绿；再跑 `mise exec -- cargo test -p geo-desktop`
- [ ] 前端 `types.ts` 加 `params`，`isIpcErrorPayload` 不改（params 可选）；跑 `mise exec -- pnpm --dir apps/desktop/ui run test src/api/client.test.ts` 确认不回归
- [ ] Commit `feat(desktop): IPC 错误携带语言中立 params，为前端按语言渲染铺路`

### Task 3: `GeoError` 的 reason 改为稳定 key

**Files:**
- Modify: `crates/geo-domain/src/error.rs`（含 reason key 目录文档注释）
- Modify: `crates/geo-domain/src/{project.rs,entity_card.rs,asset.rs,prompt.rs,csv_io.rs,compliance.rs,ids.rs}` 的 `validation/conflict/config` 调用点
- Test: 各文件 `#[cfg(test)]`

**Interfaces:**
- Produces: `GeoError::params(&self) -> BTreeMap<String,String>`（映射见 spec §4.2）；`Display` 输出紧凑日志格式 `"{code} {k}={v} …"`
- Produces: **reason key 目录**（写进 `error.rs` 文档注释，Task 4/5/6 复用）：`required` `empty` `too_long` `too_short` `invalid_url` `invalid_id` `invalid_format` `duplicate` `out_of_range` `not_allowed` `missing_header` `row_invalid` `unknown_provider` `missing_base_url` `missing_model` `parse_failed`
- Produces: `GeoError::user_message()` 语义变更为"日志/兜底文案"，不再承诺中文散文

- [ ] 写失败测试：`GeoError::validation("brand_name","required").params()` == `{field:"brand_name", reason:"required"}`；`to_string()` == `"validation/failed field=brand_name reason=required"`；`not_found` 的 params == `{kind, id}`；`upstream` 的 params == `{upstream_code, upstream}`
- [ ] 跑红：`mise exec -- cargo test -p geo-domain error::`
- [ ] 实现 `params()` 与新 `Display`；把 `geo-domain` 内所有中文 reason 换成目录里的 key（如 `"不能为空"` → `required`，`"不是合法网址：{domain}"` → `invalid_url` 且把值放进 `params`）
- [ ] 修受影响的既有测试（断言中文文案的改为断言 `code` + `params`）
- [ ] 跑绿：`mise exec -- cargo test -p geo-domain`
- [ ] Commit `refactor(domain): 错误 reason 改为稳定 key，Display 转为日志格式`

### Task 4: `geo-store` / `geo-llm` / `geo-crawler` 错误 params 化

**Files:**
- Modify: `crates/geo-store/src/error.rs`、`crates/geo-llm/src/error.rs`、`crates/geo-llm/src/transport.rs`、`crates/geo-crawler/src/error.rs`
- Modify: `crates/geo-llm/src/client.rs`（`Config(...)` 的中文散文 → reason key）
- Test: 各 crate `#[cfg(test)]` 与 `crates/*/tests/`

**Interfaces:**
- Consumes: Task 3 的 reason key 目录
- Produces: `StoreError::params()`、`LlmError::params()`、`CrawlerError::params()`（均为 `BTreeMap<String,String>`），以及与 `GeoError` 的 `From` 保持 code 语义不变
- Produces: `LlmError::Config(reason_key)`；`missing_base_url` / `missing_model` / `unknown_provider` 三个 key 由 `client.rs` 与 `state.rs` 共用

- [ ] 写失败测试：`LlmError::MissingSecret.params()` 为空 map 且 `code()=="llm/missing_secret"`；`LlmError::Server{status:500}.params()=={status:"500"}`；`CrawlerError::Timeout{url}.params()=={url}`；`StoreError::not_found("prompt_set","x").params()=={kind,id}`
- [ ] 跑红：`mise exec -- cargo test -p geo-llm -p geo-store -p geo-crawler`
- [ ] 实现 `params()`；把三个 crate 里 `#[error("中文…")]` 的 Display 改为紧凑格式（保留 code 不变）
- [ ] 修既有测试断言；跑绿（含 `crates/geo-llm/tests/`）
- [ ] Commit `refactor(crates): 三个基础 crate 的错误统一输出 code+params`

### Task 5: desktop 服务层错误站点 key 化

**Files:**
- Modify: `apps/desktop/src-tauri/src/{state.rs,error.rs}`、`apps/desktop/src-tauri/src/services/{project_service.rs,project_transfer.rs,prompt_service.rs,entity_card_service.rs,settings_service.rs}`
- Test: `apps/desktop/src-tauri/tests/*.rs` 与各文件 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 2 的 `IpcError::with_params`、Task 3/4 的 reason key 目录
- Produces: `state.rs` 的 `config_from_settings` 错误码固定为 `llm/config`，params 带 `reason=missing_base_url|missing_model|unknown_provider`（前端据此渲染"设置 → 模型服务商 → 接口地址"这类可操作指引）
- Produces: 约 40 处 `GeoError::validation(...)`、~15 处 `conflict/config` 全部使用目录内 key

- [ ] 写失败测试（service 层，直调不走 WebView）：空品牌名建档 → `code=="validation/failed"` 且 `params=={field:"brand_name",reason:"required"}`；custom 缺 base_url → `code=="llm/config"` 且 `params.reason=="missing_base_url"`
- [ ] 跑红：`mise exec -- cargo test -p geo-desktop`
- [ ] 逐文件替换中文 reason 为 key，`IpcError::new(code, msg)` 站点改为 `IpcError::with_params(code, params)`（`message` 保留英文兜底短句）
- [ ] 修既有断言（~39 处中文文案断言）；跑绿：`mise exec -- cargo test --workspace`
- [ ] Commit `refactor(desktop): 服务层错误全部改为 code+params，中文散文退出后端`

### Task 6: 前端 i18n 基座

**Files:**
- Modify: `apps/desktop/ui/package.json`（加 `i18next@26.4.2`、`react-i18next@17.0.14`）
- Create: `apps/desktop/ui/src/i18n/{index.ts,resources.ts,antd-locale.ts}`、`src/i18n/locales/{zh-CN,en-US}/{common,nav,errors,fields,project,prompt,entity,settings,demo}.ts`、`src/i18n/locales/{zh-CN,en-US}/index.ts`
- Create: `apps/desktop/ui/src/store/preferences.ts`（zustand + localStorage `geo.preferences`）
- Modify: `apps/desktop/ui/src/main.tsx`（挂载前 `initI18n`，`ConfigProvider locale` 跟随）
- Modify: `apps/desktop/ui/src/test/setup.ts`（**必须在本任务接线** `initI18n('zh-CN')`，否则 Task 8 抽取文案后存量测试会渲染出 key 而不是中文，大面积红）
- Modify: `apps/desktop/ui/src/test/render.tsx`（`ConfigProvider locale` 由参数决定，默认 `zh_CN`，为 Task 7 的英文渲染测试留口）
- Test: `apps/desktop/ui/src/i18n/index.test.ts`、`src/store/preferences.test.ts`

**Interfaces:**
- Produces: `export type Locale = 'zh-CN' | 'en-US'`；`export const LOCALES: readonly Locale[]`；`initI18n(locale: Locale): void`；`export const i18n`（单例）
- Produces: `resources.ts` 导出 `resources` 与 `export type TranslationKey = NestedKeys<typeof zhCN>`（深层 key 联合类型，缺 key 编译不过）
- Produces: `antdLocale(locale: Locale): Locale`（`zh_CN` / `en_US`，来自 `antd/locale/*`）
- Produces: `usePreferences()` → `{ locale, setLocale, }`（store：`locale` 默认 `'zh-CN'`，`setLocale` 同时 `i18n.changeLanguage` 与写 localStorage）

- [ ] 装依赖：`mise exec -- pnpm --dir apps/desktop/ui add i18next@26.4.2 react-i18next@17.0.14`
- [ ] 写失败测试：`initI18n('en-US')` 后 `i18n.t('nav.projects')==='Projects'`；`initI18n('zh-CN')` 后为 `'项目'`；`usePreferences().setLocale('en-US')` 后 localStorage `geo.preferences` 含 `"locale":"en-US"`；`antdLocale('en-US').locale === 'en-us'`
- [ ] 跑红：`mise exec -- pnpm --dir apps/desktop/ui run test src/i18n`
- [ ] 最小实现：词典先只放 `nav.*` 与 `common.*`（`save`/`cancel`/`delete`/`confirm`/`search`/`loading`/`unknownError`），其余 namespace 建空对象占位由 Task 8/9 填
- [ ] `main.tsx` 接线：挂载前从 localStorage 读 locale（缺省 `zh-CN`）→ `initI18n` → `ConfigProvider locale={antdLocale(locale)}`；跑绿
- [ ] Commit `feat(ui): 接入 react-i18next 与语言偏好存储，词典按 namespace 分层`

### Task 7: 错误文案渲染 + 词典完整性

**Files:**
- Create: `apps/desktop/ui/src/api/errors.ts`
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/errors.ts`、`fields.ts`
- Modify: 5 个页面里各自的 `describeError` 改为引用 `describeIpcError`
- Test: `apps/desktop/ui/src/api/errors.test.ts`、`src/i18n/dictionary.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `contracts/error-codes.json`、Task 2 的 `IpcErrorPayload.params`、Task 6 的 `i18n`
- Produces: `describeIpcError(error: unknown, t: TFunction): string`（命中词典 → `t('errors.<code>', params)`；未命中 → `console.warn` 后回退 `error.message`；非 `IpcRequestError` → `t('common.unknownError')`）
- Produces: `upstream/*` 的渲染规则（**控制器裁定，实现者不必再选**）：词典**不为 13 条 `upstream/*` 各写一份复述**，只用一条共享包装键 `errors.upstream.wrapper`（zh「上游服务返回错误：{{upstream}}」/ en `Upstream service error: {{upstream}}`）。
  - **不要拿里层 code 的模板去渲染 upstream 错误**：两族 params 不相交 —— `upstream/*` 是 `["upstream_code","upstream"]`，里层如 `llm/server` 是 `["status"]`（`contracts/error-codes.json:114` vs `:204`），套里层模板会留下空占位符。
  - 渲染取值顺序：`params.upstream` → 缺则 `params.upstream_code` → 再缺则 `error.message`；三者都空才走 `console.warn` 回退。
  - 「剥 `upstream/` 前缀」只用于**词典完整性断言**（断言里层 code 在双语词典里存在，防止这族的语义源漂移），不用于渲染。
  - 代价：2 条词典（wrapper 的 zh/en），而不是 26 条近似重复文案。
- Produces: `fields.ts` 覆盖后端会返回的全部 `field` 值（`brand_name` `aliases` `domain` `intents` `items` `ids` `label` `set_id` `standard_name` `products.name` `text` `payload` `model.provider` `model.model` `model.base_url` …）

- [ ] 写失败测试（`dictionary.test.ts`）：遍历 `catalog.codes`，断言 `zh-CN` 与 `en-US` 的 `errors.<code>` 都存在且非空——**`upstream/*` 例外**：改为断言「剥掉 `upstream/` 前缀后的里层 code 在两种语言里都存在」+「`errors.upstream.wrapper` 在两种语言里都存在」；断言 zh/en 的 key 集合完全相等（双向差集为空）；断言没有值等于 key 本身（漏翻标志）；断言 `errors.*` 模板里出现的 `{{xxx}}` 占位符都在该 code 的 `params` 清单内（`params` 为空数组的 code——`llm/missing_secret`、`llm/rate_limited`、`prompt_set/empty_import` 等——模板里不得出现任何 `{{…}}`）
- [ ] 清单导入路径用 **5 层**（`../../../../../contracts/error-codes.json`，同 Task 1，别再按 3 层写红一次）
- [ ] 写失败测试（`errors.test.ts`）：`{code:'upstream/llm/server', params:{upstream_code:'llm/server', upstream:'503 from provider'}}` 在 zh 下渲染出含「上游服务」与 `503 from provider` 的文案、en 下同理；`params` 只有 `upstream_code` 时回退到 `upstream_code`；断言渲染结果里**不残留** `{{` 或 `status` 这类未填充占位符
- [ ] 写失败测试（`errors.test.ts`）：`{code:'upstream/llm/rate_limited'}` 在 zh 下渲染出带「上游服务」的包装文案且不等于 code 本身、en 下同理（验证剥前缀回退真的接通，而不是靠 26 条重复词典）
- [ ] 写失败测试（`errors.test.ts`）：`{code:'validation/failed', params:{field:'brand_name',reason:'required'}}` 在 zh 下渲染为「品牌名不能为空」、en 下渲染为 `Brand name is required`；未命中 code 回退 `message`
- [ ] 跑红：`mise exec -- pnpm --dir apps/desktop/ui run test src/i18n src/api/errors`
- [ ] 实现 `errors.ts`（zh/en 覆盖清单里全部 code）+ `fields.ts` + reason key 词典（`errors.reasons.*`）+ `describeIpcError`
- [ ] 把 5 个页面的本地 `describeError` 换成 `describeIpcError(error, t)`；跑绿：`mise exec -- pnpm --dir apps/desktop/ui run test`
- [ ] Commit `feat(ui): 错误文案按语言渲染，词典完整性由错误码清单守住`

### Task 8: 存量文案抽取 · 组件层

**Files:**
- Modify: `apps/desktop/ui/src/components/{AppLayout,AutoBuildPanel,CompetitorEditor,CsvToolbar,EntityFieldCard,FieldStatusTag,GeneratePanel,ProjectTable,PromptItemEditor,PromptTable,ProviderSelect,ProxyForm,RevisionTimeline,SampleSizeAlert,SecretStatus,WizardSteps}.tsx`、`components/{entity-fields,wizard-steps}.ts`
- Modify: `src/i18n/locales/{zh-CN,en-US}/{common,project,prompt,entity,settings}.ts`
- Test: 现有组件相关测试（不改断言，固定 zh-CN）

**Interfaces:**
- Consumes: Task 6 的 `useTranslation`、Task 7 的 `fields` 词典
- Produces: 组件内不再出现自然语言字面量；`entity-fields.ts` / `wizard-steps.ts` 的 `label` 字段由中文串改为 **i18n key**（消费方用 `t(label)` 渲染）

- [ ] 写失败测试：新增 `src/i18n/no-hardcoded-strings.test.ts`，用 `rg` 不可行→改为**静态扫描**：`import.meta.glob('../components/*.tsx', { query: '?raw', import: 'default' })` 读源码，剔除注释与 `className`/`id` 后断言不含 CJK 字符（正则 `[\u4e00-\u9fa5]`）
- [ ] 跑红（当前 16 个组件都含中文）
- [ ] 逐组件抽取：文案进词典，组件改 `const { t } = useTranslation()`；`label` 类常量改 key
- [ ] 跑绿：`mise exec -- pnpm --dir apps/desktop/ui run test`（存量测试固定 zh-CN，断言不变）
- [ ] Commit `refactor(ui): 组件层文案全部迁入词典`

### Task 9: 存量文案抽取 · 页面与入口层

**Files:**
- Modify: `src/pages/{ProjectListPage,ProjectWizardPage,EntityCardPage,PromptSetPage,SettingsPage}.tsx`、`src/App.tsx`、`src/main.tsx`、`src/api/client.ts`（`unwrapIpcError` 的拼接文案）、`src/api/types.ts`（注释除外）
- Modify: `src/i18n/locales/{zh-CN,en-US}/*`
- Test: `src/i18n/no-hardcoded-strings.test.ts`（扩到 `pages/`）

**Interfaces:**
- Consumes: Task 6/7/8
- Consumes: Task 6 已在 `src/test/setup.ts` 接好 `initI18n('zh-CN')`，本任务不再动该文件
- Produces: `client.ts` 的 `unwrapIpcError(cmd, cause)` 不再拼中文，改为返回 `IpcRequestError{ code:'ipc/invoke_failed', params:{ cmd, reason } }`，展示交给 `describeIpcError`
- Produces: `client.ts:92` 的 `payload.code || 'ipc/unknown'` **保持原样**（控制器裁定）：它兜的是「后端给了合法 payload 但 `code` 是空串」，与 `ipc/invoke_failed`（`invoke` 本身抛异常/在浏览器里根本没有 `invoke`）是两种不同故障，合并会把「契约破损」伪装成「通道不通」。两个码 Task 1 都已入契约，此处不新增。

- [ ] 扩失败测试：扫描范围加 `pages/*.tsx` 与 `App.tsx`
- [ ] 跑红 → 逐页抽取 → 跑绿
- [ ] `unwrapIpcError` 改造：先写失败测试（`code==='ipc/invoke_failed'`、`params.cmd==='project_list'`、`message` 不含 CJK），跑红后实现。**不要再改 `contracts/error-codes.json`** —— `ipc/invoke_failed` 在 Task 1 已一次收全，契约自 Task 1 起冻结。
- [ ] 全量跑绿：`mise exec -- pnpm --dir apps/desktop/ui run test`
- [ ] Commit `refactor(ui): 页面与 IPC 兜底文案迁入词典，测试固定 zh-CN`

### Task 10: 运行时检测与 demo 横幅

**Files:**
- Create: `apps/desktop/ui/src/api/runtime.ts`、`src/components/DemoBanner.tsx`
- Modify: `src/api/client.ts`（`call()` 分派）、`src/components/AppLayout.tsx`（挂横幅）
- Test: `src/api/runtime.test.ts`、`src/components/DemoBanner.test.tsx`

**Interfaces:**
- Produces: `export type Runtime = 'tauri' | 'demo'`；`detectRuntime(win?: unknown): Runtime`（判据 `'__TAURI_INTERNALS__' in window`，参数可注入便于测试）；`export const runtime: Runtime`（模块级常量）
- Produces: `client.ts` 导出 `callVia(cmd, args, invoker)` 以便测试注入；真实分派为 `runtime === 'tauri' ? tauriInvoke : demoInvoke`
- Produces: `<DemoBanner />` 仅在 `runtime === 'demo'` 时渲染，文案 key `demo.banner`

- [ ] 写失败测试：`detectRuntime({})==='demo'`、`detectRuntime({ __TAURI_INTERNALS__: {} })==='tauri'`；demo 下渲染出横幅、tauri 下不渲染（用 vi.mock 控制 `runtime`）
- [ ] 跑红 → 实现 → 跑绿
- [ ] 在 `AppLayout` 顶部挂 `<DemoBanner />`（`Content` 之上，常驻不遮挡操作）
- [ ] Commit `feat(ui): 检测非 Tauri 运行时并明示演示数据`

### Task 11: demo 假后端骨架

**Files:**
- Create: `apps/desktop/ui/src/demo/{types.ts,db.ts,backend.ts,latency.ts}`、`src/demo/seed/{projects.json,entity-cards.json,prompt-sets.json,settings.json}`（**不建 provider-profiles 种子**：档案制是 Plan B/C 的契约，现在造一份形状必然漂移；demo 的 `llm_providers` 按当前 `ProviderInfo[]` 形状从 `settings.json` 的内置预设返回）
- Modify: `src/api/client.ts`（接 `demoInvoke`）
- Test: `src/demo/backend.test.ts`

**Interfaces:**
- Consumes: `IPC_COMMANDS` / `IpcCommand`（`src/api/client.ts`）、`src/api/types.ts` 全部 DTO
- Produces: `export type DemoHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>`；`export const demoBackend: Record<IpcCommand, DemoHandler>`（**类型强制全覆盖**，漏一个命令编译不过）；`export async function demoInvoke<T>(cmd: IpcCommand, args?: Record<string, unknown>): Promise<T>`（未知命令/校验失败时 reject `IpcErrorPayload` 形状）
- Produces: `createDemoDb(): DemoDb` 与 `resetDemoDb(): void`（每个测试与每次页面刷新都从种子重建）；`DemoDb` 持有 `projects` `entityCards` `competitors` `assets` `revisions` `promptSets` `promptItems` `settings` `profiles` `secrets`
- Produces: `withLatency(ms=120)`（让 loading 态在 demo 里可见，测试里可设 0）

- [ ] 写失败测试：`demoBackend` 的 key 集合与 `IPC_COMMANDS` 完全相等；`resetDemoDb()` 后 `project_list` 返回种子里的 2 个项目；`demoInvoke('不存在的命令')` reject 出 `{code:'ipc/unknown_command'}`
- [ ] 跑红 → 建骨架（handler 先全部 `throw new Error('not implemented')`，但 `Record<IpcCommand,…>` 要求逐个列出）→ 跑绿
- [ ] 种子数据要求：≥2 个项目（1 个 active、1 个 archived）、1 张完整率 ≥80% 的实体卡（字段状态覆盖 官方口径/待确认/存疑 三种）、1 个 62 条 prompt 的题库（覆盖 7 类意图、含分组/权重/标签/来源）、1 个 28 条的"样本不足"题库（用于验证 `SampleSizeAlert`）、设置与服务商档案种子
- [ ] Commit `feat(ui): demo 假后端骨架与静态种子数据`

### Task 12: demo 后端 · M1 命令

**Files:**
- Modify: `src/demo/backend.ts`、`src/demo/db.ts`
- Create: `src/demo/handlers/{project.ts,entity-card.ts}`
- Test: `src/demo/handlers/project.test.ts`、`entity-card.test.ts`

**Interfaces:**
- Consumes: Task 11 的 `DemoDb` / `DemoHandler`
- Produces: 实现 `project_create/list/get/update/archive/delete/export/import/export_competitors_csv/export_assets_csv`、`entity_card_autobuild/get/update_field/revisions`、`competitor_upsert/list/delete/reorder`、`asset_add/list/delete`
- Produces: `entity_card_autobuild` 在 demo 下**不抓网页**：延迟 800ms 后返回种子里预置的实体卡，并对 `domain` 做非空与 http(s) 校验（不合法则 reject `{code:'validation/failed', params:{field:'domain',reason:'invalid_url'}}`）
- Produces: `entity_card_update_field` 追加一条 revision（字段级留痕在 demo 里也要成立，否则 Plan B 的修订时间线无法走查）

- [ ] 写失败测试：建项目→列表出现→归档→按 `archived` 过滤；导出 JSON 再导入得到同名项目；改实体卡字段产生一条 revision 且 `field_status` 生效；自动建档对空域名 reject 出 `validation/failed`
- [ ] 跑红 → 实现 → 跑绿
- [ ] 在 `src/pages/ProjectListPage.test.tsx` 增加**一条**走 `demoBackend` 的用例（把 `@tauri-apps/api/core` 的 invoke 转发到 `demoInvoke`，断言种子项目渲染出来）；`src/test/invoke-mock.ts` 保持不动，存量测试继续用它
- [ ] Commit `feat(demo): M1 项目与实体卡命令的内存实现`

### Task 13: demo 后端 · M2 题库命令

**Files:**
- Create: `src/demo/handlers/prompt.ts`
- Modify: `src/demo/backend.ts`、`src/demo/db.ts`
- Test: `src/demo/handlers/prompt.test.ts`

**Interfaces:**
- Consumes: Task 11
- Produces: 实现 `prompt_set_generate/list/get/rename/delete/dedupe/export_csv/import_csv`、`prompt_item_update/add/delete`
- Produces: `prompt_set_generate` 在 demo 下延迟 1200ms 后**克隆种子里那份 62 条题库**（新 `id`、`label` 带时间戳），不跑模板展开与 LLM；返回的 `DedupeReport`/完整率等统计值取种子静态值
- Produces: `prompt_set_dedupe` 在 demo 下**不做任何相似度计算**（AGENTS.md 规则 9：领域算法不在 demo 里实现），只返回种子预置的静态 `DedupeReport`（`merged=0`、`remaining=条目数`）
- Produces: `prompt_set_import_csv` 做**表头校验**（与真实后端同一份表头常量，从 `src/api/constants.ts` 取），错误行报告形状与真实后端一致

- [ ] 写失败测试：生成后 `prompt_set_list` 多出一条且条目数 62；`prompt_item_add` 后条目数 +N 且返回整份快照；`prompt_item_delete` 删空时 reject `validation/failed`（reason=`empty`）；CSV 导出→导入往返条目数一致；表头缺列时返回错误行报告
- [ ] 跑红 → 实现 → 跑绿
- [ ] Commit `feat(demo): M2 题库生成与增删改导入导出的内存实现`

### Task 14: demo 后端 · 设置、密钥与文件导出

**Files:**
- Create: `src/demo/handlers/{settings.ts,secret.ts,export.ts}`
- Modify: `src/demo/backend.ts`
- Test: `src/demo/handlers/settings.test.ts`、`export.test.ts`

**Interfaces:**
- Consumes: Task 11
- Produces: 实现 `settings_get/update`、`secret_set/status/delete`、`llm_provider_test`、`llm_providers`、`export_write_file`
- Produces: `secret_*` 只写 `DemoDb.secrets`（内存），`secret_status` 返回 `{configured, secret_ref}`，**永不回值**；UI 侧文案必须提示"演示模式不会写入系统钥匙串"
- Produces: `llm_provider_test` 在 demo 下延迟 600ms 后返回 `{ok:true, model:<档案默认模型>, latency_ms:600, prompt_tokens:12, completion_tokens:4, cost_cny:0}`；若该 provider 未"配 Key"则 reject `{code:'llm/missing_secret'}`（让 Plan B 能走查引导文案）
- Produces: `export_write_file` 在 demo 下走**浏览器下载**（`Blob` + `<a download>`，CSV 带 BOM），返回文件名而不是路径——与桌面端（dialog 插件）行为不同，这是**有意的运行时分叉**，必须在 `export.ts` 顶部注释写明原因

- [ ] 写失败测试：`settings_update` 后 `settings_get` 返回新值；`secret_set` 后 `secret_status.configured===true` 且返回体里没有值字段；未配 Key 时 `llm_provider_test` reject `llm/missing_secret`；`export_write_file` 在 jsdom 下触发一次 `URL.createObjectURL` 且 CSV 内容以 BOM 开头
- [ ] 跑红 → 实现 → 跑绿
- [ ] Commit `feat(demo): 设置、密钥与导出的内存实现（导出走浏览器下载）`

### Task 15: 口径收尾——成本展示、README、mise 任务、残留扫描、门禁

**Files:**
- Modify: `apps/desktop/ui/src/components/SecretStatus.tsx`（测试结果去掉「成本」行）
- Modify: `README.md`（`mise run web` 的描述改为 demo 模式 + 能力边界）、`.mise.toml`（新增 `demo:preview`）
- Modify: `docs/superpowers/specs/2026-09-16-geo-desktop-p0-design.md`（在 §7 决策记录追加一行指向新 spec，避免两份文档口径打架）
- Test: `apps/desktop/ui/src/components/SecretStatus.test.tsx`

**Interfaces:**
- Consumes: Task 7 词典、Task 10-14 demo
- Produces: `mise run demo:preview` = `pnpm --dir apps/desktop/ui run build && pnpm --dir apps/desktop/ui exec vite preview --port 4173`
- Produces: 测试结果只展示 模型 / 耗时 / token 用量（`cost_cny` 字段仍由后端返回，前端不渲染）

- [ ] 写失败测试：`SecretStatus` 在测试成功后渲染"模型/耗时/用量"三项且**不含**「成本」与 `¥`
- [ ] 跑红 → 改 `SecretStatus`（文案经 `t()`）→ 跑绿
- [ ] 改 README：`mise run web` 一节写明 demo 模式、静态数据、刷新重置、不代表真实算法结果；补 `mise run demo:preview` 用法
- [ ] 改完 `SecretStatus` 后**重跑 Task 8 的 `no-hardcoded-strings` 扫描测试**，确认没把硬编码中文带回来
- [ ] 残留扫描：`rg -n '[\u4e00-\u9fa5]' apps/desktop/ui/src --glob '!**/*.test.*' --glob '!**/locales/**'` 结果必须只剩注释；有则回到 Task 8/9 补
- [ ] 全量门禁：`mise run check`（无 mise 激活时 `export PATH="/opt/homebrew/bin:$PATH"` 后执行），把完整输出存 `/tmp/plan_a_check.log`
- [ ] 手动验收（需真人）：`mise run web` → 浏览器走完 建项目 → 自动建档 → 生成题库 → 导出 CSV；切 English 全站无中文残留；切回中文正常
- [ ] Commit `chore: 收尾成本展示口径、demo 入口说明与门禁`

---

## Self-Review

**1. Spec 覆盖**

| spec 条目 | 落在哪个 task |
|---|---|
| §4.1 运行时形态与 IPC 适配层、横幅、能力边界 | Task 10、11、15 |
| §4.2 错误契约 i18n（`params`、reason key、词典、完整性测试、~39 处测试改造） | Task 1、2、3、4、5、6、7 |
| §4.8 成本口径（UI 不展示、代码不动、文档放宽） | Task 15（文档已在 `2a0ffa4` 完成） |
| §7 Plan A 交付判据（demo 走完全流程 / 切英文无残留 / 门禁全绿） | Task 12、13、14、15 |
| §8 测试策略（词典完整性、`detectRuntime`、demo 命令形状、禁网） | Task 1、7、10、11-14 |
| §4.3-4.7、§4.9（档案制、协议、设置页 IA、外观、权限、数据与存储） | **不在 Plan A**，属 Plan B/C（spec §7 分期） |

**2. 占位符扫描**：每个 task 都有具体文件路径、接口签名与测试断言；无 TBD / "适当处理" / "类似 Task N"。Task 8/9 的抽取范围用文件清单枚举，不用"等等"。

**3. 类型一致性**：`IpcCommand` / `IPC_COMMANDS` / `demoBackend: Record<IpcCommand, DemoHandler>` / `demoInvoke` / `detectRuntime` / `Runtime` / `Locale` / `TranslationKey` / `describeIpcError` / `GeoError::params` / `LlmError::params` / `StoreError::params` / `CrawlerError::params` / `IpcError::with_params` 在各 task 间命名一致；reason key 目录只在 Task 3 定义一次，Task 4/5 显式 Consumes。

**4. 已知风险**：① Task 8 的静态扫描测试用 `import.meta.glob(?raw)` 读源码，若 Vitest 配置不支持需退化为 `node:fs` 读文件（jsdom 环境下 `fs` 可用需 `environment: node` 或改用 `?raw`）——实现时二选一，两者都能守住"无硬编码中文"这条。② Task 5 是本计划最大的一块（~55 个站点 + ~39 处测试断言），若单 task 过大可按 crate/服务文件拆成两次提交，但必须在同一个 task 内跑绿门禁。③ 存量 UI 测试固定 zh-CN 的前提是 Task 6 的 `src/test/setup.ts` 接线到位（已按裁定从 Task 9 提前），否则 Task 8/9 会大面积红。④ `contracts/error-codes.json` 只被测试导入，运行时不导入。Task 1 已实测：测试侧 5 层相对路径导入**无需**改 `tsconfig.app.json`（`resolveJsonModule` 本来就开）也无需改 `vite.config.ts`（Vite 的 workspace root 由向上找 `.git` 推出即仓库根，`contracts/` 在允许范围内）；但若将来要在**应用运行时代码**里导入它，dev server 仍可能 403，届时需加 `server.fs.allow`。
