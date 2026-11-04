//! M1.2b 知识库服务（Plan C 第三个纵向切片）。
//!
//! 六条命令：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` /
//! `kb_entry_verify` / `kb_generate`。
//!
//! 纪律：校验只在 `geo-domain::kb`；`update` 逐字段 diff 写留痕；`verify` 只改
//! `status` / `verified_at` / `updated_at` 并记一条 `verified_at` 留痕；删除不删留痕；
//! 生成产物一律 `generated` + `pending_review`，并跑广告法红线扫描。

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    compliance, ContentStatus, GeoError, KbEntry, KbEntryDraft, KbEntryKind, KbEntryRevision,
    KbModule, KbScenario, KbSource, KbStats, ProjectId,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{EntityCardRepo, KbRepo, ProjectRepo, SecretStore, SettingsRepo, StoreError};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::{clamp_generate_target, compliance_violation};
use crate::state::{AppState, LlmFactory};

/// `kb_board` 的聚合返回，形状与前端 `KbBoard` 逐字一致。
#[derive(Debug, Clone, Serialize)]
pub struct KbBoard {
    pub project_id: ProjectId,
    pub entries: Vec<KbEntry>,
    pub stats: KbStats,
    pub project_updated_at: DateTime<Utc>,
    pub revisions: Vec<KbEntryRevision>,
}

/// `kb_generate` 的入参（与前端 `KbGenerateOptions` 逐字一致）。
#[derive(Debug, Clone, Deserialize)]
pub struct KbGenerateOptions {
    pub modules: Vec<KbModule>,
    pub target_count: u16,
}

#[derive(Debug, Deserialize)]
struct KbCandidate {
    module: KbModule,
    kind: KbEntryKind,
    title: String,
    #[serde(default)]
    body_markdown: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    mime: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    scenario: Option<KbScenario>,
}

#[derive(Debug, Deserialize)]
struct KbCandidates {
    items: Vec<KbCandidate>,
}

#[derive(Clone)]
pub struct KbService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl KbService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn entries(&self) -> KbRepo {
        KbRepo::new(self.pool.clone())
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

    async fn require_project(
        &self,
        project_id: ProjectId,
    ) -> Result<geo_domain::Project, IpcError> {
        Ok(self.projects().get(project_id).await?)
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<KbBoard, IpcError> {
        let project = self.require_project(project_id).await?;
        let entries = self.entries().list_by_project(project_id).await?;
        let stats = KbStats::from_entries(&entries);
        let revisions = self.entries().revisions_by_project(project_id).await?;
        Ok(KbBoard {
            project_id,
            entries,
            stats,
            project_updated_at: project.updated_at,
            revisions,
        })
    }

    /// 手动录入 / 导入（可批量）。先整批校验标题，再落库。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<KbEntryDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        for draft in &drafts {
            draft.validate()?;
        }
        if drafts.is_empty() {
            return Ok(Vec::new());
        }

        let start = self.entries().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.entries().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出：`source` / `position` / `created_at` / `verified_at` 保留库里的值。
    pub async fn update(&self, entry: KbEntry, now: DateTime<Utc>) -> Result<KbEntry, IpcError> {
        self.require_project(entry.project_id).await?;
        let existing = match self.entries().get(entry.id, entry.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("kb_entry_id", "invalid_id")
                    .with_param("value", entry.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let next = KbEntry {
            id: existing.id,
            project_id: existing.project_id,
            module: entry.module,
            kind: entry.kind,
            title: entry.title.trim().to_string(),
            body_markdown: entry.body_markdown,
            url: entry
                .url
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            mime: entry
                .mime
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            tags: entry
                .tags
                .into_iter()
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .collect(),
            status: entry.status,
            source: existing.source,
            scenario: if entry.module.is_script() {
                entry.scenario
            } else {
                None
            },
            verified_at: existing.verified_at,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        next.validate()?;
        let revisions = KbEntry::diff_revisions(&existing, &next, now);
        self.entries()
            .update_with_revisions(&next, &revisions)
            .await?;
        Ok(next)
    }

    /// 批量删除，回剩余快照；`position` 由仓储重排为 `0..n-1`。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<geo_domain::KbEntryId>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        self.entries().delete_many(project_id, &ids).await?;
        Ok(self.entries().list_by_project(project_id).await?)
    }

    /// 批量核实：`status → approved` + `verified_at → now`，每条记一条留痕。
    pub async fn verify(
        &self,
        project_id: ProjectId,
        ids: Vec<geo_domain::KbEntryId>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        self.entries().verify_many(project_id, &ids, now).await?;
        Ok(self.entries().list_by_project(project_id).await?)
    }

    /// 调模型按模块生成知识条目，入库前跑广告法红线扫描。
    ///
    /// 产物一律 `generated` + `pending_review` + 未核实；标题等值去重；不留修订痕（不是修订）。
    pub async fn generate(
        &self,
        project_id: ProjectId,
        options: KbGenerateOptions,
        now: DateTime<Utc>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        if options.modules.is_empty() {
            return Err(GeoError::validation("kb_modules", "required").into());
        }
        let target = usize::from(clamp_generate_target(options.target_count));
        let project = self.projects().get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        let existing = self.entries().list_by_project(project_id).await?;

        let modules = options
            .modules
            .iter()
            .map(|module| module.as_str())
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
        let existing_titles = existing
            .iter()
            .map(|entry| entry.title.as_str())
            .collect::<Vec<_>>()
            .join("、");
        let prompt =
            format!(
            "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}；产品：{products}\n\
             已有标题（不要重复）：{existing}\n\
             请生成最多 {target} 条知识条目，模块只能是：{modules}。\n\
             每条给出 module、kind（statement/text/link/image/video/file）、title、body_markdown，\
             可选 url、mime、tags；scenario 只允许用在 sales_script / support_script。\n\
             要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            region = project.region,
            website = project.website.as_deref().unwrap_or("未填写"),
            products = if products.is_empty() { "未填写" } else { &products },
            existing = if existing_titles.is_empty() { "无" } else { &existing_titles },
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system(
                "你是 GEO 知识库编辑。只输出 JSON，结构为 {\"items\":[{\"module\":\"...\",\"kind\":\"...\",\"title\":\"...\",\"body_markdown\":\"...\",\"scenario\":null}]}。",
            ),
            ChatMessage::user(prompt),
        ])
        .json();
        let candidates: KbCandidates =
            chat_json(&self.client().await?, &request, |value: &KbCandidates| {
                for item in &value.items {
                    if item.title.trim().is_empty() {
                        return Err("title_required".to_string());
                    }
                    if !options.modules.contains(&item.module) {
                        return Err("module_not_requested".to_string());
                    }
                }
                Ok(())
            })
            .await?;

        let start = self.entries().next_position(project_id).await?;
        let mut seen: HashSet<String> = existing.into_iter().map(|entry| entry.title).collect();
        let mut created = Vec::new();
        for candidate in candidates.items {
            if created.len() >= target {
                break;
            }
            let title = candidate.title.trim().to_string();
            if title.is_empty() || !seen.insert(title.clone()) {
                continue;
            }
            if !compliance::is_clean(&title) {
                return Err(compliance_violation(&title));
            }
            if !compliance::is_clean(&candidate.body_markdown) {
                return Err(compliance_violation(&candidate.body_markdown));
            }
            let scenario = if candidate.module.is_script() {
                candidate.scenario
            } else {
                None
            };
            let entry = KbEntry {
                id: geo_domain::KbEntryId::new(),
                project_id,
                module: candidate.module,
                kind: candidate.kind,
                title,
                body_markdown: candidate.body_markdown,
                url: candidate
                    .url
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                mime: candidate
                    .mime
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                tags: candidate
                    .tags
                    .into_iter()
                    .map(|tag| tag.trim().to_string())
                    .filter(|tag| !tag.is_empty())
                    .collect(),
                status: ContentStatus::PendingReview,
                source: KbSource::Generated,
                scenario,
                verified_at: None,
                position: start + i32::try_from(created.len()).unwrap_or(0),
                created_at: now,
                updated_at: now,
            };
            entry.validate()?;
            created.push(entry);
        }
        if created.is_empty() {
            return Ok(Vec::new());
        }
        self.entries().insert_many(&created).await?;
        Ok(created)
    }
}
