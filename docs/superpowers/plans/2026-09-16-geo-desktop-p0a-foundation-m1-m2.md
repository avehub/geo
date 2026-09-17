# P0-A 工程基座 + M1 品牌档案 + M2 Prompt 题库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可 `mise run dev` 启动的原生 macOS 桌面应用，跑通「建项目 → 域名自动建档实体卡 → 一键生成 ≥60 条 prompt → 去重/版本化 → 导出 CSV」，且全部测试离线可跑。

**Architecture:** Cargo workspace 四个库 crate（`geo-domain` 纯领域规则 / `geo-llm` OpenAI 兼容客户端 / `geo-crawler` 抓取与正文提取 / `geo-store` sqlx+keyring 持久化）+ `geo-desktop`（Tauri 2 壳，`ipc` 命令层与 `services` 编排层分离，service 不依赖 `tauri::*` 以便集成测试直调）。前端 `apps/desktop/ui` 为 React 19 + Vite 8 + antd v5，只经 `src/api` 调 `invoke`。

**Tech Stack:** Rust 1.98.1 / Tauri 2.11 / sqlx 0.9(SQLite bundled) / reqwest 0.13(rustls) / tokio 1.53 / keyring 4.2 / scraper 0.27 / html2text 0.17 / encoding_rs 0.8 / wiremock 0.6；Node 24.21.0 / pnpm 12.4.2 / React 19.3 / antd 5.29.3 / Tailwind 4.3 / ECharts 6.1 / Vitest 5 / TypeScript 6.0.3。

**Spec:** `docs/superpowers/specs/2026-09-16-geo-desktop-p0-design.md`（计划以 spec 为准，执行时两份都读）

## Global Constraints

- 依赖方向：`geo-domain` 不依赖本仓其他 crate 且不做 IO；`geo-llm`/`geo-crawler`/`geo-store` 只依赖 `geo-domain`；`geo-desktop` 依赖全部。禁止横向依赖。
- 测试禁止联网：HTTP/LLM 一律走 `fixtures/` 或 `wiremock`；CI 不提供任何 API Key。
- API Key 永不入库、永不入日志；库中只存 `secret_ref`（形如 `keyring://llm/deepseek`）。
- HTTP 客户端固定 `reqwest` + `rustls`（禁用 `native-tls`）；SQLite 用 sqlx bundled；迁移用 `sqlx::migrate!`。
- ID = UUIDv4 文本；时间 = RFC3339 UTC 文本；枚举序列化 = snake_case 字符串，且该字符串即数据库存储值与前端契约。
- 文案合规：禁用「保证排名 / 霸屏 / 第一 / 最佳 / 最优 / 唯一 / 顶级 / 100% / 永久」；生成内容默认 `PendingReview`。
- 版本锁：`.mise.toml` node `24.21.0` / pnpm `12.4.2` / rust `1.98.1`；`rust-toolchain.toml` channel `1.98.1` + `rustfmt,clippy`。
- 门禁：`mise run check`（fmt + clippy `-D warnings` + cargo test + eslint + vitest + build）全绿才算完成。
- 提交：Conventional Commits，一个 task 一次提交。

---

### Task 1: workspace 骨架与工程基线

**Files:** Create `Cargo.toml`、`crates/*/Cargo.toml`、`crates/*/src/lib.rs`、`apps/desktop/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/{main.rs,lib.rs}}`、`apps/desktop/ui/{package.json,vite.config.ts,tsconfig*.json,eslint.config.js,index.html}`、`.mise.toml`、`rust-toolchain.toml`、`.gitignore`、`README.md`、`AGENTS.md`

**Interfaces:** Produces 可 `cargo check --workspace` 与 `pnpm build` 的空骨架；`geo_desktop_lib::run()` 入口。

- [ ] 写 workspace 与五个成员 manifest（统一 `[workspace.dependencies]`）
- [ ] 写 Tauri 配置：`productName=gdk-geo`、`identifier=com.gaodekuai.geo`、窗口 1280×800/min 1024×700、`devUrl=http://localhost:1420`、`frontendDist=../ui/dist`
- [ ] 生成应用图标：`pnpm --dir apps/desktop/ui exec tauri icon brand/icon-source.png`
- [ ] `mise exec -- cargo check --workspace` 通过
- [ ] `pnpm --dir apps/desktop/ui run build` 通过
- [ ] Commit `chore: 搭建 Cargo workspace 与 Tauri/React 骨架`

### Task 2: geo-domain 错误与原语

**Files:** Create `crates/geo-domain/src/{error.rs,ids.rs,lib.rs}`；Test 同文件 `#[cfg(test)]`

**Interfaces:** Produces `GeoError`（`thiserror`，变体 `Validation{field,reason}`、`NotFound{kind,id}`、`Conflict{reason}`、`Io`、`Config`、`Upstream{code,message}`）、`ProjectId/PromptSetId/PromptId/CompetitorId/AssetId/RevisionId`（`Uuid` newtype，`Display`/`FromStr`/serde 透明）、`pub fn now() -> DateTime<Utc>`。

- [ ] 失败测试：`GeoError::validation("brand_name","不能为空").to_string()` 含字段名；`ProjectId::new()` 往返 `to_string`/`parse` 相等；serde 序列化为裸字符串
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): 统一错误类型与 ID 原语`

### Task 3: 项目 / 竞品 / 资产模型

**Files:** Create `crates/geo-domain/src/{project.rs,asset.rs}`

**Interfaces:** Produces `Project`、`ProjectStatus{Active,Archived}`、`Language`、`Industry{B2bManufacturing,EnterpriseSaas,LocalService,CrossBorderEcommerce,Franchise,Other(String)}`、`Competitor`、`ProjectAsset`、`AssetKind`、`ProjectDraft`（向导 5 步的输入 DTO）、`ProjectDraft::validate() -> Result<(), GeoError>`、`Project::archive(now)`/`unarchive(now)`。

- [ ] 失败测试：品牌名为空 / 超 50 字 / 官网非法 URL / 竞品 >5 家 → `validate()` 返回带字段名的 `Validation`；合法 draft → `build(now)` 生成 `status=Active`、`created_at==updated_at==now`
- [ ] 失败测试：`archive(now)` 置 `status=Archived` 且 `archived_at=Some(now)`；`unarchive` 反向
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): 项目、竞品与资产模型`

### Task 4: 实体卡与字段完整率

**Files:** Create `crates/geo-domain/src/entity_card.rs`

**Interfaces:** Produces `EntityFields`、`ProductSpec`、`Contact`、`FieldStatus{Official,Pending,Disputed}`、`EntityCard`、`EntityCardSource`、`EntityCardRevision`、`REQUIRED_FIELDS: [&str; 10]`、`EntityFields::completeness() -> f64`、`EntityFields::missing_fields() -> Vec<&'static str>`、`EntityCard::set_field(path, value, status, now, note) -> EntityCardRevision`、`EntityCard::pending_fields()`。

- [ ] 失败测试：全空卡 `completeness()==0.0`，`missing_fields()` 含 10 项；填满后 `==1.0`；填 8 项 `== 0.8`（`assert!((c-0.8).abs()<1e-9)`）
- [ ] 失败测试：`set_field("founded_year", json!(2016), Official, now, Some("官网 About"))` 返回 `field_path=="founded_year"`、`old_value=="null"`、`new_value=="2016"` 的修订，且卡片 `field_status` 更新、`updated_at==now`
- [ ] 失败测试：未知 `field_path` → `GeoError::Validation`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): 品牌实体卡与字段完整率`

### Task 5: Prompt 模型、意图与样本量纪律

**Files:** Create `crates/geo-domain/src/prompt.rs`

**Interfaces:** Produces `IntentCategory`（7 变体 + `IntentCategory::all()` + `label_zh()`）、`PromptSource`、`PromptItem`、`PromptSet`、`SampleSizeGrade{Sufficient,Directional,Insufficient}`、`sample_size_grade(count) -> SampleSizeGrade`、`SampleSizeGrade::warning_zh() -> Option<String>`、`PromptSet::content_hash() -> String`（sha256，对 `intent|weight|text` 排序后拼接）、`PromptSet::intent_coverage() -> HashSet<IntentCategory>`、`PromptSet::shortfall_advice(target) -> Vec<String>`、`METRIC_SPEC_VERSION: &str = "geo-metrics-v1"`。

- [ ] 失败测试：`sample_size_grade(60)==Sufficient`、`(59)==Directional`、`(30)==Directional`、`(29)==Insufficient`；`Insufficient.warning_zh()` 含「样本不足」
- [ ] 失败测试：同一批条目换顺序 → `content_hash()` 相同；改一条 text → 不同
- [ ] 失败测试：缺 2 类意图时 `shortfall_advice(60)` 返回的建议条数 == 2 且点名缺失意图中文名
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): prompt 集模型与样本量纪律`

### Task 6: 去重（字符 3-gram Jaccard）

**Files:** Create `crates/geo-domain/src/dedupe.rs`

**Interfaces:** Produces `fn normalize(text:&str)->String`（去空白、全角→半角、去标点、转小写）、`fn char_ngrams(text:&str,n:usize)->HashSet<String>`、`fn jaccard(a:&HashSet<String>,b:&HashSet<String>)->f64`、`fn similarity(a:&str,b:&str)->f64`、`const DUPLICATE_THRESHOLD: f64 = 0.85`、`fn dedupe(items: Vec<PromptItem>) -> DedupeReport`，`DedupeReport{ kept: Vec<PromptItem>, removed: Vec<RemovedItem{ item, merged_into }>, duplicate_pairs: usize }`。

- [ ] 失败测试：`similarity("国内做工业水泵的厂家有哪些？","国内做工业水泵的厂家有哪些")>=0.85`；`similarity("预算10万以内工业水泵推荐哪几家？","工业水泵售后怎么样？")<0.5`
- [ ] 失败测试：`normalize("ＡＢＣ　１２３，。")=="abc123"`
- [ ] 失败测试：3 条中 2 条互为重复 → `kept.len()==2`，保留 weight 高者，被删条目的 `tags`/`competitor_ids` 并入保留者，`duplicate_pairs==0`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): prompt 去重与相似度口径`

### Task 7: CSV 导入导出

**Files:** Create `crates/geo-domain/src/csv_io.rs`

**Interfaces:** Produces `PROMPT_CSV_HEADER`（`text,intent,weight,group_name,tags,source,repeat_count`）、`fn prompts_to_csv(&[PromptItem])->Result<String,GeoError>`、`fn prompts_from_csv(&str)->CsvImportResult`、`CsvImportResult{ items: Vec<PromptItem>, errors: Vec<CsvRowError{row,reason}> }`、`fn competitors_to_csv`/`assets_to_csv`。

- [ ] 失败测试：导出再导入，`text/intent/weight/repeat_count` 全部一致；含中文与逗号/引号的 text 往返不变
- [ ] 失败测试：表头缺 `intent` 列 → 返回错误而非静默；某行 weight=9 → 该行进 `errors`（含行号）其余行成功
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): prompt/竞品/资产 CSV 导入导出`

### Task 8: 合规词库与扫描

**Files:** Create `crates/geo-domain/src/compliance.rs`、`crates/geo-domain/data/adlaw_terms.txt`

**Interfaces:** Produces `ContentStatus{PendingReview,Approved,Rejected}`、`fn terms()->&'static [String]`（内嵌 `include_str!` 词库）、`fn scan(text:&str)->Vec<Violation{term,start,end}>`、`fn is_clean(text:&str)->bool`。

- [ ] 失败测试：`scan("我们保证排名第一，效果100%")` 命中「保证排名」「第一」「100%」三项且 span 正确；`is_clean("可见度提升 18%")` 注意「18%」不应命中「100%」
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(domain): 广告法绝对化用语词库与扫描`

### Task 9: geo-llm Provider 预设与计价

**Files:** Create `crates/geo-llm/src/{provider.rs,lib.rs}`

**Interfaces:** Produces `LlmProvider{DeepSeek,Moonshot,VolcengineArk,AliBailian,BaiduQianfan,TencentHunyuan,Custom}`、`base_url()`、`default_model()`、`pricing()->Pricing{input_per_mtok,output_per_mtok,cache_hit_per_mtok}`（元/百万 token）、`Pricing::cost_cny(usage)->f64`（四舍五入到分）、`LlmConfig{provider,base_url,model,secret_ref,temperature,timeout_secs,max_retries}`。

- [ ] 失败测试：`DeepSeek.base_url()=="https://api.deepseek.com/v1"`；6 个预设 base_url 与 spec 一致；`Custom.base_url()` 为空且必须由 `LlmConfig` 覆盖
- [ ] 失败测试：`Pricing{input:1.0,output:2.0,..}.cost_cny(Usage{prompt:1_000_000,completion:500_000,..})==2.0`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(llm): Provider 预设与成本计价`

### Task 10: geo-llm Transport（Reqwest + Fixture）

**Files:** Create `crates/geo-llm/src/transport.rs`

**Interfaces:** Produces `HttpRequest{url,headers,body}`、`HttpResponse{status,body}`、`TransportError{Network,Timeout,Other}`、`#[async_trait] trait Transport{async fn send(&self,req:HttpRequest)->Result<HttpResponse,TransportError>}`、`ReqwestTransport::new(timeout, proxy: Option<String>)`、`FixtureTransport::from_dir(path)`/`from_map(BTreeMap<String,String>)`（key = `sha256(url + body)` 十六进制前 16 位；未命中返回 `TransportError::Other("fixture miss: <key>")`）。

- [ ] 失败测试（wiremock）：mock 200 → `ReqwestTransport.send` 返回 body 与 status；mock 超时（delay > timeout）→ `TransportError::Timeout`
- [ ] 失败测试：`FixtureTransport` 命中返回录制响应；未命中错误信息含 `fixture miss`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(llm): 传输层抽象与 fixture 回放`

### Task 11: geo-llm 客户端、重试与用量

**Files:** Create `crates/geo-llm/src/{client.rs,error.rs}`

**Interfaces:** Produces `ChatRole{System,User,Assistant}`、`ChatMessage{role,content}`、`ChatRequest{messages,response_format_json:bool,temperature:Option<f32>}`、`ChatResponse{content:String,usage:Usage,model:String,finish_reason:Option<String>}`、`Usage{prompt_tokens,completion_tokens,total_tokens}`、`LlmError{Config,Transport(TransportError),RateLimited,Server{status},BadResponse(String),Deserialize(String)}`、`struct LlmClient{config,transport:Arc<dyn Transport>,api_key:String}`、`LlmClient::new(config,api_key,transport)`、`async fn chat(&self,req:&ChatRequest)->Result<ChatResponse,LlmError>`、`async fn chat_with_cost(&self,req)->Result<(ChatResponse,f64),LlmError>`。

- [ ] 失败测试（wiremock）：429 两次后 200 → 成功且共 3 次请求；400 → 立即失败不重试（仅 1 次请求）；500 连续 → 重试到 `max_retries` 后 `LlmError::Server`
- [ ] 失败测试：`Usage` 从 OpenAI 兼容响应解析；`chat_with_cost` 返回按 pricing 折算的 `cost_cny`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(llm): 聊天客户端、指数退避重试与用量记账`

### Task 12: geo-llm 结构化输出

**Files:** Create `crates/geo-llm/src/json.rs`

**Interfaces:** Produces `fn extract_json(text:&str)->Result<String,LlmError>`（支持裸 JSON、```json 代码块、前后夹带文字）、`async fn chat_json<T: DeserializeOwned>(client:&LlmClient, req:&ChatRequest, validate: impl Fn(&T)->Result<(),String>) -> Result<T,LlmError>`（解析或校验失败时，把错误说明追加为 user 消息重试 1 次）。

- [ ] 失败测试：三种包裹形式都能抽出同一 JSON；`"没有 JSON"` → `LlmError::BadResponse`
- [ ] 失败测试：首次返回非法 JSON、第二次合法 → 成功且 transport 收到 2 次请求；两次都非法 → `LlmError::Deserialize`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(llm): 结构化输出抽取与修复重试`

### Task 13: geo-crawler 编码探测与正文提取

**Files:** Create `crates/geo-crawler/src/{extract.rs,lib.rs}`

**Interfaces:** Produces `struct RawPage{url:String,bytes:Vec<u8>,content_type:Option<String>,status:u16}`、`fn detect_charset(content_type:Option<&str>, bytes:&[u8])->&'static encoding_rs::Encoding`（HTTP header → `<meta charset>` → UTF-8 严格解码失败则 GBK）、`fn decode(bytes,&Encoding)->String`、`struct ExtractedPage{url,title,main_text,links:Vec<String>,char_count}`、`fn extract(raw:&RawPage)->Result<ExtractedPage,CrawlerError>`（去 script/style/nav/footer，`html2text` 转正文，收集同域链接）。

- [ ] 失败测试：UTF-8 fixture 页 → title 与正文含预期中文；GBK fixture 页（字节级构造）→ 解码后中文正确，不出现乱码替换符
- [ ] 失败测试：`<script>` 内容不出现在 `main_text`；同域链接被收集、跨域链接被丢弃
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(crawler): 编码探测与正文提取`

### Task 14: geo-crawler robots 与抓取器

**Files:** Create `crates/geo-crawler/src/{robots.rs,fetch.rs}`

**Interfaces:** Produces `struct RobotsRules{disallow:Vec<String>,allow:Vec<String>}`、`RobotsRules::parse(text:&str,user_agent:&str)->Self`、`fn is_allowed(&self,path:&str)->bool`（最长前缀优先，`*` 兜底）、`struct FetchLimits{max_pages:usize=8,per_page_timeout:Duration=10s,total_timeout:Duration=60s,max_bytes:usize=2_097_152}`、`struct SiteFetcher{http:reqwest::Client,limits,user_agent}`、`async fn fetch(&self,url:&Url)->Result<RawPage,CrawlerError>`、`CrawlerError{Blocked{url,reason},Timeout{url},Network(String),TooLarge{url},InvalidUrl(String)}`。

- [ ] 失败测试（wiremock）：`Disallow: /admin` → `/admin/x` 被拒、`/about` 放行；UA 专属规则优先于 `*`
- [ ] 失败测试：超过 `max_bytes` → `CrawlerError::TooLarge`；delay 超过 per-page 超时 → `Timeout`；HTTP 500 → `Network`（含状态码）
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(crawler): robots 遵守与受限抓取器`

### Task 15: geo-crawler 页面发现与分类

**Files:** Create `crates/geo-crawler/src/{discover.rs,site.rs}`

**Interfaces:** Produces `PageRole{Home,About,Product,Faq,Contact,Other}`、`fn classify(url:&Url,title:&str)->PageRole`（URL 关键词 + 标题关键词，中文关键词：关于我们/公司简介/产品/服务/常见问题/联系我们）、`struct CrawlRequest{origin:Url,seed_urls:Vec<Url>}`、`struct CrawlResult{pages:Vec<ExtractedPage>,skipped:Vec<SkippedPage{url,reason}>,roles:HashMap<PageRole,Vec<String>>}`、`async fn crawl_site(fetcher:&SiteFetcher, req:&CrawlRequest, limits:&FetchLimits)->CrawlResult`（同域 BFS，robots 过滤，按角色配额优先，失败不阻断并记入 `skipped`）。

- [ ] 失败测试（wiremock 提供 `fixtures/http/` 的 5 页站点）：抓到 5 页且角色映射正确；`/admin` 因 robots 进 `skipped` 且 reason 含 `robots`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(crawler): 同域页面发现与角色分类`

### Task 16: geo-store 数据库与迁移

**Files:** Create `crates/geo-store/src/{db.rs,error.rs,lib.rs}`、`crates/geo-store/migrations/20260916000001_init.sql`

**Interfaces:** Produces `StoreError`（`thiserror` + `From<sqlx::Error>`）、`async fn open(path:&Path)->Result<SqlitePool,StoreError>`（建父目录、`create_if_missing`、WAL、`foreign_keys=ON`、`busy_timeout=5000`、`sqlx::migrate!("./migrations")`）、`async fn open_in_memory()->Result<SqlitePool,StoreError>`（测试用）。

- [ ] 失败测试：`open(tempfile dir/geo.db)` 后 `SELECT count(*) FROM projects` 可执行；重复 `open` 幂等；删项目级联删竞品/资产/prompt 集（外键生效）
- [ ] 跑红 → 写迁移 → 实现 → 跑绿 → Commit `feat(store): SQLite 连接、WAL 与初始迁移`

### Task 17: 项目 / 竞品 / 资产仓储

**Files:** Create `crates/geo-store/src/repo/{mod.rs,project.rs,competitor.rs,asset.rs}`

**Interfaces:** Produces `ProjectRepo{pool}`：`create(&Project)`、`get(id)`、`list(filter:&ProjectFilter{query,include_archived,tags})`、`update(&Project)`、`archive(id,now)`、`delete(id)`；`CompetitorRepo`：`upsert`、`list_by_project`、`delete`、`reorder(project_id, ids)`；`AssetRepo`：`add`、`list_by_project`、`delete`。

- [ ] 失败测试：create→get 字段（含 `aliases`/`tags` JSON 列）完全一致；`list(query="水泵")` 命中名称与品牌名；归档后默认 `list` 不返回、`include_archived=true` 返回；`reorder` 后 `position` 与传入顺序一致
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(store): 项目、竞品与资产仓储`

### Task 18: 实体卡与修订仓储

**Files:** Create `crates/geo-store/src/repo/entity_card.rs`

**Interfaces:** Produces `EntityCardRepo`：`upsert(&EntityCard)`、`get(project_id)->Result<Option<EntityCard>>`、`save_revision(&EntityCardRevision)`、`revisions(project_id)->Vec<EntityCardRevision>`（按 `edited_at` 倒序）。

- [ ] 失败测试：upsert 后 get 一致（含 `field_status` 与 `source`）；二次 upsert 覆盖且 `updated_at` 变化；两次 `save_revision` 后 `revisions()` 返回 2 条且顺序为最新在前
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(store): 实体卡与字段级修订留痕`

### Task 19: Prompt 集仓储

**Files:** Create `crates/geo-store/src/repo/prompt_set.rs`

**Interfaces:** Produces `PromptSetRepo`：`create(&PromptSet)`（事务写 set + items）、`get(id)->PromptSet`、`latest_for_project(project_id)->Option<PromptSet>`、`list_by_project`、`replace_items(set_id, Vec<PromptItem>, now)`（重算 `item_count`/`content_hash`/`sample_size_grade`）、`delete(id)`。

- [ ] 失败测试：create 80 条后 get 返回 80 条且顺序按 `position`；`replace_items` 后 `content_hash` 与 `item_count` 更新；`latest_for_project` 返回 version 最大者
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(store): prompt 集与版本化快照仓储`

### Task 20: 设置与密钥存储

**Files:** Create `crates/geo-store/src/{settings.rs,secret.rs}`

**Interfaces:** Produces `AppSettings{proxy:Option<ProxyConfig>,concurrency:ConcurrencyConfig,rate_limit:RateLimitConfig,model:ModelConfig,language:String,notify:NotifyConfig}` + `Default`、`SettingsRepo{get()->AppSettings, update(&AppSettings)}`（缺键回落默认）、`#[async_trait] trait SecretStore{set,get,delete}`、`KeyringSecretStore::new(service:"com.gaodekuai.geo")`、`MemorySecretStore::default()`、`fn secret_ref(kind:&str,provider:&str)->String`。

- [ ] 失败测试：空库 `get()` 返回 `AppSettings::default()`；`update` 后 `get` 一致；`MemorySecretStore` set/get/delete 语义正确，`get` 未设置返回 `None`
- [ ] 失败测试：`secret_ref("llm","deepseek")=="keyring://llm/deepseek"`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(store): 应用设置与钥匙串密钥存储`

### Task 21: Tauri 状态、IPC 错误与命令注册

**Files:** Create `apps/desktop/src-tauri/src/{error.rs,state.rs,ipc/mod.rs}`

**Interfaces:** Produces `IpcError{code:String,message:String,detail:Option<serde_json::Value>}`（`Serialize`，`From<GeoError>`/`From<StoreError>`/`From<LlmError>`/`From<CrawlerError>` 映射到稳定 code）、`AppState{pool:SqlitePool,secrets:Arc<dyn SecretStore>,llm:Arc<LlmFactory>,fetcher:Arc<SiteFetcher>}`、`AppState::initialize(app:&tauri::AppHandle)->Result<Self,Box<dyn Error>>`（用 `app.path().app_data_dir()`）、`AppState::for_test(pool, secrets, llm, fetcher)`、`ipc::handler()->tauri::ipc::InvokeHandler`（`generate_handler!` 全量命令）。

- [ ] 失败测试：`GeoError::NotFound{kind:"project",..}` → `IpcError.code=="project/not_found"`；`LlmError::RateLimited` → `llm/rate_limited`；错误 message 非空且不含 `sk-` 前缀密钥样式字符串
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(desktop): 应用状态、IPC 错误映射与命令注册`

### Task 22: 项目与实体卡服务

**Files:** Create `apps/desktop/src-tauri/src/services/{mod.rs,project_service.rs,entity_card_service.rs}`、`apps/desktop/src-tauri/src/ipc/{project.rs,entity_card.rs}`

**Interfaces:** Consumes `geo-store` repos、`geo-crawler::crawl_site`、`geo-llm::chat_json`。Produces `ProjectService{new(pool), create_draft(ProjectDraft,now)->Project, list/get/update/archive/delete, export_json(id)->ProjectExport, import_json(&str,now)->ImportReport}`、`EntityCardService{new(pool,llm,fetcher), autobuild(project_id,domain,now)->EntityCard, get, update_field(project_id,path,value,status,note,now)->EntityCardRevision, revisions}`、`ProjectExport{project,entity_card,revisions,competitors,assets,prompt_sets}`、`ImportReport{project_id,counts:HashMap<String,usize>}`；IPC 命令 `project_create/project_list/project_get/project_update/project_archive/project_delete/project_export/project_import/entity_card_autobuild/entity_card_get/entity_card_update_field/entity_card_revisions/competitor_upsert/competitor_list/competitor_delete/competitor_reorder/asset_add/asset_list/asset_delete`。

- [ ] 失败测试（service 直调，wiremock + `FixtureTransport`）：`autobuild` 对 fixture 站点产出完整率 ≥0.8 的实体卡；LLM 返回非法 JSON 时重试 1 次后成功；LLM 完全不可用时返回带 `Pending` 字段的降级实体卡而非报错
- [ ] 失败测试：`export_json` → `import_json` 后字段一致且生成新 ID；`update_field` 写入修订
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(desktop): 项目与实体卡服务及命令`

### Task 23: Prompt 生成服务（M2 编排）

**Files:** Create `apps/desktop/src-tauri/src/services/{templates.rs,prompt_service.rs}`、`apps/desktop/src-tauri/src/ipc/prompt.rs`

**Interfaces:** Consumes `geo-domain::{dedupe,prompt,csv_io}`、`geo-llm::chat_json`、`geo-store::PromptSetRepo`。Produces `templates::industry_templates(Industry)->&'static [PromptTemplate]`、`PromptTemplate{intent,text}`、`fn expand_templates(project:&Project,competitors:&[Competitor],template:&[PromptTemplate])->Vec<PromptItem>`、`GenerateOptions{target_count:u16,industry:Industry,intents:Option<Vec<IntentCategory>>,repeat_count:u8}`、`PromptService{new(pool,llm), generate(project_id,GenerateOptions,now)->PromptSet, list/get/rename/delete, update_item, update_items_bulk, dedupe_set(set_id,now)->DedupeReport, export_csv(set_id)->String, import_csv(set_id,&str,now)->CsvImportResult}`。生成管线：模板展开 → LLM 扩写（失败降级为纯模板）→ 口语化改写 → 竞品同框补足 → 去重 → 加权分组 → 落库快照。

- [ ] 失败测试（`FixtureTransport`）：默认参数产出 `items.len()>=60`、`intent_coverage().len()==7`、`dedupe.duplicate_pairs==0`、`content_hash` 非空、`sample_size_grade==Sufficient`
- [ ] 失败测试：LLM 不可用（transport 全失败）时仍产出 ≥60 条且 `notes` 含「降级」
- [ ] 失败测试：`export_csv` → `import_csv` 往返条目数与文本一致；`update_item` 后 `content_hash` 变化
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(desktop): prompt 题库生成、去重与版本化`

### Task 24: 设置/密钥命令与全链路集成测试

**Files:** Create `apps/desktop/src-tauri/src/ipc/{settings.rs,secret.rs}`、`apps/desktop/src-tauri/tests/service_flow.rs`

**Interfaces:** Produces 命令 `settings_get/settings_update/secret_set/secret_status/secret_delete/llm_provider_test`；集成测试辅助 `fn test_state()->AppState`（内存 SQLite + `MemorySecretStore` + `FixtureTransport` + 指向 wiremock 的 fetcher）。

- [ ] 失败测试：`settings_update` 后 `settings_get` 一致；`secret_status` 只返回布尔与 ref，不返回值；`llm_provider_test` 在无 Key 时返回 `llm/missing_secret`
- [ ] 失败测试（全链路）：建项目 → 加 3 竞品 → 自动建档 → 生成题库 → 导出 CSV，断言 ≥60 条 / 7 类意图 / 重复对 0 / 完整率 ≥0.8
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(desktop): 设置与密钥命令，补全链路集成测试`

### Task 25: 前端脚手架与 API 层

**Files:** Create `apps/desktop/ui/{vite.config.ts,tsconfig.json,tsconfig.node.json,eslint.config.js,index.html,src/main.tsx,src/App.tsx,src/index.css,src/api/{client.ts,types.ts},src/test/{setup.ts,invoke-mock.ts}}`

**Interfaces:** Produces `src/api/types.ts`（与 Rust DTO 一一对应的 TS 类型）、`src/api/client.ts`（每个 IPC 命令一个导出函数，统一 `unwrapIpcError`）、`invoke-mock`（vitest 环境替换 `@tauri-apps/api/core` 的 `invoke`）、路由 `/projects`、`/projects/:id/wizard`、`/projects/:id/entity-card`、`/projects/:id/prompts`、`/settings`。

- [ ] 失败测试：`client.projectList()` 在 mock invoke 下返回项目数组；后端返回 `{code,message}` 时抛出带 `message` 的 `Error`
- [ ] 跑红 → 实现 → `pnpm build` + `pnpm test` 绿 → Commit `feat(ui): 前端脚手架、IPC 客户端与路由`

### Task 26: 项目列表与 5 步建项向导

**Files:** Create `apps/desktop/ui/src/pages/{ProjectListPage.tsx,ProjectWizardPage.tsx}`、`src/components/{ProjectTable.tsx,WizardSteps.tsx,CompetitorEditor.tsx}`、`src/store/wizard-draft.ts`

**Interfaces:** Consumes `api/client.ts`。Produces zustand `useWizardDraft`（分步数据 + `saveDraft()/loadDraft()/clearDraft()` 走 `localStorage`，key `geo.wizard.draft`）。

- [ ] 失败测试（RTL）：品牌名为空点下一步 → 显示校验错误且不前进；填完 5 步提交 → 调用 `projectCreate` 且参数含 3 个竞品；刷新后 `loadDraft()` 恢复已填内容
- [ ] 失败测试：列表页搜索「水泵」触发带 query 的 `projectList`；归档项目默认不显示，勾选「显示已归档」后显示
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(ui): 项目列表与建项向导`

### Task 27: 实体卡页面

**Files:** Create `apps/desktop/ui/src/pages/EntityCardPage.tsx`、`src/components/{EntityFieldCard.tsx,FieldStatusTag.tsx,RevisionTimeline.tsx,AutoBuildPanel.tsx}`

**Interfaces:** Consumes `entityCardGet/entityCardAutobuild/entityCardUpdateField/entityCardRevisions`。

- [ ] 失败测试：渲染完整率进度条（0.8 → 显示 80%）；`Pending` 字段渲染橙色 Tag；编辑字段并保存 → 调用 `entityCardUpdateField` 且时间线新增一条；点「自动建档」→ 调用 `entityCardAutobuild` 并展示 loading 与新完整率
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(ui): 品牌实体卡与修订时间线`

### Task 28: Prompt 题库页面

**Files:** Create `apps/desktop/ui/src/pages/PromptSetPage.tsx`、`src/components/{PromptTable.tsx,GeneratePanel.tsx,SampleSizeAlert.tsx,CsvToolbar.tsx}`

**Interfaces:** Consumes `promptSetGenerate/promptSetList/promptSetGet/promptItemUpdate/promptSetDedupe/promptSetExportCsv/promptSetImportCsv`。

- [ ] 失败测试：`SampleSizeGrade=Directional` 时渲染「样本不足，仅供方向性参考」Alert，`Sufficient` 时不渲染；表格按意图筛选生效；调整 weight 调用 `promptItemUpdate`；点「导出 CSV」拿到含表头的字符串；生成按钮展示进度并在完成后刷新条数与 `content_hash`
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(ui): prompt 题库生成、筛选与 CSV 导入导出`

### Task 29: 设置页与密钥管理

**Files:** Create `apps/desktop/ui/src/pages/SettingsPage.tsx`、`src/components/{ProviderSelect.tsx,SecretStatus.tsx,ProxyForm.tsx}`

**Interfaces:** Consumes `settingsGet/settingsUpdate/secretSet/secretStatus/llmProviderTest`。

- [ ] 失败测试：Provider 切换后展示对应 base_url 与默认模型（只读）；`secretStatus=false` 时显示「未配置」并提供保存按钮；保存 Key 调用 `secretSet` 且输入框随后清空；「测试连接」在无 Key 时展示中文错误「未配置 API Key」
- [ ] 跑红 → 实现 → 跑绿 → Commit `feat(ui): 设置页与 API Key 管理`

### Task 30: Fixtures、Docker、CI 与收尾

**Files:** Create `fixtures/http/{index.html,about.html,products.html,faq.html,contact.html,gbk-page.html,robots.txt}`、`fixtures/llm/{entity_card.json,prompt_expand.json,prompt_rewrite.json,entity_card_invalid_then_ok.json}`、`scripts/record-fixtures.sh`、`docker/dev.Dockerfile`、`docker-compose.yml`、`.github/workflows/ci.yml`、`brand/icon-source.png`

**Interfaces:** Consumes 前述所有测试。Produces CI 工作流 `ci`（job：`rust`、`ui`，均跑在自建镜像内）与本地 `docker compose run --rm dev mise run check`。

- [ ] 写 fixtures（5 页 UTF-8 企业站 + 1 页 GBK + robots.txt 禁 `/admin`；4 组 LLM 响应，其中一组首次非法 JSON）
- [ ] 写 `docker/dev.Dockerfile`（debian:trixie + rustup stable + node 24.21.0 + pnpm 12.4.2 + `libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev pkg-config build-essential`）与 `docker-compose.yml`（源码 bind mount；`cargo-registry`/`cargo-target`/`pnpm-store`/`node-modules` 命名卷）
- [ ] 写 `.github/workflows/ci.yml`：容器内跑 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、`pnpm lint`、`pnpm test`、`pnpm build`、`cargo check -p geo-desktop`
- [ ] `mise run check` 全绿 + `docker compose run --rm dev mise run check` 全绿（可选，取决于 Docker 内存配额）
- [ ] Commit `chore: fixtures、Docker CI 镜像与工作流`

---

## Self-Review 结论

- **Spec 覆盖**：FR-B1..B7 → T1/T16/T20/T21/T30；FR-M1-1..6 → T3/T4/T17/T18/T22/T26/T27；FR-M2-1..6 → T5/T6/T7/T19/T23/T28；FR-L1..L5 → T9/T10/T11/T12/T8/T30。无遗漏。
- **类型一致性**：`PromptSet.content_hash()`(T5) 与 `PromptSetRepo.replace_items`(T19)、`PromptService`(T23) 使用同名；`SampleSizeGrade`(T5) 贯穿 T19/T23/T28；`SecretStore`(T20) 被 T21/T24 消费；`DedupeReport`(T6) 被 T23/T28 消费。
- **占位符扫描**：无 TBD/TODO；每个 task 均给出 Files、Interfaces 与可执行验证步骤。
