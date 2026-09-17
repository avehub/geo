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
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmConfig};
use geo_store::{AppSettings, EntityCardRepo, ProjectRepo, SecretStore, SettingsRepo};
use serde_json::Value;
use sqlx::SqlitePool;
use url::Url;

use crate::error::{redact, IpcError};
use crate::state::LlmFactory;

/// 喂给模型的官网正文上限：够覆盖首页+关于+产品+FAQ+联系，又不会顶爆上下文。
pub const MAX_SITE_TEXT_CHARS: usize = 12_000;

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
            let reasons: Vec<String> = crawled
                .skipped
                .iter()
                .take(3)
                .map(|page| format!("{}（{}）", page.url, page.reason))
                .collect();
            return Err(IpcError::new(
                "crawler/empty",
                format!(
                    "未能抓到任何页面：{origin}。请确认域名可访问、robots.txt 未禁止抓取。{}",
                    if reasons.is_empty() {
                        String::new()
                    } else {
                        format!("已跳过：{}", reasons.join("；"))
                    }
                ),
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

    /// 调模型抽取实体卡。任何一步不可用都返回中文原因，由调用方决定降级。
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
            .ok_or_else(|| "未配置 API Key".to_string())?;

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
    let mut origin = Url::parse(&normalized)
        .map_err(|_| GeoError::validation("domain", format!("不是合法网址：{domain}")))?;
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
