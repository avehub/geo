//! 文章管理（Article Studio）服务：方向 → 模板 → 排期 → 文章。
//!
//! 10 条命令与前端 `api/types-article.ts` 一一对应。两处「一条命令两件事」按既有契约保留：
//! - `article_direction_add` 带 `id` 即就地改（归档）；
//! - `article_list` 带 `review` 即先批量评审再回快照。
//!
//! 差异台账 E-64 已登记这两处是真后端**不应照抄**的临时形状，本切片先对齐命令面。
//!
//! 🔴 没有后台定时器：`article_schedule_run` 只处理"立即运行一次"，`next_run_at` 是可算的显示值。

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Utc};
use geo_domain::{
    clamp_article_length, compliance, normalize_schedule_time, render_prompt, Article,
    ArticleDirection, ArticleDirectionDraft, ArticleDirectionSource, ArticleDirectionStatus,
    ArticleFreq, ArticleListQuery, ArticleSchedule, ArticleScheduleDraft, ArticleSlot,
    ArticleSource, ArticleStatus, ArticleTemplate, ArticleTemplateBindings, ArticleTemplateDraft,
    GeoError, KbModule, ProjectId,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{ArticleRepo, CompetitorRepo, ProjectRepo, SecretStore, SettingsRepo, StoreError};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::{clamp_generate_target, compliance_violation};
use crate::state::{AppState, LlmFactory};

#[derive(Clone)]
pub struct ArticleService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl ArticleService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn repo(&self) -> ArticleRepo {
        ArticleRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn client(&self) -> Result<LlmClient, IpcError> {
        let settings = SettingsRepo::new(self.pool.clone()).get().await?;
        let config = LlmFactory::config_from_settings(&settings)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await?
            .filter(|key| !key.trim().is_empty())
            .ok_or(IpcError::from(LlmError::MissingSecret))?;
        Ok(self.llm.client(config, &api_key))
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 方向
    // -----------------------------------------------------------------------

    pub async fn directions(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<ArticleDirection>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.repo().directions(project_id).await?)
    }

    /// 新增或就地改（归档）。`id` 有值时只改传进来的字段。
    pub async fn add_direction(
        &self,
        project_id: ProjectId,
        draft: ArticleDirectionDraft,
        now: DateTime<Utc>,
    ) -> Result<ArticleDirection, IpcError> {
        self.require_project(project_id).await?;
        if let Some(id) = draft
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            let mut existing = match self.repo().direction(id).await {
                Ok(existing) if existing.project_id == project_id => existing,
                Ok(_) | Err(StoreError::NotFound { .. }) => {
                    return Err(GeoError::validation("direction_id", "invalid_id")
                        .with_param("value", id)
                        .into());
                }
                Err(error) => return Err(error.into()),
            };
            if let Some(title) = draft.title.map(|value| value.trim().to_string()) {
                if !title.is_empty() {
                    existing.title = title;
                }
            }
            if let Some(summary) = draft.summary {
                existing.summary = summary.trim().to_string();
            }
            if let Some(status) = draft.status.as_deref().and_then(parse_direction_status) {
                existing.status = status;
            }
            self.repo().update_direction(&existing).await?;
            return Ok(existing);
        }

        let title = draft
            .title
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| GeoError::validation("direction_title", "required"))?;
        let direction = ArticleDirection {
            id: uuid::Uuid::new_v4().to_string(),
            project_id,
            title,
            summary: draft.summary.unwrap_or_default().trim().to_string(),
            source: ArticleDirectionSource::Manual,
            status: ArticleDirectionStatus::Active,
            created_at: now,
        };
        self.repo().insert_direction(&direction).await?;
        Ok(direction)
    }

    /// 调模型生成方向（按标题去重）；生成物一律 `generated` + `active`。
    pub async fn generate_directions(
        &self,
        project_id: ProjectId,
        target_count: u16,
    ) -> Result<Vec<ArticleDirection>, IpcError> {
        self.require_project(project_id).await?;
        let target = usize::from(clamp_generate_target(target_count));
        let project = self.projects().get(project_id).await?;
        let existing = self.repo().directions(project_id).await?;
        let existing_titles = existing
            .iter()
            .map(|direction| direction.title.as_str())
            .collect::<Vec<_>>()
            .join("、");
        let prompt = format!(
            "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}\n\
             已有方向（不要重复）：{existing}\n\
             请给出最多 {target} 个中文内容方向，每个方向包含 title（一句话主题）与 summary\
             （写给谁、在什么场景下写）。只输出 JSON：{{\"items\":[{{\"title\":\"...\",\
             \"summary\":\"...\"}}]}}；不使用“保证排名/第一/最/100%”等绝对化表述。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            region = project.region,
            website = project.website.as_deref().unwrap_or("未填写"),
            existing = if existing_titles.is_empty() {
                "无"
            } else {
                &existing_titles
            },
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system("你是 GEO 内容策略师，只输出 JSON，不输出解释。"),
            ChatMessage::user(prompt),
        ])
        .json();
        let draft: DirectionDrafts = chat_json(
            &self.client().await?,
            &request,
            |value: &DirectionDrafts| {
                if value.items.is_empty() {
                    return Err("items_required".to_string());
                }
                Ok(())
            },
        )
        .await?;
        let now = Utc::now();
        let mut seen: HashSet<String> = existing
            .into_iter()
            .map(|direction| direction.title)
            .collect();
        let mut created = Vec::new();
        for item in draft.items {
            if created.len() >= target {
                break;
            }
            let title = item.title.trim().to_string();
            if title.is_empty() || !seen.insert(title.clone()) {
                continue;
            }
            if !compliance::is_clean(&title) {
                return Err(compliance_violation(&title));
            }
            let direction = ArticleDirection {
                id: uuid::Uuid::new_v4().to_string(),
                project_id,
                title,
                summary: item.summary.trim().to_string(),
                source: ArticleDirectionSource::Generated,
                status: ArticleDirectionStatus::Active,
                created_at: now,
            };
            self.repo().insert_direction(&direction).await?;
            created.push(direction);
        }
        Ok(created)
    }

    // -----------------------------------------------------------------------
    // 模板
    // -----------------------------------------------------------------------

    pub async fn templates(&self, project_id: ProjectId) -> Result<Vec<ArticleTemplate>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.repo().templates(project_id).await?)
    }

    pub async fn save_template(
        &self,
        project_id: ProjectId,
        draft: ArticleTemplateDraft,
        now: DateTime<Utc>,
    ) -> Result<ArticleTemplate, IpcError> {
        self.require_project(project_id).await?;
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(GeoError::validation("template_name", "required").into());
        }
        let prompt = draft.prompt_template.trim();
        if prompt.is_empty() {
            return Err(GeoError::validation("prompt_template", "required").into());
        }
        let direction_id = draft.direction_id.trim();
        let direction = match self.repo().direction(direction_id).await {
            Ok(direction) if direction.project_id == project_id => direction,
            Ok(_) | Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("direction_id", "invalid_id")
                    .with_param("value", direction_id)
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let slots = dedupe_slots(&draft.slots);
        let kb_modules = dedupe_modules(&draft.kb_modules);
        let bindings = clean_bindings(draft.bindings);
        let (id, created_at) = match draft
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => match self.repo().template(id).await {
                Ok(existing) if existing.project_id == project_id => {
                    (existing.id, existing.created_at)
                }
                Ok(_) | Err(StoreError::NotFound { .. }) => {
                    return Err(GeoError::validation("template_id", "invalid_id")
                        .with_param("value", id)
                        .into());
                }
                Err(error) => return Err(error.into()),
            },
            None => (uuid::Uuid::new_v4().to_string(), now),
        };
        let template = ArticleTemplate {
            id,
            project_id,
            direction_id: direction.id,
            name: name.to_string(),
            prompt_template: prompt.to_string(),
            slots,
            bindings,
            kb_modules,
            style: draft.style.trim().to_string(),
            length: clamp_article_length(draft.length),
            created_at,
            updated_at: now,
        };
        self.repo().save_template(&template).await?;
        Ok(template)
    }

    /// 批量删模板（连带排期，保留文章）；返回剩余模板快照。
    pub async fn delete_templates(
        &self,
        project_id: ProjectId,
        ids: Vec<String>,
    ) -> Result<Vec<ArticleTemplate>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.repo().delete_templates(project_id, &ids).await?)
    }

    // -----------------------------------------------------------------------
    // 排期
    // -----------------------------------------------------------------------

    pub async fn schedules(&self, project_id: ProjectId) -> Result<Vec<ArticleSchedule>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.repo().schedules(project_id).await?)
    }

    pub async fn save_schedule(
        &self,
        project_id: ProjectId,
        draft: ArticleScheduleDraft,
        now: DateTime<Utc>,
    ) -> Result<ArticleSchedule, IpcError> {
        self.require_project(project_id).await?;
        let template_id = draft.template_id.trim();
        let template = match self.repo().template(template_id).await {
            Ok(template) if template.project_id == project_id => template,
            Ok(_) | Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("template_id", "invalid_id")
                    .with_param("value", template_id)
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let freq = parse_freq(&draft.freq)?;
        let time = normalize_schedule_time(&draft.time).ok_or_else(|| {
            GeoError::validation("schedule_time", "invalid_format")
                .with_param("value", draft.time.trim())
        })?;
        let weekday = weekday_for(freq, draft.weekday)?;
        let (id, last_run_at, run_count) = match draft
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => match self.repo().schedule(id).await {
                Ok(existing) if existing.project_id == project_id => {
                    (existing.id, existing.last_run_at, existing.run_count)
                }
                Ok(_) | Err(StoreError::NotFound { .. }) => {
                    return Err(GeoError::validation("schedule_id", "invalid_id")
                        .with_param("value", id)
                        .into());
                }
                Err(error) => return Err(error.into()),
            },
            None => (uuid::Uuid::new_v4().to_string(), None, 0),
        };
        let next_run_at = if draft.enabled {
            Some(next_run_at(now, freq, &time, weekday)?)
        } else {
            None
        };
        let schedule = ArticleSchedule {
            id,
            project_id,
            template_id: template.id,
            freq,
            time,
            weekday,
            enabled: draft.enabled,
            next_run_at,
            last_run_at,
            run_count,
        };
        self.repo().save_schedule(&schedule).await?;
        Ok(schedule)
    }

    /// 立即运行一次：给 `schedule_id` 按排期跑，给 `template_id` 只生成（不动排期账）。
    pub async fn run_schedule(
        &self,
        project_id: ProjectId,
        schedule_id: Option<String>,
        template_id: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<Vec<Article>, IpcError> {
        self.require_project(project_id).await?;
        let schedule_id = schedule_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let template_id = template_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if schedule_id.is_none() && template_id.is_none() {
            return Err(GeoError::validation("schedule_id", "required").into());
        }
        let (schedule, wanted_template) = match schedule_id.as_deref() {
            Some(id) => match self.repo().schedule(id).await {
                Ok(schedule) if schedule.project_id == project_id => {
                    let template = schedule.template_id.clone();
                    (Some(schedule), template)
                }
                Ok(_) | Err(StoreError::NotFound { .. }) => {
                    return Err(GeoError::validation("schedule_id", "invalid_id")
                        .with_param("value", id)
                        .into());
                }
                Err(error) => return Err(error.into()),
            },
            None => (None, template_id.unwrap_or_default()),
        };
        let template = match self.repo().template(&wanted_template).await {
            Ok(template) if template.project_id == project_id => template,
            Ok(_) | Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("template_id", "invalid_id")
                    .with_param("value", wanted_template)
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let direction = match self.repo().direction(&template.direction_id).await {
            Ok(direction) if direction.project_id == project_id => direction,
            Ok(_) | Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("direction_id", "invalid_id")
                    .with_param("value", template.direction_id.as_str())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let existing = self.repo().articles(project_id).await?;
        let project = self.projects().get(project_id).await?;
        let competitors = CompetitorRepo::new(self.pool.clone())
            .list_by_project(project_id)
            .await?;
        let competitor_names = competitors
            .iter()
            .map(|competitor| competitor.name.as_str())
            .collect::<Vec<_>>()
            .join("、");
        let product_names = template.bindings.product_names.join("、");
        let keyword_texts = template.bindings.keyword_texts.join("、");
        let rendered = render_prompt(
            &template.prompt_template,
            &[
                (ArticleSlot::Brand, Some(project.brand_name.clone())),
                (ArticleSlot::Product, Some(product_names)),
                (ArticleSlot::Keyword, Some(keyword_texts)),
                (ArticleSlot::Audience, template.bindings.audience.clone()),
                (ArticleSlot::Scenario, Some(direction.summary.clone())),
                (ArticleSlot::Competitor, Some(competitor_names)),
            ],
        );
        let prompt = format!(
            "企业：{brand}；行业：{industry}。\n模板提示词：{rendered}\n\
             文风：{style}；目标字数：{length}。\n\
             只输出 JSON：{{\"title\":\"...\",\"body_markdown\":\"...\"}}；\
             不使用“保证排名/第一/最/100%”等绝对化表述，不编造资质与数据。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            style = if template.style.is_empty() {
                "专业、克制"
            } else {
                &template.style
            },
            length = template.length,
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system("你是 GEO 内容编辑，只输出 JSON，不输出解释。"),
            ChatMessage::user(prompt),
        ])
        .json();
        let draft: ContentDraft =
            chat_json(&self.client().await?, &request, |value: &ContentDraft| {
                if value.title.trim().is_empty() {
                    return Err("title_required".to_string());
                }
                if value.body_markdown.trim().is_empty() {
                    return Err("body_required".to_string());
                }
                Ok(())
            })
            .await?;
        let title = draft.title.trim().to_string();
        let body = draft.body_markdown.trim().to_string();
        for text in [&title, &body] {
            if !compliance::is_clean(text) {
                return Err(compliance_violation(text));
            }
        }
        if existing.iter().any(|article| article.title == title) {
            // 标题重复不产出，但排期照常推进，避免调度器每分钟重试同一篇。
            if let Some(schedule) = schedule {
                let next = if schedule.enabled {
                    Some(next_run_at(
                        now,
                        schedule.freq,
                        &schedule.time,
                        schedule.weekday,
                    )?)
                } else {
                    None
                };
                let updated = ArticleSchedule {
                    last_run_at: Some(now),
                    run_count: schedule.run_count + 1,
                    next_run_at: next,
                    ..schedule
                };
                self.repo().save_schedule(&updated).await?;
            }
            return Ok(Vec::new());
        }
        let word_count = i32::try_from(body.chars().filter(|ch| !ch.is_whitespace()).count())
            .unwrap_or(i32::MAX);
        let article = Article {
            id: uuid::Uuid::new_v4().to_string(),
            project_id,
            direction_id: direction.id,
            template_id: template.id,
            schedule_id: schedule.as_ref().map(|schedule| schedule.id.clone()),
            source: if schedule.is_some() {
                ArticleSource::Scheduled
            } else {
                ArticleSource::Manual
            },
            title,
            body_markdown: body,
            status: ArticleStatus::PendingReview,
            word_count,
            generated_at: now,
        };
        self.repo().insert_article(&article).await?;
        if let Some(schedule) = schedule {
            let next = if schedule.enabled {
                Some(next_run_at(
                    now,
                    schedule.freq,
                    &schedule.time,
                    schedule.weekday,
                )?)
            } else {
                None
            };
            let updated = ArticleSchedule {
                last_run_at: Some(now),
                run_count: schedule.run_count + 1,
                next_run_at: next,
                ..schedule
            };
            self.repo().save_schedule(&updated).await?;
        }
        Ok(vec![article])
    }

    /// 调度器每分钟调用一次：跑所有到点排期，返回本次生成的文章数。
    pub async fn run_due(&self, now: DateTime<Utc>) -> Result<usize, IpcError> {
        let schedules = self.repo().due_schedules(now).await?;
        let mut created = 0;
        for schedule in schedules {
            let project_id = schedule.project_id;
            match self
                .run_schedule(project_id, Some(schedule.id.clone()), None, now)
                .await
            {
                Ok(articles) => created += articles.len(),
                Err(error) => {
                    tracing::warn!(
                        schedule_id = schedule.id.as_str(),
                        code = error.code.as_str(),
                        "scheduled article generation failed"
                    );
                }
            }
        }
        Ok(created)
    }

    // -----------------------------------------------------------------------
    // 文章评审队列
    // -----------------------------------------------------------------------

    pub async fn articles(
        &self,
        project_id: ProjectId,
        query: ArticleListQuery,
    ) -> Result<Vec<Article>, IpcError> {
        self.require_project(project_id).await?;
        if let Some(review) = query.review {
            let status = parse_article_status(&review.status).ok_or_else(|| {
                GeoError::validation("review_status", "not_allowed")
                    .with_param("value", review.status.as_str())
            })?;
            self.repo()
                .review_articles(project_id, &review.ids, status)
                .await?;
        }
        let filter = query.status.as_deref().and_then(parse_article_status);
        let articles = self.repo().articles(project_id).await?;
        Ok(match filter {
            Some(status) => articles
                .into_iter()
                .filter(|article| article.status == status)
                .collect(),
            None => articles,
        })
    }
}

#[derive(Debug, Deserialize)]
struct DirectionDrafts {
    items: Vec<DirectionDraftItem>,
}

#[derive(Debug, Deserialize)]
struct DirectionDraftItem {
    title: String,
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Deserialize)]
struct ContentDraft {
    title: String,
    body_markdown: String,
}

fn parse_direction_status(raw: &str) -> Option<ArticleDirectionStatus> {
    match raw {
        "active" => Some(ArticleDirectionStatus::Active),
        "archived" => Some(ArticleDirectionStatus::Archived),
        _ => None,
    }
}

fn parse_article_status(raw: &str) -> Option<ArticleStatus> {
    match raw {
        "pending_review" => Some(ArticleStatus::PendingReview),
        "approved" => Some(ArticleStatus::Approved),
        "rejected" => Some(ArticleStatus::Rejected),
        _ => None,
    }
}

fn parse_freq(raw: &str) -> Result<ArticleFreq, IpcError> {
    match raw.trim() {
        "daily" => Ok(ArticleFreq::Daily),
        "weekly" => Ok(ArticleFreq::Weekly),
        other => Err(GeoError::validation("schedule_freq", "not_allowed")
            .with_param("value", other)
            .into()),
    }
}

fn weekday_for(freq: ArticleFreq, weekday: Option<i32>) -> Result<Option<i32>, IpcError> {
    if freq == ArticleFreq::Daily {
        return Ok(None);
    }
    let Some(weekday) = weekday else {
        return Err(GeoError::validation("schedule_weekday", "required").into());
    };
    if !(geo_domain::ARTICLE_WEEKDAY_MIN..=geo_domain::ARTICLE_WEEKDAY_MAX).contains(&weekday) {
        return Err(GeoError::validation("schedule_weekday", "out_of_range")
            .with_param("expected", "1~7")
            .with_param("value", weekday)
            .into());
    }
    Ok(Some(weekday))
}

fn dedupe_slots(raw: &[String]) -> Vec<ArticleSlot> {
    let mut seen = HashSet::new();
    raw.iter()
        .filter_map(|value| match value.trim() {
            "brand" => Some(ArticleSlot::Brand),
            "product" => Some(ArticleSlot::Product),
            "keyword" => Some(ArticleSlot::Keyword),
            "audience" => Some(ArticleSlot::Audience),
            "scenario" => Some(ArticleSlot::Scenario),
            "competitor" => Some(ArticleSlot::Competitor),
            _ => None,
        })
        .filter(|slot| seen.insert(*slot))
        .collect()
}

fn dedupe_modules(raw: &[String]) -> Vec<KbModule> {
    let allowed = KbModule::all();
    let mut seen = HashSet::new();
    raw.iter()
        .filter_map(|value| {
            allowed
                .iter()
                .copied()
                .find(|module| module.as_str() == value.trim())
        })
        .filter(|module| seen.insert(module.as_str()))
        .collect()
}

fn clean_bindings(bindings: ArticleTemplateBindings) -> ArticleTemplateBindings {
    let texts = |values: Vec<String>| {
        values
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect()
    };
    ArticleTemplateBindings {
        product_names: texts(bindings.product_names),
        keyword_texts: texts(bindings.keyword_texts),
        audience: bindings
            .audience
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }
}

/// `from` 之后最近的一次 `HH:mm`（weekly 对齐 ISO 星期几），用本地时区算、存 UTC。
fn next_run_at(
    from: DateTime<Utc>,
    freq: ArticleFreq,
    time: &str,
    weekday: Option<i32>,
) -> Result<DateTime<Utc>, IpcError> {
    let (hour, minute) = time
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<u32>().ok()?, minute.parse::<u32>().ok()?)))
        .ok_or_else(|| GeoError::validation("schedule_time", "invalid_format"))?;
    let naive_time = NaiveTime::from_hms_opt(hour, minute, 0)
        .ok_or_else(|| GeoError::validation("schedule_time", "invalid_format"))?;
    let now_local = from.with_timezone(&Local);
    let mut date = now_local.date_naive();
    if freq == ArticleFreq::Weekly {
        let target = weekday.unwrap_or(geo_domain::ARTICLE_WEEKDAY_MIN) - 1;
        let current = i64::from(date.weekday().num_days_from_monday());
        let delta = (i64::from(target) - current + 7) % 7;
        date += Duration::days(delta);
    }
    let mut candidate = date.and_time(naive_time);
    if candidate <= now_local.naive_local() {
        candidate += Duration::days(if freq == ArticleFreq::Weekly { 7 } else { 1 });
    }
    Local
        .from_local_datetime(&candidate)
        .earliest()
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| GeoError::validation("schedule_time", "invalid_format").into())
}
