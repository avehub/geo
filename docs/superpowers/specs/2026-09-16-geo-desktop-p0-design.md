# GEO 桌面客户端 P0 架构设计与 P0-A 需求规格

> 状态：已评审 · 编制日期 2026-09-16 · 需求真值源：`docs/GEO客户端-MVP产品定义-v1.md`
> 本文覆盖 **P0（M1–M8）四期整体架构**，并给出 **P0-A** 的可实现级需求。P0-B/C/D 只锁定接缝，不展开细节。

---

## 1. 目标与非目标

### 1.1 目标

在国内中小企业自己的电脑上，跑通产品定义文档的闭环价值链：

```
建题(Prompt 题库) → 采集(多引擎真实回答) → 解析(提及/位次/情感/引用/事实)
   → 诊断(可见度评分 + 竞品对标) → 行动(GEO 处方 + 内容生成) → 复测(归因提升)
```

P0-A 交付闭环的前两环入口与全部工程基座：

- 原生 macOS 桌面窗口（Tauri 2），`mise run dev` 可启动（CLI 工作目录 `apps/desktop`，dev/build 钩子在 `apps/desktop/ui` 下跑，见 `AGENTS.md`）；
- M1 项目与品牌档案：5 步建项向导、域名自动建档生成实体卡、字段级修订留痕、多项目管理与导入导出；
- M2 Prompt 智能题库：7 类意图 + 行业模板生成 ≥60 条、口语化改写、竞品同框、去重、加权分组、CSV 导入导出、版本化快照；
- 工程基座：Cargo workspace + pnpm、sqlx 迁移、钥匙串密钥、settings、统一错误、日志、mise 任务、Docker CI 一致性镜像、GitHub Actions。

### 1.2 非目标（P0-A 明确不做）

- 真实引擎采集、浏览器自动化通道（元宝/豆包网页版）、任务队列与调度 → P0-B
- 回答解析、事实核查、评分诊断、行动中心、内容生成 → P0-B/P0-C
- PDF/Excel/PNG 报告、白标、签名公证、自动更新、License、SQLCipher 加密 → P0-D
- M9 服务商多项目席位、M10 云同步与行业基准池
- i18n（UI 仅中文）、移动端、浏览器插件、团队协作权限

### 1.3 成功判据（对齐文档 S1 Go/No-Go）

1. `mise run dev` 打开原生窗口，新用户 **≤3 分钟**完成"建项目 → 自动建档 → 生成 ≥60 prompts → 导出 CSV"；
2. `mise run check` 全绿（fmt / clippy -D warnings / cargo test / eslint / vitest / build）；
3. 全部测试**离线可跑**（无 API Key、无外网）；
4. 对 fixture 站点，实体卡字段完整率 **≥80%**；
5. 生成的 prompt 集覆盖 **7 类意图**，去重后相似度 ≥0.85 的条目对数为 **0**。

---

## 2. 架构总览

### 2.1 分层与依赖方向（不可反向）

```
┌───────────────────────────────────────────────────────────┐
│ apps/desktop/ui          React 19 + Vite 8 + antd v5      │
│                          只通过 src/api 调 invoke          │
└───────────────────────────▲───────────────────────────────┘
                            │ Tauri invoke (JSON)
┌───────────────────────────┴───────────────────────────────┐
│ apps/desktop/src-tauri   命令层(ipc) + 编排层(services)    │
│  package: geo-desktop                                     │
└───┬───────────────┬───────────────┬───────────────┬───────┘
    │               │               │               │
┌───▼──────┐  ┌─────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐
│geo-store │  │ geo-llm   │  │geo-crawler  │  │(P0-B 起)   │
│sqlx+钥匙串│  │LLM 客户端 │  │抓取+正文提取│  │geo-engine  │
└───┬──────┘  └─────┬─────┘  └──────┬──────┘  └─────┬──────┘
    └───────────────┴───────┬───────┴───────────────┘
                     ┌──────▼───────┐
                     │ geo-domain   │  纯模型与规则，无 IO，无外部 crate 依赖
                     └──────────────┘
```

规则：`geo-domain` 不依赖任何本仓 crate，且不做 IO（不碰网络/磁盘/时钟以外的副作用；时间通过参数注入）；`geo-llm`/`geo-crawler`/`geo-store` 只依赖 `geo-domain`；`geo-desktop` 依赖全部。**crate 之间不得互相横向依赖**（例如 `geo-store` 不依赖 `geo-llm`），编排在 `geo-desktop` 的 service 层完成。

### 2.2 IPC 契约

- 单一通道：Tauri `invoke`（不做 HTTP 门面）。
- 命令返回 `Result<T, IpcError>`，`IpcError { code: String, message: String, detail: Option<serde_json::Value> }`。
- `code` 为稳定枚举字符串（如 `project/not_found`、`llm/invalid_response`、`crawler/blocked_by_robots`），前端据此决定文案与是否可重试；`message` 为中文可读原因。
- 所有命令都是 `async`，通过 `tauri::State<AppState>` 拿到 service 句柄；service 层不依赖 `tauri::*` 类型，因此集成测试可直接构造 service 调用（不启 WebView）。

### 2.3 数据与密钥

- SQLite 单库文件，路径为 Tauri `app_data_dir()/geo.db`，开启 WAL；首次启动执行 `sqlx::migrate!` 并校验。
- API Key **不入库**：`SecretStore` trait → `KeyringSecretStore`（macOS Keychain / Windows 凭据管理器，service name `com.gaodekuai.geo`）；库中只存 `secret_ref`（形如 `keyring://llm/deepseek`）。
- 本期数据库明文（不启用 SQLCipher），但所有 SQL 与连接建立集中在 `geo-store::db`，P0-D 换 SQLCipher 只改一处。

---

## 3. 数据模型

### 3.1 SQLite 迁移（`crates/geo-store/migrations/`）

| 表 | 关键列 | 说明 |
|---|---|---|
| `projects` | `id TEXT PK`, `name`, `brand_name`, `aliases TEXT(json)`, `website`, `region`, `language`, `industry`, `tags TEXT(json)`, `status TEXT`, `archived_at`, `created_at`, `updated_at` | `status ∈ {active,archived}` |
| `entity_cards` | `project_id TEXT PK FK`, `fields TEXT(json)`, `field_status TEXT(json)`, `source TEXT(json)`, `completeness REAL`, `created_at`, `updated_at` | `fields` 为 `EntityFields` 序列化 |
| `entity_card_revisions` | `id PK`, `project_id FK`, `field_path`, `old_value`, `new_value`, `status`, `note`, `edited_at` | 字段级修订留痕 |
| `competitors` | `id PK`, `project_id FK`, `name`, `aliases TEXT(json)`, `website`, `note`, `position INT`, `created_at` | 3–5 家 |
| `project_assets` | `id PK`, `project_id FK`, `kind`, `url`, `title`, `note`, `created_at` | `kind` 见 `AssetKind` |
| `prompt_sets` | `id PK`, `project_id FK`, `version INT`, `label`, `item_count INT`, `content_hash`, `engine_scope TEXT(json)`, `metric_spec_version`, `sample_size_grade`, `created_at`, `notes` | 一轮复测的口径快照 |
| `prompt_items` | `id PK`, `set_id FK`, `text`, `intent`, `weight INT`, `group_name`, `tags TEXT(json)`, `source`, `competitor_ids TEXT(json)`, `repeat_count INT`, `position INT`, `created_at` | |
| `settings` | `key TEXT PK`, `value TEXT(json)`, `updated_at` | 代理/并发/频控/模型预设/语言/通知 |

约定：ID 为 UUIDv4 文本；时间戳为 RFC3339 UTC 文本；JSON 列为 `serde_json` 序列化文本；所有 `project_id` 建索引；外键 `ON DELETE CASCADE`，连接执行 `PRAGMA foreign_keys=ON`。

### 3.2 领域类型（`geo-domain`）

```rust
pub struct Project { pub id: ProjectId, pub name: String, pub brand_name: String,
    pub aliases: Vec<String>, pub website: Option<String>, pub region: String,
    pub language: Language, pub industry: Industry, pub tags: Vec<String>,
    pub status: ProjectStatus, pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }

pub struct EntityFields { pub standard_name: String, pub aliases: Vec<String>,
    pub founded_year: Option<i32>, pub qualifications: Vec<String>,
    pub products: Vec<ProductSpec>, pub price_range: Option<String>,
    pub service_regions: Vec<String>, pub cases: Vec<String>,
    pub differentiators: Vec<String>, pub official_tone: Option<String>,
    pub contact: Option<Contact> }
pub struct ProductSpec { pub name: String, pub params: Vec<String>, pub note: Option<String> }
pub struct Contact { pub phone: Option<String>, pub email: Option<String>, pub address: Option<String> }
pub enum FieldStatus { Official, Pending, Disputed }     // 官方口径 / 待确认 / 存疑
pub struct EntityCard { pub project_id: ProjectId, pub fields: EntityFields,
    pub field_status: HashMap<String, FieldStatus>, pub source: EntityCardSource,
    pub completeness: f64, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }
pub struct EntityCardSource { pub crawled_pages: Vec<String>, pub llm_provider: Option<String>,
    pub llm_model: Option<String>, pub generated_at: Option<DateTime<Utc>> }

pub enum IntentCategory { CategoryAwareness, PurchaseRecommendation, BrandComparison,
    PricingPlan, LocalService, AfterSalesReputation, ProfessionalLongTail }   // 7 类
pub enum PromptSource { Template, Generated, Rewritten, Manual, Imported }
pub struct PromptItem { pub id: PromptId, pub set_id: PromptSetId, pub text: String,
    pub intent: IntentCategory, pub weight: u8 /*1..=5*/, pub group_name: Option<String>,
    pub tags: Vec<String>, pub source: PromptSource, pub competitor_ids: Vec<CompetitorId>,
    pub repeat_count: u8 /*1..=3*/, pub position: i32 }
pub struct PromptSet { pub id: PromptSetId, pub project_id: ProjectId, pub version: i32,
    pub label: String, pub items: Vec<PromptItem>, pub content_hash: String,
    pub engine_scope: Vec<String>, pub metric_spec_version: String,
    pub sample_size_grade: SampleSizeGrade, pub created_at: DateTime<Utc>, pub notes: Option<String> }
pub enum SampleSizeGrade { Sufficient /*>=60*/, Directional /*30..59*/, Insufficient /*<30*/ }
```

`IntentCategory`/`FieldStatus`/`AssetKind`/`SampleSizeGrade` 等的序列化字符串即为数据库存储值，并作为前端契约（snake_case，如 `category_awareness`、`official`、`sufficient`）。

---

## 4. P0-A 详细需求

### 4.1 工程基座（M8 切片）

**FR-B1 仓库与工具链**
- Cargo workspace（`resolver = "2"`）成员：`crates/geo-domain`、`crates/geo-llm`、`crates/geo-crawler`、`crates/geo-store`、`apps/desktop/src-tauri`（package `geo-desktop`）。
- workspace `[dependencies]` 统一版本，子 crate 用 `workspace = true` 引用，避免版本漂移。
- mise 任务为唯一命令入口：`doctor/install/dev/web/test/lint/build/check`。

**FR-B2 桌面壳**
- Tauri 2 应用，窗口标题「稿得快 GEO」，默认尺寸 1280×800，最小 1024×700；`devUrl = http://localhost:1420`，`frontendDist = ../ui/dist`。
- 插件：`tauri-plugin-dialog`（导入导出选路径，**导出必须走它**：WKWebView 不支持 `<a download href="blob:">`，前端点下载会静默失败）、`tauri-plugin-opener`（打开外部链接）。
- 日志：`tracing` + `tracing-appender`，输出 stdout + `app_log_dir` 下的每日滚动文件（`gdk-geo.log.YYYY-MM-DD`）；级别开关 `GEO_LOG` > `RUST_LOG` > `info`。**不使用 `tauri-plugin-log`**，理由见 §7 决策记录。
- capability 文件最小权限：仅允许本项目使用的命令与上述插件动作。

**FR-B3 存储**
- `geo-store::db::open(path) -> SqlitePool`：创建父目录、`PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`、`PRAGMA busy_timeout=5000`，执行 `sqlx::migrate!`。
- 每个聚合一个 repository（`ProjectRepo`/`EntityCardRepo`/`CompetitorRepo`/`AssetRepo`/`PromptSetRepo`/`SettingsRepo`），只提供领域对象进出，不向上暴露 `sqlx::Row`。

**FR-B4 密钥**
```rust
#[async_trait] pub trait SecretStore: Send + Sync {
    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError>;
    async fn get(&self, key: &str) -> Result<Option<String>, StoreError>;
    async fn delete(&self, key: &str) -> Result<(), StoreError>;
}
```
实现：`KeyringSecretStore`（生产）、`MemorySecretStore`（测试）。`settings` 中模型配置只保存 `secret_ref`；`secrets_status` 命令只回传"已配置/未配置"，永不回传值。

**FR-B5 设置**
`SettingsRepo` 读写强类型 `AppSettings { proxy: Option<ProxyConfig>, concurrency: ConcurrencyConfig, rate_limit: RateLimitConfig, model: ModelConfig, language: String, notify: NotifyConfig }`，缺失键回落默认值；`ModelConfig { provider: LlmProvider, model: String, secret_ref: String, temperature: f32, timeout_secs: u64 }`。P0-B 的调度器直接复用 `ConcurrencyConfig`/`RateLimitConfig`，本期只存取不生效。

**FR-B6 统一错误与日志**
`geo_domain::GeoError`（`thiserror`）为跨层错误；`geo-desktop` 在命令边界转 `IpcError`。`tracing` 全链路，日志中禁止出现 API Key 与完整回答正文（截断至 200 字符）。脱敏函数 `error::redact` 是**唯一出口**：凡是把上游错误文案送去展示（`LlmTestResult.message`）、落库（`prompt_sets.notes`）或打日志的地方都要过它，`IpcError` 只是最后一道。

**FR-B7 Docker 与 CI**
- `docker/dev.Dockerfile`：`debian:trixie` + rust stable（rustup）+ node 24.21.0 + pnpm 12.4.2 + `libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev pkg-config build-essential`。
- `docker-compose.yml`：源码 bind mount，`cargo-registry`/`cargo-target`/`pnpm-store`/`node-modules` 为命名卷。
- `.github/workflows/ci.yml`：基于该镜像跑 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、`pnpm lint`、`pnpm test`、`pnpm build`、`cargo check -p geo-desktop`。不打包 bundle、不做桌面 E2E。

### 4.2 M1 项目与品牌档案

**FR-M1-1 建项向导（5 步）**
1. 品牌名与别名（含常见错写）→ 2. 官网与核心页面 → 3. 产品线与服务范围 → 4. 目标地域与语言 → 5. 竞品 3–5 家。
每步前端校验（品牌名必填 ≤50 字；官网需为合法 http(s) URL；竞品 0–5 家，>5 拦截）；草稿存 `localStorage`（key `geo.wizard.draft.<step>`），可回退不丢数据；最后一步提交后调 `project_create`。

**FR-M1-2 自动建档**
```
entity_card_autobuild(project_id, domain) ->
  geo-crawler: 发现并抓取 ≤8 个同域页面（首页/About/产品/FAQ/联系）
             → 正文提取（编码探测 + html2text）
  geo-llm  : chat_json::<EntityFields>（严格 schema；失败则带错误说明重试 1 次）
  geo-store: upsert entity_cards + 写 source/completeness
```
约束：遵守 `robots.txt`（禁止路径直接跳过并记录原因）；单页超时 10s、总超时 60s、单页正文上限 200KB；只抓用户自有域名，竞品域名最多抓首页；抓取失败不阻断建档（用已抓到的页面继续）。

**FR-M1-3 字段完整率**
`completeness = 已填必填字段数 / 必填字段总数`，必填字段固定 10 项：`standard_name, aliases, founded_year, qualifications, products, price_range, service_regions, cases, differentiators, contact`；数组/字符串非空即算已填。未填字段自动标 `FieldStatus::Pending`。

**FR-M1-4 实体卡编辑与留痕**
字段级编辑（值 + 状态），每次修改写一条 `entity_card_revisions`（`field_path` 用点路径，如 `products[0].params`），并可回看时间线；编辑后重算 `completeness` 与 `updated_at`。

**FR-M1-5 项目资产与竞品**
`ProjectAsset { kind: AssetKind }`，`AssetKind ∈ {owned_page, baike, zhihu, xiaohongshu, baijiahao, industry_media, ecommerce, social_account, other}`；竞品支持排序（`position`）与别名。

**FR-M1-6 多项目管理与导入导出**
列表支持按名称/品牌/标签搜索、归档与取消归档、标签增删；导出 = 单项目全量 JSON（项目 + 实体卡 + 修订 + 竞品 + 资产 + prompt 集），导入 = 校验 JSON 结构后以**新 ID** 落库（避免主键冲突），返回导入统计；竞品与资产支持 CSV 导出。

**验收**：≤3 分钟建项目；fixture 站点字段完整率 ≥80%；每字段可编辑可标状态；导出 JSON 可再次导入且实体卡字段一致。

### 4.3 M2 Prompt 智能题库

**FR-M2-1 模板与生成管线**
```
prompt_set_generate(project_id, opts) ->
  1 模板展开   行业模板 × 7 类意图 × 占位符替换（{品类}{本品牌}{竞品A}{竞品B}{城市}{X}万{场景}{关键参数}）
  2 LLM 扩写   按意图类补齐到目标条数（chat_json::<GeneratedPrompts>）
  3 口语化改写 书面词 → 真实问法（"哪个好/靠谱吗/多少钱/是不是智商税"），支持地域变体
  4 竞品同框   每个竞品至少 ceil(target * 0.2 / 竞品数) 条对比型 prompt
  5 去重合并   见 FR-M2-3
  6 加权分组   按意图与关键词赋默认 weight，核心词命中 +1（上限 5）
  7 落库快照   写 prompt_sets + prompt_items，计算 content_hash 与 sample_size_grade
```
`opts = { target_count: u16 (默认 80，范围 20..=200), industry_template, intents: Option<Vec<IntentCategory>>, per_prompt_repeat: u8 (1..=3) }`。
LLM 不可用（无 Key 或调用失败）时**降级为纯模板展开**，并把 `PromptSource::Template` 与降级原因写入 `prompt_sets.notes`，保证离线也能出 ≥60 条。

**FR-M2-2 意图与行业模板**
7 类意图固定；内置 5 套行业模板：`b2b_manufacturing`、`enterprise_saas`、`local_service`、`cross_border_ecommerce`、`franchise`。每套模板对每类意图提供 ≥4 条中文问法（文案风格对齐产品文档附录 B 的 12 条示例）。

**FR-M2-3 去重口径（纯本地、可测）**
- 归一化：去空白、全角转半角、去标点、转小写。
- 相似度：字符 **3-gram** 集合的 Jaccard 系数。
- 阈值：`>= 0.85` 判为重复，合并保留 `weight` 高者（相同则保留先出现者），被合并条目的 `tags` 与 `competitor_ids` 并入保留条目。
- 重复率指标：剩余条目中相似度 ≥0.85 的**条目对数**，验收要求为 0（严于产品文档的 ≤15%）。
- 语义 embedding 去重列为 P1。

**FR-M2-4 样本量纪律**
`SampleSizeGrade`: `>=60 Sufficient`；`30..=59 Directional`；`<30 Insufficient`。UI 与导出文件在 `Directional/Insufficient` 时展示「样本不足，仅供方向性参考」，`Insufficient` 时不展示任何精确分数（该规则为 `geo-domain` 纯函数，P0-C 评分复用）。生成结果不足 60 条时给出"补齐建议"（缺哪类意图、建议补几条），不静默通过。

**FR-M2-5 版本化与可比性**
`content_hash = sha256(排序后的 "intent|weight|text" 拼接)`；`metric_spec_version = "geo-metrics-v1"`；`engine_scope` 记录生成时选定的引擎列表（P0-A 为空数组，P0-B 写入实际引擎）。同一项目二次采集默认沿用最新 prompt 集版本。

**FR-M2-6 管理**
表格支持增删改、批量选择、按意图/分组/来源筛选、`weight` 1–5 调整、`repeat_count` 1–3 调整、`tags` 增删；任何修改后重算 `content_hash` 与 `item_count` 并落库。人工新增的条目 `source` 固定为 `manual`（来源是指标口径，不能由调用方自称模板/AI 生成）；删除不允许把快照删空，要清空请删除整个题库（与 CSV 空导入同一条纪律）。CSV 导入导出列固定为 `text,intent,weight,group_name,tags,source,repeat_count`，导入做表头校验、逐行校验并返回错误行报告（行号 + 原因），部分成功允许。

**验收**：一键生成 ≥60 条、覆盖 7 类意图、重复对为 0；同项目二次生成默认沿用同一版本口径；CSV 导出再导入后条目数与文本一致。

### 4.4 LLM 与合规基础件

**FR-L1 Provider 抽象**
```rust
pub enum LlmProvider { DeepSeek, Moonshot, VolcengineArk, AliBailian, BaiduQianfan, TencentHunyuan, Custom }
impl LlmProvider { pub fn base_url(&self) -> &str; pub fn default_model(&self) -> &str;
                   pub fn pricing(&self) -> Pricing /* 元/百万 token: input, output, cache_hit */ }
```
预设 base_url：DeepSeek `https://api.deepseek.com/v1`、Moonshot `https://api.moonshot.cn/v1`、火山方舟 `https://ark.cn-beijing.volces.com/api/v3`、阿里百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`、百度千帆 `https://qianfan.baidubce.com/v2`、腾讯混元 `https://api.hunyuan.cloud.tencent.com/v1`。全部走 OpenAI 兼容 `/chat/completions`；`Custom` 由用户填 base_url/model。

**FR-L2 传输层**
```rust
#[async_trait] pub trait Transport: Send + Sync {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError>;
}
pub struct HttpRequest { pub url: String, pub headers: Vec<(String,String)>, pub body: String }
pub struct HttpResponse { pub status: u16, pub body: String }
```
实现：`ReqwestTransport`（rustls、连接/读取超时、可选代理）、`FixtureTransport`（按 `fixtures/llm/*.json` 的 `request_key → response` 匹配回放；未命中返回明确错误）。**测试只用后两者 + wiremock。**

**FR-L3 客户端能力**
`LlmClient::chat(ChatRequest) -> ChatResponse`、`chat_json::<T: DeserializeOwned>(ChatRequest) -> Result<T, LlmError>`；指数退避重试（默认 3 次，base 500ms，仅对 429/5xx/网络错误重试，4xx 不重试）；返回 `Usage { prompt_tokens, completion_tokens, total_tokens }` 与按 pricing 折算的 `cost_cny`，为 P0-B 成本看板累积数据。`chat_json` 能从 ```json 代码块或夹带文字中抽取 JSON；解析失败时带"上次错误说明"重试 1 次。

**FR-L4 合规词库**
`geo_domain::compliance`：绝对化用语词库（"保证排名/霸屏/第一/最佳/最优/唯一/国家级/顶级/100%/永久"等）+ `fn scan(text) -> Vec<Violation { term, span }>`；生成内容默认 `ContentStatus::PendingReview`。词库为数据文件（`crates/geo-domain/data/adlaw_terms.txt`），便于运营更新。

**FR-L5 Fixtures**
`fixtures/http/`：UTF-8 企业站样本（首页/about/产品/faq/联系，5 页）+ 1 个 GBK 编码页面 + 1 个 robots.txt；`fixtures/llm/`：实体卡生成、意图扩写、口语化改写、JSON 解析失败重试各一组；`scripts/record-fixtures.sh` 在有 Key 时手动重录（脚本不参与测试）。

### 4.5 前端（apps/desktop/ui）

- 路由：`/projects`（列表）、`/projects/:id/wizard`、`/projects/:id/entity-card`、`/projects/:id/prompts`、`/settings`。
- 分层：`src/api/`（唯一 invoke 封装 + TS 类型，与 Rust 类型一一对应）、`src/pages/`、`src/components/`、`src/store/`（zustand）、`src/hooks/`。组件不得直接 `invoke`。
- 数据获取用 `@tanstack/react-query`；错误统一由 `IpcError.message` 弹出 antd `message`/`notification`。
- 视觉：antd v5 默认主题 + Tailwind 布局；中文文案；样本不足提示用 `Alert`，字段状态用 `Tag`（官方口径=green / 待确认=orange / 存疑=red）。
- 测试环境用 `src/api/__mocks__` 提供的 invoke mock，保证 vitest 无需 Tauri 运行时。

---

## 5. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 领域规则 | `cargo test`（单测） | 去重阈值与合并、样本量分级、完整率、绝对化用语命中、CSV 往返、实体卡 JSON 校验 |
| 存储 | `cargo test`（集成，临时 SQLite） | 迁移可跑、CRUD、级联删除、修订留痕、settings 默认值回落 |
| 抓取 | `wiremock` + fixtures | 编码探测（UTF-8/GBK）、robots 遵守、页面分类、超时与失败降级 |
| LLM | `wiremock` + `FixtureTransport` | 重试策略（429/5xx 重试、4xx 不重试）、超时、用量与成本记账、JSON 抽取与修复重试 |
| 服务编排 | `src-tauri/tests`（直调 service） | 建项目 → 自动建档 → 生成题库 → 导出全链路；断言 ≥60 条 / 7 类意图 / 重复对 0 |
| 前端 | Vitest + RTL(jsdom) | 向导校验与草稿、实体卡字段编辑触发修订、prompt 表交互、样本不足渲染、api mock |

门禁：`mise run check` 全绿。CI 与本地使用同一 Docker 镜像。

---

## 6. 分期接缝（P0-B/C/D 预留点）

- **P0-B（M3+M4）**：新增 `crates/geo-engine`（`trait EngineAdapter`，三种通道 A/B/C）与 `geo-parse`；`geo-store` 增加 `collection_runs`/`responses`/`evidences`/`parse_results` 表；复用本期 `ConcurrencyConfig`/`RateLimitConfig`/`Usage.cost_cny` 做队列与成本看板；`prompt_sets.engine_scope` 写入实际引擎；`repeat_count` 驱动重复采样。
- **P0-C（M5+M6）**：复用 `SampleSizeGrade` 与 `completeness`；评分公式（五维加权，见产品文档附录 C）落 `geo-domain::scoring`；行动中心处方挂 `entity_card_revisions` 的字段级证据；内容生成走 `geo-llm` + 模板（仓库无既有自动成文模块，按文档兜底做"模板 + 改写"）。
- **P0-D（M7+M8）**：报告以 HTML 为单一真相 → WebView 打印 PDF / 截图 PNG / `rust_xlsxwriter` 出 Excel；`geo-store::db` 单点切 SQLCipher；签名公证、自动更新、设备绑定 License、诊断日志打包、一键清除数据。

---

## 7. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Tauri 2（Rust + 系统 WebView） | 安装包小、内存优；产品文档推荐；macOS 侧仅需 Xcode CLT |
| UI 组件库 | antd v5.29.3 + `@ant-design/v5-patch-for-react-19` | 中文 B 端密集表格/向导成熟；用户指定 v5 |
| HTTP TLS | `rustls` | 避免 openssl/pkg-config/cmake，宿主机零 brew 依赖 |
| 数据层 | sqlx 0.9 + bundled SQLite + `sqlx::migrate!` | 编译期 SQL 校验；不引 refinery，减少依赖面 |
| 库加密 | 本期明文，P0-D 切 SQLCipher | 降低本轮编译与调试成本；连接建立已单点收口 |
| Node 版本 | 全局 latest(26.x) / 项目锁 24.21.0 LTS | Current 线今天还在发新版（26.8.2→26.9.0），项目要可复现 |
| TypeScript | `~6.0.3`（不追 7.0.2） | 7.x 为新大版本，生态类型声明尚在跟进 |
| 去重算法 | 字符 3-gram Jaccard ≥0.85 | 纯本地、确定性强、可单测；embedding 留 P1 |
| 引擎采集 | 本期不实现，只留接缝 | 用户选择离线优先；避免风控与合规风险提前引入 |
| 包管理 | pnpm 12.4.2（`packageManager` 字段锁定） | 单仓多包、硬链接省空间、版本随项目走 |
| 日志 | `tracing` + `tracing-appender`，**不用** `tauri-plugin-log` | 两者都要独占全局 `log` logger：`tracing-subscriber::init()` 会装 `LogTracer`，随后插件 `attach_logger` 必然失败 → `Builder::run` 返回 `Err` → 启动即 panic（P0-A 收尾实测复现：`PluginInitialization("log", ...)`）。单一管线还能把依赖的 `log` 记录一并写进同一个滚动文件，P0-D 诊断打包只用收一个目录 |
| 文件导出 | Rust 命令 `export_write_file`（dialog 选路径 + `tokio::fs::write`） | WKWebView 不实现 blob 的 `download` 属性，前端自建 Blob 点击后静默无反应；收口到 Rust 侧还能统一补 BOM |
| demo 模式 / i18n 基座 / 设置页 | 另见 `2026-09-18-geo-desktop-demo-i18n-settings-design.md` | 本文件写就时还没有「纯前端 + 静态数据的 demo 假后端」与双语基座；那份文档是它们的落地设计（含 §4.2 的错误码契约：后端只回稳定错误码 + 语言中立 `params`，文案由前端按当前语言渲染）。**涉及 demo 模式 / i18n / 设置页这三块时以那份为准**，本文件的 crate 分层与选型约束（HTTP TLS、数据层、包管理等）不受影响 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Tauri 首次编译慢（~500 crate） | 开发反馈变慢 | `cargo check` 优先；Docker 命名卷缓存 target；CI 缓存 |
| LLM 结构化输出不稳定 | 实体卡字段缺失 | 严格 serde 校验 + 带错误说明重试 1 次 + 无 Key 时模板降级 |
| 抓取被反爬/编码异常 | 自动建档失败 | robots 优先、超时与页数上限、GBK 探测、失败不阻断 |
| keyring 在 CI/容器无 Secret Service | 测试失败 | `SecretStore` trait + `MemorySecretStore`，CI 不碰钥匙串 |
| antd v5 与 React 19 静态 API 兼容 | 弹窗/message 失效 | 引入官方 `@ant-design/v5-patch-for-react-19` |
| `tauri.conf.json` 的 `csp` 仍为 `null` | WebView 可加载任意远程资源，打包后存在注入面 | 本期全程离线、不加载远程内容，风险受限；**P0-D 打包前必须收紧 CSP 并实测 antd 样式与 IPC**（无 GUI 环境盲改会直接白屏，故不在本期动） |
| 导出 CSV 未做公式注入防护（`=cmd\|...` 之类） | 用 Excel 打开导出文件时可能被当作公式执行 | 与「导出再导入文本必须一致」的验收口径冲突（加前缀 `'` 会破坏往返保真）；本期靠提示用户，P0-D 出 Excel（`rust_xlsxwriter`）时改为写文本单元格类型，从根上消除 |
| 广告法词库对「最低/绝对」等词会误伤正常表述 | 合规拦截偶有过杀 | 词库是可编辑数据文件（`crates/geo-domain/data/adlaw_terms.txt`），运营可改；拦截一律给出命中词，不做静默改写 |
