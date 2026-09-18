//! M1 自动建档服务：抓官网 → 模型结构化抽取 → 实体卡（字段级状态 + 修订留痕）。
//!
//! 两条纪律（spec FR-M1-2/FR-M1-3）：
//! 1. **只抓自有域名**：origin 由用户显式给出，种子页也只保留同 host 的资产；
//! 2. **模型不可用不阻断用户**：无 Key、超时、限流、输出非法都降级为
//!    「建项资料 + 官网可见信息」的待确认卡，而不是把错误甩给用户。

use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_crawler::{crawl_site, CrawlRequest, SiteFetcher};
use geo_domain::{
    normalize_url, EntityCard, EntityCardRevision, EntityCardSource, EntityFields, FieldStatus,
    GeoError, Project, ProjectId, ALL_FIELDS,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmConfig, LlmError};
use geo_store::{AppSettings, EntityCardRepo, ProjectRepo, SecretStore, SettingsRepo};
use serde_json::Value;
use sqlx::SqlitePool;
use url::Url;

use crate::error::{err_codes, redact, IpcError};
use crate::state::LlmFactory;

/// 喂给模型的官网正文上限：够覆盖首页+关于+产品+FAQ+联系，又不会顶爆上下文。
pub const MAX_SITE_TEXT_CHARS: usize = 12_000;

/// `crawler/empty` 的 `skipped` 参数最多报几条被跳过的页面（契约 note 里写的「至多 3 条」）。
const MAX_REPORTED_SKIPPED: usize = 3;
/// `skipped` 里各条之间的分隔符。纯 ASCII：params 的取值只能是语言中立数据。
const SKIPPED_SEPARATOR: &str = "; ";

/// 抽取用的系统提示词。强调「只输出 JSON 本体」与「查不到就留空」，
/// 后者是防幻觉的关键：宁可字段空缺（待确认），也不要模型编资质与案例。
const EXTRACTION_SYSTEM: &str = "你是品牌信息抽取助手，服务于中国企业的内容营销团队。\
用户会给你某个品牌官网的正文文本，你要把它整理成结构化的品牌实体卡 JSON。\
规则：1) 只输出 JSON 本体，不要 Markdown 代码块、不要解释文字；\
2) 顶层键必须严格是 standard_name、aliases、founded_year、qualifications、products、\
price_range、service_regions、cases、differentiators、official_tone、contact，不得增删；\
3) products 是数组，每项含 name、params（字符串数组）、note（可为 null）；\
contact 含 phone、email、address，未知填 null；\
4) 文本里查不到的信息一律留空（空数组或 null），绝对不要猜测或编造；\
5) 保留原文的数字、型号、单位与资质编号，不要改写；\
6) 不得使用「保证排名/霸屏/第一/最佳/最优/唯一/顶级/100%/永久」等绝对化用语。";

/// 自动建档服务。
#[derive(Clone)]
pub struct EntityCardService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    fetcher: Arc<SiteFetcher>,
    secrets: Arc<dyn SecretStore>,
}

impl EntityCardService {
    pub fn new(
        pool: SqlitePool,
        llm: Arc<LlmFactory>,
        fetcher: Arc<SiteFetcher>,
        secrets: Arc<dyn SecretStore>,
    ) -> Self {
        Self {
            pool,
            llm,
            fetcher,
            secrets,
        }
    }

    /// 从应用状态装配（IPC 命令层用这个，测试也用它）。
    pub fn from_state(state: &crate::state::AppState) -> Self {
        Self::new(
            state.pool.clone(),
            state.llm.clone(),
            state.fetcher.clone(),
            state.secrets.clone(),
        )
    }

    fn cards(&self) -> EntityCardRepo {
        EntityCardRepo::new(self.pool.clone())
    }

    /// 自动建档主流程。`domain` 可以是 `example.com`、`https://example.com` 或带路径的首页地址。
    pub async fn autobuild(
        &self,
        project_id: ProjectId,
        domain: &str,
        now: DateTime<Utc>,
    ) -> Result<EntityCard, IpcError> {
        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let origin = origin_from_domain(domain)?;
        let seeds = self.seed_urls(&project, &origin).await?;

        let limits = self.fetcher.limits;
        let crawled = crawl_site(
            &self.fetcher,
            &CrawlRequest::with_seeds(origin.clone(), seeds),
            &limits,
        )
        .await;
        if crawled.pages.is_empty() {
            // `crawler/empty` 契约登记 `["domain","skipped"]`，两个键**永远都发**
            // （与 `crawler/blocked` 的 `value` 同一口径：前端不必条件渲染），
            // 一页都没跳过时 `skipped` 是空串。
            // `skipped` 是至多 3 条 `"{url} {reason}"` 用 `"; "` 连接的**ASCII** 数据行：
            // `SkippedPage.reason` 已统一成稳定记号（裁定 §G-5 / R-C4），
            // 中文说明只留在 `site.rs` 的日志里，绝不进 params
            // （壳侧 `guard_instance_params_stay_ascii` 没有白名单）。
            let skipped: Vec<String> = crawled
                .skipped
                .iter()
                .take(MAX_REPORTED_SKIPPED)
                .map(|page| format!("{} {}", page.url, page.reason))
                .collect();
            return Err(IpcError::with_params(
                err_codes::CRAWLER_EMPTY,
                [
                    ("domain", origin.as_str()),
                    ("skipped", skipped.join(SKIPPED_SEPARATOR).as_str()),
                ],
            ));
        }

        let pages: Vec<String> = crawled.pages.iter().map(|page| page.url.clone()).collect();
        let site_text = crawled.combined_text(MAX_SITE_TEXT_CHARS);
        let existing = self.cards().get(project_id).await?;
        let confirmed = self.confirmed_fields(project_id).await?;
        let baseline = baseline_fields(&project, existing.as_ref());
        let settings = SettingsRepo::new(self.pool.clone()).get().await?;

        let (fields, source) = match self
            .extract(&project, &site_text, &settings, &baseline)
            .await
        {
            Ok((fields, config)) => (
                fields,
                EntityCardSource {
                    crawled_pages: pages.clone(),
                    llm_provider: Some(config.provider.as_str().to_string()),
                    llm_model: Some(config.model.clone()),
                    generated_at: Some(now),
                },
            ),
            Err(reason) => {
                // 降级不是失败：仍然把官网抓到的页面记进来源，字段全部待确认
                tracing::warn!(project_id = %project_id, reason = %reason, "模型抽取不可用，降级为建项资料");
                (
                    baseline,
                    EntityCardSource {
                        crawled_pages: pages,
                        llm_provider: None,
                        llm_model: None,
                        generated_at: Some(now),
                    },
                )
            }
        };

        let mut card = EntityCard::from_extraction(project_id, fields, source, now);
        if let Some(existing) = &existing {
            card.created_at = existing.created_at;
            preserve_confirmed_fields(&mut card, existing, &confirmed);
        }
        self.cards().upsert(&card).await?;

        tracing::info!(
            project_id = %project_id,
            pages = card.source.crawled_pages.len(),
            completeness = card.completeness,
            degraded = card.source.llm_provider.is_none(),
            "自动建档完成"
        );
        Ok(card)
    }

    pub async fn get(&self, project_id: ProjectId) -> Result<Option<EntityCard>, IpcError> {
        Ok(self.cards().get(project_id).await?)
    }

    /// 字段级编辑：改值 + 改可信状态 + 写修订（留痕是硬性要求，见 spec FR-M1-4）。
    pub async fn update_field(
        &self,
        project_id: ProjectId,
        path: &str,
        value: Value,
        status: FieldStatus,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<EntityCardRevision, IpcError> {
        let mut card = self
            .cards()
            .get(project_id)
            .await?
            .ok_or_else(|| GeoError::not_found("entity_card", project_id))?;
        let revision = card.set_field(path, value, status, now, note)?;
        // 卡与修订必须一起落库：`confirmed_fields()` 靠修订认「人工已确认」，
        // 只写卡会让这个字段在下次自动建档时被模型悄悄覆盖。
        self.cards().upsert_with_revision(&card, &revision).await?;
        Ok(revision)
    }

    pub async fn revisions(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<EntityCardRevision>, IpcError> {
        Ok(self.cards().revisions(project_id).await?)
    }

    /// 人工确认为「官方口径」的顶层字段名（依据修订留痕，而非当前状态）。
    ///
    /// 用修订判定而不是用状态判定的原因：建项时种下的初始卡也是官方口径，
    /// 但那是用户填的资料、不是人工核对过的结论，重建时应当允许模型刷新；
    /// 只有留下过修订记录的字段才是「有人为它背过书」，重建时必须原样保留。
    async fn confirmed_fields(&self, project_id: ProjectId) -> Result<Vec<String>, IpcError> {
        let mut confirmed: Vec<String> = Vec::new();
        for revision in self.cards().revisions(project_id).await? {
            if revision.status != FieldStatus::Official {
                continue;
            }
            let root = root_field_name(&revision.field_path);
            if !confirmed.iter().any(|field| field == root) {
                confirmed.push(root.to_string());
            }
        }
        Ok(confirmed)
    }

    /// 同 host 的种子页：origin 根路径 + 项目里登记的自有页面（跨域的一律丢掉）。
    async fn seed_urls(&self, project: &Project, origin: &Url) -> Result<Vec<Url>, IpcError> {
        let mut seeds = vec![origin.clone()];
        for asset in geo_store::AssetRepo::new(self.pool.clone())
            .list_by_project(project.id)
            .await?
        {
            let Ok(url) = Url::parse(&asset.url) else {
                continue;
            };
            if url.host_str() != origin.host_str() || seeds.contains(&url) {
                continue;
            }
            seeds.push(url);
        }
        Ok(seeds)
    }

    /// 调模型抽取实体卡。任何一步不可用都返回**原因串**，由调用方决定降级。
    ///
    /// 这个 `Err(String)` 只进 `tracing::warn!`，**不落库、不到 UI**，因此不是文案出口：
    /// 内容是各错误的紧凑日志串（`{code} k=v …`）或 `llm/missing_secret` 这类稳定记号。
    /// 校验器原文（`fields.validate()`）另有一条路：它进 `chat_json` 的修复追问 prompt
    /// 与 `geo-llm` 的日志，同样不到 UI（裁定 R-I / §K）。
    async fn extract(
        &self,
        project: &Project,
        site_text: &str,
        settings: &AppSettings,
        baseline: &EntityFields,
    ) -> Result<(EntityFields, LlmConfig), String> {
        let config = LlmFactory::config_from_settings(settings).map_err(|error| error.message)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await
            .map_err(|error| error.to_string())?
            .filter(|key| !key.trim().is_empty())
            // 稳定记号而不是中文散文：这条串只进日志，与 `config_from_settings`
            // 失败时拿到的 `error.message`（同样是 `{code} k=v …` 紧凑串）保持同一形态。
            .ok_or_else(|| LlmError::MissingSecret.code().to_string())?;

        let client = self.llm.client(config.clone(), &api_key);
        let request = ChatRequest::new(vec![
            ChatMessage::system(EXTRACTION_SYSTEM),
            ChatMessage::user(extraction_prompt(project, site_text)),
        ])
        .json();

        let extracted: EntityFields = chat_json(&client, &request, |fields: &EntityFields| {
            fields.validate().map_err(|error| error.user_message())
        })
        .await
        .map_err(|error| redact(&error.user_message()))?;

        Ok((merge_with_baseline(baseline, extracted, project), config))
    }
}

/// 用户输入的域名 → 抓取 origin。
///
/// 合法性（协议、域名/IP 形态）交给 `geo_domain::normalize_url` 统一判定，
/// 这里只负责把深层链接收敛成站点根，避免用户贴了 `/products/1.html`
/// 就把 origin 当成子目录、导致同域判定失效。
fn origin_from_domain(domain: &str) -> Result<Url, IpcError> {
    let normalized = normalize_url("domain", domain)?;
    // 防御性分支：`normalize_url` 返回的正是它自己 `Url::parse` 成功过的串，
    // 公开 API 走不到这里，因此由 `the_unreachable_parse_fallback_still_uses_a_directory_key`
    // 用源码字面量钉住映射。
    let mut origin = Url::parse(&normalized)
        .map_err(|_| GeoError::validation("domain", "invalid_url").with_param("value", domain))?;
    origin.set_path("/");
    origin.set_query(None);
    origin.set_fragment(None);
    Ok(origin)
}

/// 兜底字段：已有实体卡（含建项时用户填的产品线）优先，缺口用项目资料补齐。
///
/// 模型不可用时就用它出「待确认」卡——降级可以少字段，但不能把用户填过的东西弄丢。
fn baseline_fields(project: &Project, existing: Option<&EntityCard>) -> EntityFields {
    let mut fields = existing.map_or_else(EntityFields::default, |card| card.fields.clone());
    if fields.standard_name.trim().is_empty() {
        fields.standard_name = project.brand_name.clone();
    }
    for alias in &project.aliases {
        if !fields.aliases.iter().any(|item| item == alias) {
            fields.aliases.push(alias.clone());
        }
    }
    if fields.service_regions.is_empty() && !project.region.trim().is_empty() {
        fields
            .service_regions
            .push(project.region.trim().to_string());
    }
    if fields.official_tone.is_none() {
        if let Some(website) = &project.website {
            fields.official_tone = Some(format!("官方网址：{website}"));
        }
    }
    fields
}

/// 修订路径的顶层字段名：`products[0].name` → `products`。
fn root_field_name(path: &str) -> &str {
    let end = path.find(['.', '[']).unwrap_or(path.len());
    &path[..end]
}

/// 模型结果优先，但缺失的部分用建项资料补上——用户在向导里填过的东西不能丢。
fn merge_with_baseline(
    baseline: &EntityFields,
    mut extracted: EntityFields,
    project: &Project,
) -> EntityFields {
    if extracted.standard_name.trim().is_empty() {
        extracted.standard_name = project.brand_name.clone();
    }
    if extracted.products.is_empty() {
        extracted.products = baseline.products.clone();
    }
    if extracted.service_regions.is_empty() {
        extracted.service_regions = baseline.service_regions.clone();
    }
    for alias in &project.aliases {
        if !extracted.aliases.iter().any(|item| item == alias) {
            extracted.aliases.push(alias.clone());
        }
    }
    extracted
}

/// 人工确认过的字段是资产：重建时值与状态都保留，只刷新其余字段。
fn preserve_confirmed_fields(card: &mut EntityCard, existing: &EntityCard, confirmed: &[String]) {
    if confirmed.is_empty() {
        return;
    }
    restore_fields(&mut card.fields, &existing.fields, confirmed);
    for field in confirmed {
        card.field_status
            .insert(field.clone(), FieldStatus::Official);
    }
    card.completeness = card.fields.completeness();
}

/// 按字段名把 `source` 的值覆盖回 `target`（借 serde 走，避免为 11 个字段写 11 个分支）。
fn restore_fields(target: &mut EntityFields, source: &EntityFields, fields: &[String]) {
    let Ok(mut tree) = serde_json::to_value(&*target) else {
        return;
    };
    let Ok(from) = serde_json::to_value(source) else {
        return;
    };
    for field in fields {
        if !ALL_FIELDS.contains(&field.as_str()) {
            continue;
        }
        if let (Some(map), Some(value)) = (tree.as_object_mut(), from.get(field)) {
            map.insert(field.clone(), value.clone());
        }
    }
    if let Ok(restored) = serde_json::from_value::<EntityFields>(tree) {
        *target = restored;
    }
}

/// 抽取用的用户提示词：品牌背景 + 官网正文。
fn extraction_prompt(project: &Project, site_text: &str) -> String {
    format!(
        "品牌名：{brand}\n已知别名：{aliases}\n官网：{website}\n服务地域：{region}\n行业：{industry}\n\n\
         以下是该品牌官网若干页面的正文，请据此抽取实体卡 JSON：\n\n{text}",
        brand = project.brand_name,
        aliases = if project.aliases.is_empty() {
            "（无）".to_string()
        } else {
            project.aliases.join("、")
        },
        website = project.website.as_deref().unwrap_or("（未填写）"),
        region = project.region,
        industry = project.industry.label_zh(),
        text = site_text,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 域名规范化（裁定 R-H 第一档）：深层链接收敛成站点根，同域判定才不会失效。
    #[test]
    fn origin_from_domain_collapses_deep_links_to_the_site_root() {
        let origin = origin_from_domain("https://hongyu-pump.example/products/1.html?a=1#top")
            .expect("合法深层链接");
        assert_eq!(origin.as_str(), "https://hongyu-pump.example/");

        let bare = origin_from_domain("  hongyu-pump.example  ").expect("裸域名补 https");
        assert_eq!(bare.as_str(), "https://hongyu-pump.example/");
    }

    /// 非法输入一律由 `geo_domain::normalize_url` 判定，本层不重写判据；
    /// 断言到 params 的键与值，`field` 恒为 `domain`（裁定 R-F：`field` 是前端词典键）。
    #[test]
    fn origin_from_domain_reports_directory_keys_for_bad_input() {
        struct Case {
            name: &'static str,
            input: &'static str,
            reason: &'static str,
            extra: &'static [(&'static str, &'static str)],
        }

        for case in [
            Case {
                name: "留空",
                input: "   ",
                reason: "required",
                extra: &[],
            },
            Case {
                name: "不是域名",
                input: "这不是域名",
                reason: "invalid_url",
                extra: &[("value", "这不是域名")],
            },
            Case {
                name: "协议不允许",
                input: "ftp://hongyu-pump.example",
                reason: "not_allowed",
                extra: &[("value", "ftp")],
            },
        ] {
            let error = origin_from_domain(case.input).expect_err(case.name);
            assert_eq!(error.code, "validation/failed", "{}", case.name);
            assert_eq!(error.params["field"], "domain", "{}", case.name);
            assert_eq!(error.params["reason"], case.reason, "{}", case.name);

            let mut expected: std::collections::BTreeMap<String, String> = case
                .extra
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect();
            expected.insert("field".to_string(), "domain".to_string());
            expected.insert("reason".to_string(), case.reason.to_string());
            assert_eq!(error.params, expected, "{}：{:?}", case.name, error.params);
        }
    }

    /// `origin_from_domain` 里 `Url::parse(&normalized)` 那一支**从公开 API 不可达**：
    /// `normalize_url` 返回的正是它自己 `Url::parse` 成功过的 `candidate`，
    /// 再解析一次不可能失败。它是防御性分支，因此改用源码字面量钉住映射
    /// （与 `crates/geo-domain/tests/reason_key_sites.rs` 的 `UNREACHABLE` 同一手法）。
    #[test]
    fn the_unreachable_parse_fallback_still_uses_a_directory_key() {
        let source = include_str!("entity_card_service.rs");
        assert!(
            source.contains("\"invalid_url\""),
            "防御性分支的 reason 必须是目录 key `invalid_url`"
        );
        assert!(
            source.contains(".with_param(\"value\", domain)"),
            "`invalid_url` 必须配套 `value`（目录登记的配套参数），装用户填的原始串"
        );
    }
}
