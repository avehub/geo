//! M1.5 关键词素材库服务（Plan C 第一个纵向切片）。
//!
//! 四条命令：`keyword_list` / `keyword_add` / `keyword_update` / `keyword_delete`。
//! `keyword_generate` 依赖模型与第三方关键词接口，仍在 demo-only 清单里，**这里不伪造**。
//!
//! 纪律：
//! - 校验只在 `geo-domain::keyword`（仓储不重复业务判断）；
//! - 新增**全有或全无**：先把全部草稿校验完再落库；
//! - 更新按 `(id, project_id)` 定位，跨项目 id 视为 `invalid_id`，不允许整行回传改
//!   `source` / `position` / `created_at`。

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    compliance, ContentStatus, GeoError, KeywordDraft, KeywordId, KeywordItem, KeywordKind,
    LibrarySource, ProjectId,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{EntityCardRepo, KeywordRepo, ProjectRepo, SecretStore, SettingsRepo, StoreError};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::{clamp_generate_target, compliance_violation};
use crate::state::{AppState, LlmFactory};

/// `keyword_generate` 的入参（与前端 `KeywordGenerateOptions` 逐字一致）。
#[derive(Debug, Clone, Deserialize)]
pub struct KeywordGenerateOptions {
    pub kinds: Vec<KeywordKind>,
    pub target_count: u16,
}

#[derive(Debug, Deserialize)]
struct KeywordCandidate {
    text: String,
    kind: KeywordKind,
    intent: geo_domain::IntentCategory,
}

#[derive(Debug, Deserialize)]
struct KeywordCandidates {
    items: Vec<KeywordCandidate>,
}

#[derive(Clone)]
pub struct KeywordService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl KeywordService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn keywords(&self) -> KeywordRepo {
        KeywordRepo::new(self.pool.clone())
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

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.keywords().list_by_project(project_id).await?)
    }

    /// 人工录入（可批量）。返回**新增那几条**，顺序与入参一致。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<KeywordDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        if drafts.is_empty() {
            return Err(GeoError::validation("drafts", "required").into());
        }
        // 先整批校验，任一条失败就整批拒绝（半批入库最难走查）。
        for draft in &drafts {
            draft.validate()?;
        }

        let start = self.keywords().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.keywords().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出；保留 `source` / `position` / `created_at`，只改可编辑列。
    pub async fn update(
        &self,
        item: KeywordItem,
        now: DateTime<Utc>,
    ) -> Result<KeywordItem, IpcError> {
        self.require_project(item.project_id).await?;
        let existing = match self.keywords().get(item.id, item.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("keyword_id", "invalid_id")
                    .with_param("value", item.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let merged = KeywordItem {
            id: existing.id,
            project_id: existing.project_id,
            text: item.text.trim().to_string(),
            kind: item.kind,
            intent: item.intent,
            monthly_volume: item.monthly_volume,
            difficulty: item.difficulty,
            priority: item.priority,
            status: item.status,
            note: item
                .note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            source: existing.source,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        merged.validate()?;
        self.keywords().update(&merged).await?;
        Ok(merged)
    }

    /// 批量删除，回**剩余快照**（照 `prompt_item_delete` 的返回形状）。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<KeywordId>,
    ) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        self.keywords().delete_many(project_id, &ids).await?;
        Ok(self.keywords().list_by_project(project_id).await?)
    }
    /// 调模型生成关键词候选（真后端路径）。
    ///
    /// 🔴 月搜索量 / 竞争难度**留空**：这两个指标需要第三方关键词接口，当前未接入，
    /// 不用 0 或模型臆造值冒充（E-52 的剩余部分）。生成物一律 `generated` + `pending_review`。
    pub async fn generate(
        &self,
        project_id: ProjectId,
        options: KeywordGenerateOptions,
        now: DateTime<Utc>,
    ) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        if options.kinds.is_empty() {
            return Err(GeoError::validation("kinds", "required").into());
        }
        let target = usize::from(clamp_generate_target(options.target_count));
        let project = self.projects().get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        let existing = self.keywords().list_by_project(project_id).await?;

        let kinds = options
            .kinds
            .iter()
            .map(|kind| kind.as_str())
            .collect::<Vec<_>>()
            .join(", ");
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
        let existing_texts = existing
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join("、");
        let prompt =
            format!(
            "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}；产品：{products}\n\
             已有词（不要重复）：{existing}\n\
             请生成最多 {target} 条中文关键词，类型只能是：{kinds}。\n\
             要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            region = project.region,
            website = project.website.as_deref().unwrap_or("未填写"),
            products = if products.is_empty() { "未填写" } else { &products },
            existing = if existing_texts.is_empty() { "无" } else { &existing_texts },
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system(
                "你是 GEO 关键词研究员。只输出 JSON，结构为 {\"items\":[{\"text\":\"...\",\"kind\":\"...\",\"intent\":\"...\"}]}。",
            ),
            ChatMessage::user(prompt),
        ])
        .json();
        let candidates: KeywordCandidates = chat_json(
            &self.client().await?,
            &request,
            |value: &KeywordCandidates| {
                for item in &value.items {
                    if item.text.trim().is_empty() {
                        return Err("text_required".to_string());
                    }
                    if !options.kinds.contains(&item.kind) {
                        return Err("kind_not_requested".to_string());
                    }
                }
                Ok(())
            },
        )
        .await?;

        let start = self.keywords().next_position(project_id).await?;
        let mut seen: HashSet<String> = existing.into_iter().map(|item| item.text).collect();
        let mut created = Vec::new();
        for candidate in candidates.items {
            if created.len() >= target {
                break;
            }
            let text = candidate.text.trim().to_string();
            if text.is_empty() || !seen.insert(text.clone()) {
                continue;
            }
            if !compliance::is_clean(&text) {
                return Err(compliance_violation(&text));
            }
            let item = KeywordItem {
                id: KeywordId::new(),
                project_id,
                text,
                kind: candidate.kind,
                intent: candidate.intent,
                monthly_volume: None,
                difficulty: None,
                priority: 3,
                status: ContentStatus::PendingReview,
                note: None,
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
        self.keywords().insert_many(&created).await?;
        Ok(created)
    }
}
