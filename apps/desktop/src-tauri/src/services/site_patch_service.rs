//! 站点补丁台账服务（M6.5，Plan C 第四切片第二段）。
//!
//! 六条命令：`site_patch_add` / `site_patch_generate` / `site_patch_save` /
//! `site_patch_transition` / `site_patch_history` / `site_patch_delete`。
//!
//! 🔴 手动新建（`add`）仍拒绝 `action_id`（否则会写出指向不存在处方的悬空链接）；
//! `site_patch_generate` 从行动看板读取处方并补 `action_id` / `round_id`。

use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    compliance, ActionBoard, ContentStatus, GeoError, LibrarySource, ProjectId, SiteChannelKind,
    SitePatch, SitePatchDraft, SitePatchEvent, SitePatchEventId, SitePatchEventKind, SitePatchId,
    SitePatchKind, SitePatchStatus, SitePatchTransition,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{
    DiagnosisRepo, EntityCardRepo, ProjectRepo, SecretStore, SettingsRepo, SitePatchRepo, SiteRepo,
    StoreError,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::compliance_violation;
use crate::state::{AppState, LlmFactory};

#[derive(Clone)]
pub struct SitePatchService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl SitePatchService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
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

    fn patches(&self) -> SitePatchRepo {
        SitePatchRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<SitePatch>, IpcError> {
        Ok(self.patches().list_by_project(project_id).await?)
    }

    /// 手动新建：`status = draft`、`review_status = approved`、`source = manual`。
    pub async fn add(
        &self,
        project_id: ProjectId,
        draft: SitePatchDraft,
        now: DateTime<Utc>,
    ) -> Result<SitePatch, IpcError> {
        self.require_project(project_id).await?;
        if draft.action_id.is_some() {
            return Err(GeoError::validation("action_id", "not_allowed").into());
        }
        draft.validate()?;
        let position = self.patches().next_position(project_id).await?;
        let patch = draft.into_patch(project_id, position, now)?;
        let event = SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: patch.id,
            kind: SitePatchEventKind::Created,
            channel_kind: None,
            note: None,
            created_at: now,
        };
        self.patches().insert_with_event(&patch, &event).await?;
        Ok(patch)
    }

    /// 按处方生成补丁草案：调模型写正文，全部落 `draft` + `pending_review` + `source=generated`。
    ///
    /// - 只接受行动看板里**本项目**的处方；
    /// - 与已有补丁 `(action_id, kind, target_url)` 重复的条目跳过（幂等）；
    /// - 命中广告法红线整批拒绝（`compliance/violation`）。
    pub async fn generate(
        &self,
        project_id: ProjectId,
        action_id: String,
        kinds: Vec<SitePatchKind>,
        now: DateTime<Utc>,
    ) -> Result<Vec<SitePatch>, IpcError> {
        self.require_project(project_id).await?;
        if kinds.is_empty() {
            return Err(GeoError::validation("kinds", "empty").into());
        }
        let board = self.action_board(project_id).await?;
        let action = board
            .actions
            .iter()
            .find(|action| action.id == action_id)
            .cloned()
            .ok_or_else(|| {
                GeoError::validation("action_id", "invalid_id")
                    .with_param("value", action_id.as_str())
            })?;
        let project = self.projects().get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
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
        let profile = SiteRepo::new(self.pool.clone()).profile(project_id).await?;
        let platform = profile
            .as_ref()
            .map(|profile| profile.platform.as_str().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let kinds_text = kinds
            .iter()
            .map(|kind| kind.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let prompt = format!(
            "企业：{brand}；行业：{industry}；官网：{website}；产品：{products}\n\
             站点平台：{platform}\n\
             处方：{title}；依据：{rationale}；交付物：{deliverable}\n\
             请生成以下类型的站点补丁草案：{kinds_text}。\n\
             要求：只输出 JSON，结构为 {{\"items\":[{{\"kind\":\"...\",\"title\":\"...\",\
             \"target_url\":\"/path\",\"target_hint\":null,\"body\":\"...\"}}]}}；\
             kind 只能取给定值；不要编造资质；不使用“保证排名/第一/最/100%”等绝对化表述。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            website = project.website.as_deref().unwrap_or("未填写"),
            products = if products.is_empty() {
                "未填写"
            } else {
                &products
            },
            title = action.title,
            rationale = action.rationale,
            deliverable = action.deliverable,
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system("你是 GEO 站点工程师，只输出 JSON，不输出解释。"),
            ChatMessage::user(prompt),
        ])
        .json();
        let drafts: PatchDrafts =
            chat_json(&self.client().await?, &request, |value: &PatchDrafts| {
                if value.items.is_empty() {
                    return Err("items_required".to_string());
                }
                Ok(())
            })
            .await?;

        let existing = self.patches().list_by_project(project_id).await?;
        let mut position = self.patches().next_position(project_id).await?;
        let mut created = Vec::new();
        for draft in drafts.items {
            if !kinds.contains(&draft.kind) {
                continue;
            }
            if draft.title.trim().is_empty()
                || draft.target_url.trim().is_empty()
                || draft.body.trim().is_empty()
            {
                continue;
            }
            let duplicated = existing
                .iter()
                .chain(created.iter())
                .any(|patch: &SitePatch| {
                    patch.action_id.as_deref() == Some(action.id.as_str())
                        && patch.kind == draft.kind
                        && patch.target_url == draft.target_url.trim()
                });
            if duplicated {
                continue;
            }
            for text in [&draft.title, &draft.body] {
                if !compliance::is_clean(text) {
                    return Err(compliance_violation(text));
                }
            }
            let patch = SitePatch {
                id: SitePatchId::new(),
                project_id,
                action_id: Some(action.id.clone()),
                round_id: action.round_id.clone(),
                kind: draft.kind,
                title: draft.title.trim().to_string(),
                target_url: draft.target_url.trim().to_string(),
                target_hint: draft
                    .target_hint
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                body: draft.body.trim().to_string(),
                published_body: None,
                published_kind: None,
                published_target_url: None,
                published_channel_kind: None,
                status: SitePatchStatus::Draft,
                review_status: ContentStatus::PendingReview,
                channel_kind: channel_for(draft.kind),
                source: LibrarySource::Generated,
                position,
                published_at: None,
                created_at: now,
                updated_at: now,
            };
            patch.validate()?;
            let event = SitePatchEvent {
                id: SitePatchEventId::new(),
                patch_id: patch.id,
                kind: SitePatchEventKind::Created,
                channel_kind: None,
                note: None,
                created_at: now,
            };
            self.patches().insert_with_event(&patch, &event).await?;
            position += 1;
            created.push(patch);
        }
        Ok(created)
    }

    async fn action_board(&self, project_id: ProjectId) -> Result<ActionBoard, IpcError> {
        let payload = DiagnosisRepo::new(self.pool.clone())
            .action_board(&project_id.to_string())
            .await?;
        match payload {
            Some(payload) => Ok(serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?),
            None => Ok(ActionBoard {
                actions: Vec::new(),
                attribution: Vec::new(),
                contents: Vec::new(),
                templates: Vec::new(),
            }),
        }
    }

    /// 就地改草案。`status` / `published_*` / `source` / `position` / `action_id` /
    /// `round_id` / `created_at` 保留库里的值。
    pub async fn save(&self, patch: SitePatch, now: DateTime<Utc>) -> Result<SitePatch, IpcError> {
        let existing = match self.patches().get(patch.id).await {
            Ok(existing) if existing.project_id == patch.project_id => existing,
            Ok(_) | Err(geo_store::StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let next = SitePatch {
            id: existing.id,
            project_id: existing.project_id,
            action_id: existing.action_id,
            round_id: existing.round_id,
            kind: patch.kind,
            title: patch.title.trim().to_string(),
            target_url: patch.target_url.trim().to_string(),
            target_hint: patch
                .target_hint
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            body: patch.body,
            published_body: existing.published_body,
            published_kind: existing.published_kind,
            published_target_url: existing.published_target_url,
            published_channel_kind: existing.published_channel_kind,
            status: existing.status,
            review_status: patch.review_status,
            channel_kind: patch.channel_kind,
            source: existing.source,
            position: existing.position,
            published_at: existing.published_at,
            created_at: existing.created_at,
            updated_at: now,
        };
        next.validate()?;
        let event = SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: next.id,
            kind: SitePatchEventKind::Saved,
            channel_kind: None,
            note: None,
            created_at: now,
        };
        self.patches().save_with_event(&next, &event).await?;
        Ok(next)
    }

    /// 发布 / 撤回 / 回滚。三个动作都是全函数，非法跃迁不存在。
    pub async fn transition(
        &self,
        patch_id: SitePatchId,
        transition: SitePatchTransition,
        now: DateTime<Utc>,
    ) -> Result<SitePatch, IpcError> {
        let mut patch = match self.patches().get(patch_id).await {
            Ok(patch) => patch,
            Err(geo_store::StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch_id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let event = match transition {
            SitePatchTransition::Publish => Some(patch.publish(now)?),
            SitePatchTransition::Unpublish => patch.unpublish(now),
            SitePatchTransition::Rollback => patch.rollback(now),
        };
        self.patches().transition(&patch, event.as_ref()).await?;
        Ok(patch)
    }

    pub async fn history(&self, patch_id: SitePatchId) -> Result<Vec<SitePatchEvent>, IpcError> {
        match self.patches().get(patch_id).await {
            Ok(_) => Ok(self.patches().events(patch_id).await?),
            Err(geo_store::StoreError::NotFound { .. }) => {
                Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch_id.to_string())
                    .into())
            }
            Err(error) => Err(error.into()),
        }
    }

    /// 批量删除。已发布的补丁拒绝硬删（要求先 `unpublish`），整批原子。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<SitePatchId>,
    ) -> Result<Vec<SitePatch>, IpcError> {
        self.require_project(project_id).await?;
        let wanted: std::collections::HashSet<String> =
            ids.iter().map(|id| id.to_string()).collect();
        let doomed: Vec<SitePatch> = self
            .patches()
            .list_by_project(project_id)
            .await?
            .into_iter()
            .filter(|patch| wanted.contains(&patch.id.to_string()))
            .collect();
        if doomed
            .iter()
            .any(|patch| patch.status == SitePatchStatus::Published)
        {
            return Err(IpcError::with_params(
                "state/conflict",
                [("reason", "not_allowed"), ("value", "published")],
            ));
        }
        self.patches().delete_many(project_id, &ids).await?;
        Ok(self.patches().list_by_project(project_id).await?)
    }
}

#[derive(Debug, Deserialize)]
struct PatchDrafts {
    items: Vec<PatchDraftItem>,
}

#[derive(Debug, Deserialize)]
struct PatchDraftItem {
    kind: SitePatchKind,
    title: String,
    target_url: String,
    #[serde(default)]
    target_hint: Option<String>,
    body: String,
}

/// 补丁类型 → 下发通道的稳定映射（不让模型猜通道）。
fn channel_for(kind: SitePatchKind) -> SiteChannelKind {
    match kind {
        SitePatchKind::LlmsTxt | SitePatchKind::RobotsTxt => SiteChannelKind::Bundle,
        _ => SiteChannelKind::Cms,
    }
}
