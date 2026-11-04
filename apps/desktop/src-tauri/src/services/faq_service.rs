//! M1.5 FAQ 素材库服务（Plan C 第二个纵向切片）。
//!
//! 四条命令：`faq_list` / `faq_add` / `faq_update` / `faq_delete`。
//! `faq_generate` 需要模型成文 + 合规扫描，仍留在 demo-only 清单，**这里不伪造**。

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    compliance, ContentStatus, FaqDraft, FaqId, FaqItem, GeoError, IntentCategory, LibrarySource,
    ProjectId,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{EntityCardRepo, FaqRepo, ProjectRepo, SecretStore, SettingsRepo, StoreError};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::{clamp_generate_target, compliance_violation};
use crate::state::{AppState, LlmFactory};

/// `faq_generate` 的入参（与前端 `FaqGenerateOptions` 逐字一致）。
#[derive(Debug, Clone, Deserialize)]
pub struct FaqGenerateOptions {
    pub intents: Vec<IntentCategory>,
    pub target_count: u16,
}

#[derive(Debug, Deserialize)]
struct FaqCandidate {
    question: String,
    answer_markdown: String,
    #[serde(default)]
    category: Option<String>,
    intent: IntentCategory,
}

#[derive(Debug, Deserialize)]
struct FaqCandidates {
    items: Vec<FaqCandidate>,
}

#[derive(Clone)]
pub struct FaqService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl FaqService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn faqs(&self) -> FaqRepo {
        FaqRepo::new(self.pool.clone())
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

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.faqs().list_by_project(project_id).await?)
    }

    /// 人工录入（可批量）。先整批校验，任一条失败就整批拒绝。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<FaqDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        if drafts.is_empty() {
            return Err(GeoError::validation("drafts", "required").into());
        }
        for draft in &drafts {
            draft.validate()?;
        }

        let start = self.faqs().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.faqs().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出；保留 `source` / `position` / `created_at`。
    pub async fn update(&self, item: FaqItem, now: DateTime<Utc>) -> Result<FaqItem, IpcError> {
        self.require_project(item.project_id).await?;
        let existing = match self.faqs().get(item.id, item.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("faq_id", "invalid_id")
                    .with_param("value", item.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let merged = FaqItem {
            id: existing.id,
            project_id: existing.project_id,
            question: item.question.trim().to_string(),
            answer_markdown: item.answer_markdown.trim().to_string(),
            category: item
                .category
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            intent: item.intent,
            status: item.status,
            source: existing.source,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        merged.validate()?;
        self.faqs().update(&merged).await?;
        Ok(merged)
    }

    /// 批量删除，回剩余快照（幂等；允许删空）。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<FaqId>,
    ) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        self.faqs().delete_many(project_id, &ids).await?;
        Ok(self.faqs().list_by_project(project_id).await?)
    }
    /// 调模型按意图成文（真后端路径），并在入库前跑广告法红线扫描。
    ///
    /// 生成物一律 `generated` + `pending_review`（规则 6）；命中红线词整批拒绝，
    /// 不做静默改写。问题与库里已有条目完全相同时跳过（等值判断）。
    pub async fn generate(
        &self,
        project_id: ProjectId,
        options: FaqGenerateOptions,
        now: DateTime<Utc>,
    ) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        if options.intents.is_empty() {
            return Err(GeoError::validation("intents", "required").into());
        }
        let target = usize::from(clamp_generate_target(options.target_count));
        let project = self.projects().get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        let existing = self.faqs().list_by_project(project_id).await?;

        let intents = options
            .intents
            .iter()
            .map(|intent| intent.label_zh())
            .collect::<Vec<_>>()
            .join("、");
        let products = card
            .as_ref()
            .map(|card| {
                card.fields
                    .products
                    .iter()
                    .map(|product| product.name.clone())
                    .collect::<Vec<_>>()
                    .join("、")
            })
            .unwrap_or_default();
        let existing_questions = existing
            .iter()
            .map(|item| item.question.as_str())
            .collect::<Vec<_>>()
            .join("、");
        let prompt =
            format!(
            "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}；产品：{products}\n\
             已有问题（不要重复）：{existing}\n\
             请生成最多 {target} 条中文 FAQ，意图覆盖：{intents}。\n\
             问题要像真实用户会问的；答案给可核验的事实与步骤，可用 Markdown 列表。\n\
             要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            region = project.region,
            website = project.website.as_deref().unwrap_or("未填写"),
            products = if products.is_empty() { "未填写" } else { &products },
            existing = if existing_questions.is_empty() { "无" } else { &existing_questions },
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system(
                "你是 GEO 内容编辑。只输出 JSON，结构为 {\"items\":[{\"question\":\"...\",\"answer_markdown\":\"...\",\"category\":\"...\",\"intent\":\"...\"}]}。",
            ),
            ChatMessage::user(prompt),
        ])
        .json();
        let candidates: FaqCandidates =
            chat_json(&self.client().await?, &request, |value: &FaqCandidates| {
                for item in &value.items {
                    if item.question.trim().is_empty() {
                        return Err("question_required".to_string());
                    }
                    if item.answer_markdown.trim().is_empty() {
                        return Err("answer_required".to_string());
                    }
                    if !options.intents.contains(&item.intent) {
                        return Err("intent_not_requested".to_string());
                    }
                }
                Ok(())
            })
            .await?;

        let start = self.faqs().next_position(project_id).await?;
        let mut seen: HashSet<String> = existing.into_iter().map(|item| item.question).collect();
        let mut created = Vec::new();
        for candidate in candidates.items {
            if created.len() >= target {
                break;
            }
            let question = candidate.question.trim().to_string();
            if question.is_empty() || !seen.insert(question.clone()) {
                continue;
            }
            let answer = candidate.answer_markdown.trim().to_string();
            if !compliance::is_clean(&question) {
                return Err(compliance_violation(&question));
            }
            if !compliance::is_clean(&answer) {
                return Err(compliance_violation(&answer));
            }
            let item = FaqItem {
                id: FaqId::new(),
                project_id,
                question,
                answer_markdown: answer,
                category: candidate
                    .category
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                intent: candidate.intent,
                status: ContentStatus::PendingReview,
                source: LibrarySource::Generated,
                position: start + i32::try_from(created.len()).unwrap_or(0),
                created_at: now,
                updated_at: now,
            };
            item.validate()?;
            created.push(item);
        }
        if created.is_empty() {
            return Ok(Vec::new());
        }
        self.faqs().insert_many(&created).await?;
        Ok(created)
    }
}
