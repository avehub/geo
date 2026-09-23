# Plan A · i18n 基座 + Demo 假后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行状态（2026-09-23 控制器补记）**：本计划已按 `superpowers:subagent-driven-development` 执行完毕，分支 `feat/settings-redesign-demo-i18n`（基线 `main` = `73afef9`，全分支复审在 `b893fd9` 上做的），复审裁定 **Approved with minors · 可合并**。
> **正文那 88 个 `- [ ]` 勾选框刻意未回填**：执行走的是「每任务一份简报 + 一份报告 + 一份复审」的台账流程，逐步状态记在 gitignored 的 `.superpowers/sdd/` 下，回填勾选框只会造出第二份需要人工同步的真相。
> **要看结果请看**：门禁 `mise run check`（cargo 22 targets / 515 passed / 0 failed；vitest 42 files / 635 tests）· 已知差异与后续待办 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`（E-1…E-32 + §5 后端待办 + §6 工程债 + §7 常驻条款）。
> **唯一未关闭的验收项**是下面 Task「手动验收（需真人）」那一步 ⇒ 已路由到上述清单 **§8**。

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
- Produces（**顺序约束，控制器裁定**）：本 task 早于 `GeoError::params()`（Task 3）与 `StoreError/LlmError/CrawlerError::params()`（Task 4），所以四个 `From<…> for IpcError` 里的 params 只能**就地按变体字段拼**（如 `GeoError::NotFound{kind,id}` → `{kind,id}`）。这份临时映射由 Task 3 / Task 4 各自负责改成委托 `.params()` 并删除；本 task 不要为了「将来好改」而提前抽象出共享 helper。params 的键名一律照 `contracts/error-codes.json` 里该 code 的 `params` 数组。

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
- Produces（**控制器裁定，补 Task 2 留下的接缝**）：`apps/desktop/src-tauri/src/error.rs` 的 `From<GeoError> for IpcError` 改为委托 `GeoError::params()`，并删掉 Task 2 就地拼 params 的那份临时映射 —— 否则同一个映射存在两份，必然漂移。改完 Task 1 的穷举守卫与清单用例必须继续绿，Task 2 的 params 断言必须继续绿（键名不变，只是来源换成 `params()`）。
- Produces: **reason key 目录**（写进 `error.rs` 文档注释，Task 4/5/6 复用）：`required` `empty` `too_long` `too_short` `invalid_url` `invalid_id` `invalid_format` `duplicate` `out_of_range` `not_allowed` `missing_header` `row_invalid` `unknown_provider` `missing_base_url` `missing_model` `parse_failed`
- Produces（**控制器裁定**）：上表补两个 key，共 **18** 个——`unknown_field`（`未知字段：{key}` 归 `invalid_format` 会说谎：路径格式本身是对的）与 `write_failed`（CSV 导出写失败归 `parse_failed` 同样说谎）。目录以 `crates/geo-domain/src/error.rs` 的模块文档注释为唯一真值源，契约文件的 `note` 不再复制 key 清单（避免漂移）。
- Produces（**控制器裁定**）：`Validation` / `Conflict` / `Config` 三个变体各加 `extra: BTreeMap<String,String>`，`params()` = 基础键 ∪ extra；两参构造器签名不变（存量调用点照常编译），另加链式 `GeoError::with_param(key, value: impl Display)`，对不带 extra 的变体 `debug_assert!` 后原样返回。理由：今天的中文字面量携带真实信息（`长度不能超过 60 字`、`成立年份需在 1900~2100 之间`、`未知字段：products.foo`），i18n 之后只能靠「词典模板 + 语言中立参数」重现，塞不回 reason key。
- Produces（**控制器裁定**）：`contracts/error-codes.json` 允许 **params-only** 编辑（codes 仍冻结）——`validation/failed` → `["expected","field","limit","reason","value"]`、`state/conflict` → `["reason","value"]`、`config/invalid` 不动。原则：**清单声明的 params 必须恰好等于后端能发出的键集**（Task 4 把它变成断言）。
- Produces（**控制器裁定**）：`too_long`/`too_short` 只表**字符数**并配 `limit`；数量与数值区间一律 `out_of_range` + `expected`（语言中立表达式，如 `"1~5"`、`"<=5"`、`"0~9"`）。单位（字/个/家）属于文案，只能由词典模板给出——参数里出现「60 字」等于把中文塞回 params。
- Produces（**控制器裁定**）：`io/failed` 与 `data/invalid` 的 `reason` 保留**原始错误文本**（raw passthrough），不强造 key（OS/serde 错误没有有限词表）。由此定下前端词典规则（Task 7 依赖）：先查 `errors.reasons.<reason>`，**查不到就原样显示该值**；同一规则覆盖 `upstream/*` 的上游原文。
- Produces: `GeoError::user_message()` 语义变更为"日志/兜底文案"，不再承诺中文散文

- [ ] 写失败测试：`GeoError::validation("brand_name","required").params()` == `{field:"brand_name", reason:"required"}`；`to_string()` == `"validation/failed field=brand_name reason=required"`；`not_found` 的 params == `{kind, id}`；`upstream` 的 params == `{upstream_code, upstream}`
- [ ] 跑红：`mise exec -- cargo test -p geo-domain error::`
- [ ] 实现 `params()` 与新 `Display`；把 `geo-domain` 内所有中文 reason 换成目录里的 key（如 `"不能为空"` → `required`，`"不是合法网址：{domain}"` → `invalid_url` 且把值放进 `params`）
- [ ] 修受影响的既有测试（断言中文文案的改为断言 `code` + `params`）
- [ ] **控制器裁定：谁弄红谁修**——门禁是 `cargo test --workspace` 全绿，本轮必须一并修好 geo-domain 之外被 `Display`/`user_message` 变更弄红的断言（已知：desktop `project_service.rs` 7 处、`error.rs` 5 处、`settings_service.rs` 2、`prompt_service.rs` 2、`geo-store/src/error.rs` 6、`tests/entity_card_service.rs` 1），修法统一为断言 `code` + `params`，不得把中文塞回去。壳里只许改被弄红的断言 + 删 `From<GeoError>` 的临时 match，**不要动 `IpcError::Display`**（Task 2 fix round 1 已修好重复码，有整串断言钉住）。
- [ ] 同步 `crates/geo-store/src/error.rs:100-126` 的 `GeoError ↔ StoreError` 双向转换以适配 `extra`（本轮允许 `GeoError → StoreError` 方向丢掉 extra，Task 4 补齐）
- [ ] 契约 params-only 编辑与 `params()` 实现放在**同一个 commit**（理由写进 commit body）
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
- Produces（**控制器裁定，补 Task 2 留下的接缝**）：`apps/desktop/src-tauri/src/error.rs` 的 `From<StoreError|LlmError|CrawlerError> for IpcError` 三个 impl 改为委托各自的 `params()`，删掉 Task 2 的临时映射；Task 1 的守卫与 Task 2 的 params 断言继续绿。
- Produces: `LlmError::Config(reason_key)`；`missing_base_url` / `missing_model` / `unknown_provider` 三个 key 由 `client.rs` 与 `state.rs` 共用
- Produces（**控制器裁定**）：`StoreError` 的 `Validation` / `Conflict` / `Config` 加上与 `GeoError` 同形的 `extra: BTreeMap<String,String>`，把 Task 3 留下的 `GeoError → StoreError` 有损往返补成无损。
- Produces（**控制器裁定**）：契约 params 对齐——复审已核实当前只发子集的 **5** 个码：`crawler/network`（缺 `url`、`status`）、`crawler/too_large`（缺 `limit`）、`crawler/invalid_url`（缺 `url`）、`llm/bad_response`（缺 `upstream`）、`llm/deserialize`（缺 `upstream`）。默认方向是**把清单 params 收缩到变体实际能带的键**（params-only 编辑、codes 不动、与 `params()` 实现同一 commit）。**这五个码的富化/收缩方向已由下一条裁定（Task 3 复审后补）逐码定死**——`TooLarge` 补 `limit` 已核实为便宜，走富化；实现者不必再选。
- Produces（**控制器裁定**）：新增漂移守卫——每个 code 的「清单声明 params」必须等于「守卫清单里所有构造实例发出的键的**并集**」（按 code 聚合取并集，不是逐实例相等）。
- Produces（**控制器裁定，Task 3 复审后补**）：上一条的「如果便宜就做」已核实为**便宜**，方向定为——`crawler/too_large` 保留 `["url","limit"]` 并给变体补 `limit`（`fetch.rs:143/156` 两处 `self.limits.max_bytes` 都在作用域内）；`crawler/network` 保留 `["url","status","reason"]`，把 `Network(String)` 富化成 `Network{url:Option<String>,status:Option<u16>,reason}`（`fetch.rs:126` 两者都有、`:204` 只有 url、`:85` 都没有）；`crawler/invalid_url` 保留 `["url","reason"]`，把 `InvalidUrl(String)` 富化成 `InvalidUrl{url,reason}`（`fetch.rs:77` 代理地址、`extract.rs:144` 都拿得到 url）。**只有** `llm/bad_response` 与 `llm/deserialize` 走收缩：`["reason","upstream"]` → `["reason"]`——站点从来没有上游原文（`client.rs:322/325`、`json.rs:38/66` 都只有一段说明），且把响应体塞进错误违反「错误里不得出现完整回答正文」（`crates/geo-llm/src/error.rs` 模块注释自己写着）。
- Produces（**控制器裁定，Task 3 复审后补**）：`config/invalid` 的 params → `["reason","value"]`，reason key 目录新增 **1** 个 key `secret_unavailable`（18 → **19**）。`crates/geo-store/src/secret.rs` 已把 `keyring::Error::NoEntry` 在 `get`/`delete` 里当 `Ok(None)`/`Ok(())` 吞掉（没存过不是错误），因此**不存在** `secret_not_found` 这种情形，别加第二个 key。`StoreError::Secret(String)` 形状不变（那个 String 就是已 `redact` 的底层原文），`params()` = `{reason:"secret_unavailable", value:<该原文>}`。
- Produces（**控制器裁定，Task 3 fix round 1 复审 N-1/N-2 后补**）：目录一改，镜像表必须同一 commit 跟着改——`crates/geo-domain/tests/reason_key_sites.rs` 的 `companion()` 自称「与目录同源」，本任务把目录 18 → 19 键，因此**该测试文件加进本任务的允许写入集**，四件事一次做完：① `secret_unavailable` 归入 `Contains(&["value"])`；② **N-1**——`row_invalid` / `unknown_provider` 今天被错归进 `Exactly(&[])`，与目录（两行都写 `value`）相反，移进 `Contains(&["value"])`；③ **N-2**——`the_table_covers_every_production_site` 的 `per_file` 只列 7 个文件，而 `crates/geo-domain/src/` 实有 10 个，把 `dedupe.rs` / `lib.rs` / `error.rs` 以期望 **0** 补进去（数组长度 7 → 10；控制器已实测三者生产站点数为 0），否则在未列文件里新增站点能静默绕过反向计数；④ `companion()` 的 `other => panic!(…)` 消息与两处文档注释里的「18 key」「`error.rs:14-46`」改成**不带行号**的稳定指向（Task 3 报告已记录过行号漂移），键数改 19。这四条今天都不会让任何测试变红（`secret_unavailable` 只由 geo-store 发出、`row_invalid`/`unknown_provider` 在 geo-domain 内零站点、`companion()` 只遍历 geo-domain 自己那两张表），所以**必须靠变异自证**：往 `dedupe.rs` 塞一个合成 `GeoError::validation("x", "required")`，`the_table_covers_every_production_site` 必须红（复审者实测：修之前该变异**存活**），跑完立即还原并用 shasum 证明工作树干净。
- Produces（**控制器裁定，Task 3 复审后补**）：`From<StoreError> for GeoError` 里两处 raw passthrough 泄漏必须收——`StoreError::Sqlx` 命中唯一约束今天是 `GeoError::conflict(sqlx_error.to_string())`（reason 装 SQL 原文，违反「`state/conflict` 的 reason 是稳定 key」），改 `GeoError::conflict("duplicate").with_param("value", …)`；`StoreError::Secret(reason)` 今天是 `GeoError::config(reason)`（reason 装 keyring 原文），改 `GeoError::config("secret_unavailable").with_param("value", reason)`。
- Produces（**控制器裁定**）：`llm/config` 的 params → `["reason","value"]`。`client.rs:212` 不得把 `Provider::label_zh()`（中文）塞进 params，改用 `Provider::as_str()` 的稳定 id 装 `value`、reason = `missing_base_url`；`client.rs:218` → `missing_model`（无 extra）；`client.rs:239` 请求体序列化失败 → `parse_failed` + `value`=serde 原文。一次声明省得 Task 5 的 `unknown_provider` 再改契约（**`value` = 用户传进来的那个不存在的档案标识**，不是合法取值列表——列表属于文案，只能由词典模板给；见 Task 5 裁定 R-E）。
- Produces（**控制器裁定**）：`llm/transport` 的 `reason` 必须是 `network`/`timeout`/`other` 三个 key（契约 note 早就这么写），但今天 `From<LlmError>` 塞的是 `transport_error.to_string()`（中文散文）——给 `TransportError` 加 `reason_key()`，`Display` 一并转紧凑格式。
- Produces（**控制器裁定**）：目录注释补三条判据。① `parse_failed` = **解析器/序列化器库**返回的 `Error`（csv / serde / url / html2text），`value` 装库原文；`invalid_format` = **我们自己写的形状/类型判据**（下标非法、父节点不是数组、协议不是 http/https），`value` 装出错的值——目录里 `parse_failed` 的语义相应从「解析上游响应/文件内容失败」放宽为「序列化/反序列化失败（上游响应、文件内容、请求体）」。② `expected` 语法 = `a~b` / `<=n` / `<n` 三种纯 ASCII 形态，**不带单位**（单位属于文案，只能由词典模板给）。③ 目录首行写清适用范围：`unknown_provider`/`missing_base_url`/`missing_model` 经 `LlmError::Config`（`llm/config`）发出而非 `GeoError::Config`；`row_invalid`/`missing_header` 经 CSV 路径发出。
- Produces（**控制器裁定**）：手写三个 crate 的 `Display`（`code()` 对 `{kind}/not_found`、`upstream/{code}` 是动态前缀，thiserror 的 `#[error("…")]` 表达不了，与 Task 3 同因），并手写对应的 `std::error::Error` / `From` 保住现有 `#[from]` 语义。之后**逐 crate** 确认 thiserror 真的没有引用了，再从**该 crate 自己的** `[dependencies]` 删掉（含 Task 3 留下的 `crates/geo-domain/Cargo.toml`——已核实 geo-domain 只剩一处文档注释提及它）；**根 `[workspace.dependencies]` 表不许动**（壳还在用）。
- Produces（**控制器裁定**）：`state/conflict` **不得**加 `stage` 参数。CSV 三段写失败（表头/行/结束）合并成 `write_failed` 后丢掉的阶段信息**接受丢失**——`value` 里的 OS/驱动原文已能区分磁盘满与权限拒绝，为一个阶段标签去扩冻结契约是拿稳定性换零用户价值。
- Consumes: `a8eb95d` 给 `crates/geo-crawler/src/fetch.rs` 与 `crates/geo-llm/src/transport.rs` 加的 `no_proxy()` 分支不得回退（未配代理时绝不走系统/环境代理，否则本机 wiremock 用例会被劫持成 502）。

- [ ] 写失败测试：`LlmError::MissingSecret.params()` 为空 map 且 `code()=="llm/missing_secret"`；`LlmError::Server{status:500}.params()=={status:"500"}`；`CrawlerError::Timeout{url}.params()=={url}`；`StoreError::not_found("prompt_set","x").params()=={kind,id}`
- [ ] 跑红：`mise exec -- cargo test -p geo-llm -p geo-store -p geo-crawler`
- [ ] 实现 `params()`；把三个 crate 里 `#[error("中文…")]` 的 Display 改为紧凑格式（保留 code 不变）
- [ ] 写失败测试（漂移守卫）：逐个 code 断言「清单声明的 params 集合 == 守卫清单里该 code 所有实例发出键的并集」，两端都用集合比较，避免顺序造成假红
- [ ] 修既有测试断言；跑绿（含 `crates/geo-llm/tests/`）
- [ ] **控制器裁定**：`crawler/invalid_url` 富化成 `{url,reason}` 后，Task 2 fix round 1 钉死的那条断言（`apps/desktop/src-tauri/src/error.rs` 的 `llm_and_crawler_params_follow_the_contract`：键集恰为 `{reason}`、`contains_key("url")==false`、`len()==1`）**必须同步改成 `{url,reason}`**，否则它与本任务新加的漂移守卫互相矛盾。
- [ ] **控制器裁定（复审 M-2）**：往壳侧 `geo_cases()` 里塞一个**带 extra 的 `Config`** 实例。今天 `config/invalid` 只登记 `["reason"]` 且 `geo_cases()` 里的 `config("missing_base_url")` extra 为空，Task 5 一旦写 `GeoError::config("x").with_param("value", …)` 就会发出清单外的键而**没有任何测试变红**。
- [ ] **控制器裁定（复审 N-1/N-2）**：同步 `crates/geo-domain/tests/reason_key_sites.rs` 的镜像表（`secret_unavailable` 入表、`row_invalid`/`unknown_provider` 移进 `Contains(&["value"])`、`per_file` 7 → 10、去掉行号硬编码），并用 `dedupe.rs` 合成站点变异自证反向计数守卫真的会红。
- [ ] Commit `refactor(crates): 三个基础 crate 的错误统一输出 code+params`
- **fix round 1 事后记账（控制器）**：复审实证 Task 4 主 commit 对 N-1 的修复是装饰性的（把 `row_invalid` 移回 `Exactly(&[])` 仍全绿），且漏报了第 6 处中文散文（`crates/geo-store/src/codec.rs:35`）。fix round 1（commit `fix(crates): params 取值退出中文散文，目录 19→23 键并加同源守卫`）补了：目录 **19 → 23**（`missing_choices` / `json_not_found` / `validation_failed` / `http_status`）、`BadResponse`/`Deserialize` 改 `{reason,extra}` 结构体形、`Blocked{url,content_type}`（reason 恒为 `not_allowed`）、serde 原文 `value` 限长 200 字符、release 下 `extra` 不得顶掉基础键、以及**目录 ⟷ `companion()` 双向同源守卫**（`the_directory_table_and_companion_table_agree`，解析 `include_str!` 的目录表）。**后文任何提到「19 个 key」的地方一律读作 23。**
- **fix round 2 事后记账（控制器）**：round 1 的复审结论是「全部 finding 已闭合、无新增 Critical/Important」，I-1 由复审者亲自重做 M8' 变异实证变红（EXIT=101，失败的就是 `the_directory_table_and_companion_table_agree`，lib 套件仍 86/0）。round 2（commit `f92b1a7`，仅 3 文件 +27/−6）只收 3 条 Minor：① `crates/geo-llm/src/json.rs` 的校验器原文从 `debug!` 升 `warn!`，**并补上终态失败那条 `warn!`**——复审发现循环里的日志只描述「追问前」那次失败，终态那次 `failure` 无人记录，叠加壳侧默认 `info` 过滤器，「原文只进日志」这半句在终态路径上原本不成立；② `apps/desktop/src-tauri/src/error.rs` 的 EXEMPT 注释**删掉行号**（不是把 `:109` 改成 `:108`），按 Task 3 的「注释用不带行号的稳定指向」裁定；③ `crates/geo-llm/tests/chat_json.rs` 那个名字承诺「truncated in params」却从不碰 params 的用例改名为 `repair_prompt_carries_the_full_serde_detail`。**后文任何引用旧测试名的地方一律读作新名。**
- **控制器明确拒绝、不许后人再提的三条**：`crawler/blocked` 的 `value`（远端 Content-Type）**不加长度上限**（`HeaderValue::to_str()` 已保证 ASCII、是 MIME 类型不是自由文本、瞬时错误不落库）；`companion()` 的 `Contains` **不改成双向相等**（`Contains` 是刻意的下界语义——目录给 `out_of_range` 登记了 `expected`+`value`，但 8 个站点里 7 个不带 `value`，改双向会让那 7 个全红）；`crates/geo-domain/src/compliance.rs` 的 `、` 分隔符**不改**（见 Task 7/8 的展示策略裁定）。M-3（`source()` 链）维持拒绝，Park 到末尾全分支评审。

### Task 5: desktop 服务层错误站点 key 化

**Files:**
- Modify: `apps/desktop/src-tauri/src/{state.rs,error.rs}`、`apps/desktop/src-tauri/src/services/{project_service.rs,project_transfer.rs,prompt_service.rs,entity_card_service.rs,settings_service.rs}`
- Modify（**控制器裁定 R-C4，Task 4 复审后补**）：`crates/geo-crawler/src/site.rs` —— 只许改 `SkippedPage.reason` 的取值形态（见下），别的 crate 一律不许动
- Test: `apps/desktop/src-tauri/tests/*.rs` 与各文件 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 2 的 `IpcError::with_params`、Task 3/4 的 reason key 目录
- Consumes: Task 1 落在 `apps/desktop/src-tauri/src/error.rs:22`-`33` 的 `pub(crate) mod err_codes`（5 个壳内 code 常量）与 4 个无兜底 `match` 穷举守卫（`llm_code` / `crawler_code` / `geo_code` / `store_code`）。**站点改造一律走常量，不要把字面量重新写回去**；守卫与清单用例必须继续绿（它们红了说明你改的是 code 本身，而 code 已冻结）。
- Produces: `state.rs` 的 `config_from_settings` 错误码固定为 `llm/config`，params 带 `reason=missing_base_url|missing_model|unknown_provider`（前端据此渲染"设置 → 模型服务商 → 接口地址"这类可操作指引）
- Produces: 约 40 处 `GeoError::validation(...)`、~15 处 `conflict/config` 全部使用目录内 key
- Produces（**控制器裁定，认领 Task 3 复审 I-2**）：`CsvRowError` 从 `{row, reason:String}` 升级为 `{row, reason:<目录 key>, params:BTreeMap<String,String>}`（`crates/geo-domain/src/csv_io.rs`）。理由：`csv_io.rs:149` 今天把 `user_message()`（Task 3 之后是紧凑日志串）塞进 `reason`，而 `apps/desktop/ui/src/components/CsvToolbar.tsx:49` 是 `第 {error.row} 行：{error.reason}` **逐字渲染**、`src/api/types.ts:348` 声明为 `{reason:string;row:number}`——这是 Task 3 留下的**当前就可见**的退化（日志串与未改的中文散文混排），不是「将来才修」。`parse_prompt_row` 自己那批中文字面量一并收：csv 物理行读不出来 → `row_invalid`+`value`=csv 原文；`text` 空 → `required`；超长 → `too_long`+`limit`；`intent` 非法 → `invalid_format`+`value`；`weight`/`repeat_count` 非数字 → `invalid_format`+`value`、越界 → `out_of_range`+`expected`+`value`；compliance → `not_allowed`+`value`=命中词（命中词是**数据**不是文案；**控制器在 Task 4 fix round 1 复审后确认这条口径不变**——复审曾指出 `crates/geo-domain/src/compliance.rs:93` 用中文 `、` 拼接红线词进 `value`，裁定是**后端不改**：`params` 装语言中立数据、「渲不渲染」是词典的决定，把命中词从 params 摘掉会让「同一个 `compliance::check()` 的产物走 `GeoError` 带 value、走 CSV 行错误不带」自相矛盾。泄漏面在渲染侧，已由 Task 7 的 code 级模板与 Task 8 的 `CsvToolbar` 口径收口。本任务要收的只是 `csv_io.rs:148` 那句 `user_message()` **紧凑串**，换成结构化 `{reason, params}`）。**本任务仍不碰 `apps/desktop/ui/**`**：TS 结构类型对多出来的 `params` 字段宽容，`reason` 显示成 key 的窗口期到 Task 8 抽 `CsvToolbar` 时关闭（用户走查在 Task 15 之后）。收完之后 `csv_io.rs` 里 `user_message()` 的生产用法归零。
- Consumes（**控制器裁定，Task 3 fix round 1 复审后补**）：`crates/geo-domain/tests/reason_key_sites.rs` 的反向计数守卫**盯住 `csv_io.rs` 的站点数（今天 10）**。本任务改 `csv_io.rs` 时若新增或删除了 `GeoError::validation|conflict|config(` 生产站点，那条守卫会红——**这是预期行为，不是越界**：同一 commit 里同步 `SITES`/`UNREACHABLE` 两张表与 `per_file` 的期望值即可。若只改 `CsvRowError`（它不是 `GeoError`），计数不变、守卫应保持绿，此时**不许**为了「让测试更有覆盖」而擅自加站点。
- Consumes（**控制器裁定**）：`crates/geo-domain/src/entity_card.rs:444` 那处已证实的死代码（`root_field` 的唯一调用点被前一行 `parse_path` 拦掉）**本任务不许删**——Task 3 用「字面量出现次数 = 2」钉住它，删掉会造成假红且要同步改表行 #46。Park 到末尾全分支评审统一处置。
- Produces（**控制器裁定，认领 Task 4 复审 I-2**）：`PromptSet.notes` 的**降级说明行**改为机器行——`degraded ` + 紧凑 JSON：`degraded {"stage":"expansion|rewrite","code":"<code>","params":{…}}`。今天 `degradation_note(step, reason)`（`services/prompt_service.rs:809`）把 `redact(&error.user_message())` 的**紧凑日志串**焊进一句中文散文再落库，`apps/desktop/ui/src/pages/PromptSetPage.tsx:266` 原样渲染 ⇒ 用户看到「模型意图扩写已降级（原因：llm/transport reason=other）」，既不可本地化又新旧两种形态混排。改法：`expand_with_model` / `rewrite_with_model` 的 `Err(String)` 改成携带 `code`+`params`（如 `Err(IpcError)`），`degradation_note` 只产机器行；「本轮题目改由行业模板与本地口语化改写补足」是**文案**，交给 Task 8/9 的词典模板。写进机器行的 `params` **逐值过 `redact`**（notes 会持久化，泄漏面比一次性消息更久），并加一条「网关回显 Key 时落库 notes 不含该 Key」的测试。**只改降级这一类行**：`report_quota_shortfall` / `shortfall_advice` / 合规拦截行仍是中文散文（既存状态、非本轮回归），结构化 notes + 迁移是后续 plan 的 backlog，不许顺手改（会牵动 `crates/geo-domain`）。
- Produces（**控制器裁定，认领 Task 4 复审 M-5 的另一半**）：`ipc/internal` 的 `reason` 收口——契约给它声明了 `reason`，发射点是 `IpcError::internal`（`apps/desktop/src-tauri/src/error.rs:109`），但没有任何调用点填它，所以它今天停在漂移守卫的 `EXEMPT` 里。二选一并在报告里说明理由：① **优选**给调用点补目录内的 reason 键，把它从 `EXEMPT` 挪出来让并集守卫覆盖；② 若调用点全是不可分类的内部错误，就把契约里 `ipc/internal` 的 `reason` 声明删掉（params-only 编辑，与实现同一 commit）并在 `EXEMPT` 注释里写明。
- Produces（**控制器裁定 R-C4**）：`crates/geo-crawler/src/site.rs` 的 `SkippedPage.reason` 今天形态混用（`:121`/`:137` 是中文说明、`:156` 是 `CrawlerError::user_message()` 的紧凑串），而它经 `entity_card_service` 落进 `crawler/empty` 的 `skipped` 参数（该 code 今天在 `EXEMPT` 里，本任务接管）。接管时进 params 的 reason 一律改成稳定记号/目录键，中文说明留在日志与 `SkippedPage` 的内部用途里。注意壳侧新增的 `guard_instance_params_stay_ascii` 哨兵会扫到你加进实例清单的每个新实例，**没有白名单**。

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
- Modify（**控制器裁定，补计划漏掉的接缝**）：`apps/desktop/ui/src/api/client.ts` —— **仅限**给 `IpcRequestError` 增 `readonly params: Readonly<Record<string,string>>`（构造函数 `this.params = payload.params ?? {}`）。理由：Task 2 只给线上类型 `IpcErrorPayload` 加了 `params?`，**没接到类上**（`rg -n params src/api/client.ts` 零命中），而页面 catch 到的是这个类的实例 ⇒ 不改它，`describeIpcError` 拿不到任何插值数据，所有带 `{{field}}`/`{{limit}}`/`{{status}}` 的模板都会渲染成空洞而门禁全绿。**不许**碰同文件的 `unwrapIpcError`/`IPC_COMMANDS`/`userMessage`（归 Task 9）。
- Modify: `apps/desktop/ui/src/i18n/locales/{zh-CN,en-US}/errors.ts`、`fields.ts`
- Modify: **4 个页面**里各自的 `describeError` 改为引用 `describeIpcError`（`ProjectListPage`/`SettingsPage`/`PromptSetPage`/`EntityCardPage`）。**控制器更正**：`rg -n describeError src/` 实测命中 6 个文件 = 这 4 个页面 + `components/CsvToolbar.tsx` + `components/SecretStatus.tsx`；`ProjectWizardPage.tsx` 里没有 `describeError`。两个组件归 Task 8。
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
- Produces（**控制器裁定**）：reason key 与 field 的 **raw passthrough 回退**——`errors.reasons.<reason>` 查不到时原样显示该参数值（覆盖 `io/failed`、`data/invalid` 的 OS/serde 原文）；`fields.<field>` 查不到时同样原样显示，因为后端会发出**动态** field（`competitors[0].name`、`core_pages[1]`），无法穷举进 `fields.ts`。词典模板可用 `{{limit}}` / `{{expected}}` / `{{value}}`（Task 3 已把它们登记进 `validation/failed` 的 params）。
- Produces（**控制器裁定，Task 4 fix round 1 复审后补**）：`not_allowed` 是**一个 reason key、两种相反的展示策略**，词典必须按 **code 分级**而不是只按 reason 分级。`crawler/blocked` 的 `value` 是 content-type（**该显示**）；命中红线词则走**两条互相独立的路径**（**控制器更正：本节早先把它写成了一条，且把参数名写错了**）。**路径 1（reason 级）**：`crates/geo-domain/src/compliance.rs:93` = `GeoError::validation("content","not_allowed").with_param("value", unique.join("、"))`，发出的 code 是 **`validation/failed`**（不是 `compliance/violation`），params 形如 `{field:'content',reason:'not_allowed',value:'<词1、词2>'}`，CSV 导入走这条。**路径 2（code 级）**：`services/prompt_service.rs` 的编辑校验走 `IpcError::new(err_codes::COMPLIANCE_VIOLATION, …)`，code 是 `compliance/violation`，而**冻结契约给它登记的 params 是 `["terms"]`，不是 `value`**（AGENTS 规则 6 明令禁止复述红线词，`compliance.rs:91`-`92` 的注释已写死「词典模板只说需改写、绝不复述红线词」）。所以：① `errors.reasons.not_allowed` 这条**共享回退模板不得含 `{{value}}`**；② 需要显示 `value` 的 code（`crawler/blocked`）用 **code 级模板**覆写；③ 断言分两条——路径 1 喂 `{code:'validation/failed', params:{field:'content',reason:'not_allowed',value:'<某个红线词>'}}`，路径 2 喂 `{code:'compliance/violation', params:{terms:'<某个红线词>'}}`，**两侧 zh 与 en 的输出都不得含那个红线词**，并额外断言 `compliance/violation` 的模板**不含 `{{terms}}`**。理由：本任务已有的「模板里的 `{{xxx}}` 都在该 code 的 params 清单内」是**单向**检查，实现者把 `{{value}}` 写进合规模板也能全绿 — 代价是词典多一层 code 级覆写。
- Produces（**控制器裁定 R-C3，Task 4 复审后补**）：`llm/transport` 的三条 reason 必须写成**可操作指引**而不是名词——`network`（提示检查代理/VPN/DNS/证书）、`timeout`（提示上游超时与并发/频控）、`other`（提示查看日志与上游网关）。理由：Task 4 把 `llm/transport` 的 params 从 `["reason","upstream"]` 收缩成 `["reason"]`，上游原文（DNS/证书/代理细节）此后**只进日志**，「测试连接」失败时用户能看到的诊断全部由这三条文案承载；写得含糊就等于诊断信息比改造前更少。
- Produces（**控制器裁定，Task 4 复审 M-4 后补**）：`crawler/network` 的模板要能插 `{{status}}`，且 `errors.reasons.http_status` 必须有 zh/en 两条——`http_status` 是 `crates/geo-crawler/src/fetch.rs:22` 的 `REASON_HTTP_STATUS`，fix round 1 已把它补进目录（此前它是 reason 的取值却不在词表里，照表建词典会漏）。reqwest 原文那条仍走 raw passthrough 回退，**不要**给它编键。

- [ ] 写失败测试（`dictionary.test.ts`）：遍历 `catalog.codes`，断言 `zh-CN` 与 `en-US` 的 `errors.<code>` 都存在且非空——**`upstream/*` 例外**：改为断言「剥掉 `upstream/` 前缀后的里层 code 在两种语言里都存在」+「`errors.upstream.wrapper` 在两种语言里都存在」；断言 zh/en 的 key 集合完全相等（双向差集为空）；断言没有值等于 key 本身（漏翻标志）；断言 `errors.*` 模板里出现的 `{{xxx}}` 占位符都在该 code 的 `params` 清单内（`params` 为空数组的 code——`llm/missing_secret`、`llm/rate_limited`、`prompt_set/empty_import` 等——模板里不得出现任何 `{{…}}`）
- [ ] 清单导入路径用 **5 层**（`../../../../../contracts/error-codes.json`，同 Task 1，别再按 3 层写红一次）
- [ ] 写失败测试（`errors.test.ts`）：`{code:'upstream/llm/server', params:{upstream_code:'llm/server', upstream:'503 from provider'}}` 在 zh 下渲染出含「上游服务」与 `503 from provider` 的文案、en 下同理；`params` 只有 `upstream_code` 时回退到 `upstream_code`；断言渲染结果里**不残留** `{{` 或 `status` 这类未填充占位符
- [ ] 写失败测试（`errors.test.ts`）：`{code:'upstream/llm/rate_limited'}` 在 zh 下渲染出带「上游服务」的包装文案且不等于 code 本身、en 下同理（验证剥前缀回退真的接通，而不是靠 26 条重复词典）
- [ ] 写失败测试（`errors.test.ts`）：`{code:'validation/failed', params:{field:'brand_name',reason:'required'}}` 在 zh 下渲染为「品牌名不能为空」、en 下渲染为 `Brand name is required`；未命中 code 回退 `message`
- [ ] 跑红：`mise exec -- pnpm --dir apps/desktop/ui run test src/i18n src/api/errors`
- [ ] 实现 `errors.ts`（zh/en 覆盖清单里全部 code）+ `fields.ts` + reason key 词典（`errors.reasons.*`）+ `describeIpcError`
- [ ] 词典完整性断言同时覆盖 `errors.reasons.*`：目录里的 **23** 个 key（Task 4 补 `secret_unavailable`，fix round 1 再补 `missing_choices` / `json_not_found` / `validation_failed` / `http_status`；**清单以 `crates/geo-domain/src/error.rs` 的模块注释表为准**）——**控制器推翻自己早先「整串逐字抄进 TS、不解析」的更正**：词典完整性测试必须用 `fs.readFileSync` 读 `../../../../../crates/geo-domain/src/error.rs`，解析 `//! | \`key\` | 语义 | 配套参数 |` 那张表得到键集，再断言 zh/en 词典**双向**覆盖它。理由：不解析就只剩人工同步，而 Task 3 复审的 N-1 已经实证人工同步会错（镜像表与目录相反却全绿）；Rust 侧同一轮也加了 `the_directory_table_and_companion_table_agree` 做同源守卫，两侧一起把「目录 ⟷ 镜像」这条缝焊死在 zh/en 两侧都存在且非空，且 zh/en 的 key 集合相等；`expected` 参数**整串插入不解析**（zh「需在 {{expected}} 范围内」/ en「expected {{expected}}」，不写正则、不拆区间）；**N-3 记账**——目录给 `out_of_range` 写了 `expected` 与 `value` 两个配套参数，但 8 个站点里 7 个不带 `value`，所以模板里的 `{{value}}` 必须是**可选**占位符（缺了整段不渲染，不许留下空占位符或字面 `{{value}}`）
- [ ] 把 **4 个页面**的本地 `describeError` 换成 `describeIpcError(error, t)`（`CsvToolbar`/`SecretStatus` 留给 Task 8）；跑绿：`mise exec -- pnpm --dir apps/desktop/ui run test`
- [ ] Commit `feat(ui): 错误文案按语言渲染，词典完整性由错误码清单守住`

### Task 8: 存量文案抽取 · 组件层

**Files:**
- Modify: `apps/desktop/ui/src/components/{AppLayout,AutoBuildPanel,CompetitorEditor,CsvToolbar,EntityFieldCard,FieldStatusTag,GeneratePanel,ProjectTable,PromptItemEditor,PromptTable,ProviderSelect,ProxyForm,RevisionTimeline,SampleSizeAlert,SecretStatus,WizardSteps}.tsx`、`components/{entity-fields,wizard-steps}.ts`
- Modify: `src/i18n/locales/{zh-CN,en-US}/{common,project,prompt,entity,settings}.ts`
- Test: 现有组件相关测试（不改断言，固定 zh-CN）

**Interfaces:**
- Consumes: Task 6 的 `useTranslation`、Task 7 的 `fields` 词典
- Produces: 组件内不再出现自然语言字面量；`entity-fields.ts` / `wizard-steps.ts` 的 `label` 字段由中文串改为 **i18n key**（消费方用 `t(label)` 渲染）
- Produces（**控制器裁定，计划原本没覆盖的 i18n 泄漏**）：`ProviderSelect.tsx:43` 今天直接渲染后端给的 `{provider.label_zh}`（`ProviderInfo.label_zh`，`apps/desktop/src-tauri/src/services/settings_service.rs:62/74` 来自 `LlmProvider::label_zh()`）——英文 locale 下仍是中文，这是**后端产出自然语言**的泄漏，而本任务的组件扫描只查 CJK **字面量**，抓不到它。改成 `t('settings.providers.' + provider.provider)`，为 7 个稳定 id 建词条（`deep_seek` `moonshot` `volcengine_ark` `ali_bailian` `baidu_qianfan` `tencent_hunyuan` `custom`），查不到时回退 **provider id 本身**，**绝不回退 `label_zh`**。测试用哨兵钉住：fixture 的 `label_zh` 设成独特串（如 `ZH-SENTINEL`），断言渲染结果里不含它。`ProviderInfo.label_zh` 字段本身本轮**不删**（删它要连带改 demo 种子、`src/test/fixtures.ts`、Task 11/14），但 UI 侧任何代码都不得再读它；字段删除 Park 到 Plan B/C（设置页改版本来就要重做 provider 档案）。
- Produces（**控制器裁定，接 Task 5 的 `CsvRowError` 升级**）：`CsvToolbar.tsx:49` 的 `第 {error.row} 行：{error.reason}` 改为走词典渲染 `reason` key + `params`（复用 Task 7 的 `errors.reasons.*` 与 raw passthrough 回退），`src/api/types.ts:348` 的行错误类型补 `params`。这是 Task 5 留下的 key 显示窗口期的关闭点。
- Produces（**控制器裁定，接 Task 5 的 notes 机器行**）：`PromptSetPage.tsx:266` 的 notes 渲染改为**按行分派**——以 `degraded ` 开头的行 `JSON.parse` 其余部分，用 `promptSet.notes.degraded` 模板渲染（插 `stage` 的译文 `expansion`/`rewrite` 与 `describeIpcError` 对 `code`+`params` 的渲染）；其余行**原样渲染**以兼容既有散文行与老数据；解析失败也原样渲染并 `console.warn`。词典需要 `promptSet.notes.degraded` 与 `promptSet.notes.stage.{expansion,rewrite}` 的 zh/en 四条（本任务或 Task 9 落地，看 `PromptSetPage` 归谁抽）。**不许**把机器行原样显示给用户。
- Produces（**控制器裁定，Task 4 fix round 1 复审后补，修正上文「复用 Task 7 的 `errors.reasons.*`」这句**）：`CsvToolbar` 的行错误渲染**不得**无条件复用 reason 级共享模板。CSV 导入里的 `not_allowed` **只可能**来自广告法红线检查（`crates/geo-domain/src/csv_io.rs:148` → `compliance::check`），它的 `params.value` 是**命中的红线词**。所以行错误走 **code 级覆写优先、`errors.reasons.<reason>` 兜底**，并为 CSV 行错误这一族建一条**不含 `{{value}}`** 的合规模板（文案只说「第 N 行含需改写的表述」）。断言两条：喂 `reason:'not_allowed'` + `params.value:'<红线词>'` 时渲染结果**不含该词**；喂 `reason:'too_long'` + `params.limit:'120'` 时渲染结果**含** `120`（证明不是一刀切把所有 value 都藏掉）。

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
- 边界说明（**控制器裁定**）：`client.ts` 会被 Task 7 与 Task 9 各改一次，区域不重叠——**Task 7 只加 `IpcRequestError.params` 这一个 readonly 字段**；**Task 9 负责** `unwrapIpcError` 的中文明文、`super(payload.message || '未知错误')` 的兜底中文与 `userMessage` getter 的处置。
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
- Produces（**控制器裁定，接 Task 5/8 的 notes 机器行**）：种子里那份题库的 `notes` 至少包含**一行机器行**（如 `degraded {"stage":"expansion","code":"llm/transport","params":{"reason":"other"}}`）与**一行遗留中文散文**，让 demo 同时演示本地化渲染与回退路径；切换语言时机器行必须跟着变、散文行保持原样（这正是 backlog「结构化 notes」的可视化证据）。

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
- [ ] 手动验收（需真人，**尚未执行**）：`mise run web` → 浏览器走完 建项目 → 自动建档 → 生成题库 → 导出 CSV；切 English 全站无中文残留；切回中文正常。
      👉 **完整走查清单见 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md` §8**（8 项，含 `REVOKE_DELAY_MS = 0` 的真浏览器走查、E-28 的 CSV 严格度决策、桌面端不该出现钥匙串提示等本行覆盖不到的项）
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
