//! M6 行动中心读路径服务（Plan C M3–M7 读路径）。
//!
//! 看板按项目整份读出；没有快照时回空数组，而不是报错。

use std::sync::Arc;

use chrono::Utc;
use geo_domain::{
    compliance, content_template, content_templates, ActionBoard, ActionItem, ActionStatus,
    ContentStatus, GeneratedContent, GeoError, ProjectId,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{
    DiagnosisRepo, EntityCardRepo, ProjectRepo, SecretStore, SettingsRepo, StoreError,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::services::compliance_violation;
use crate::state::{AppState, LlmFactory};

#[derive(Clone)]
pub struct ActionService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl ActionService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
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

    pub async fn board(&self, project_id: ProjectId) -> Result<ActionBoard, IpcError> {
        let mut board = self.load_board(project_id).await?;
        // 模板是内置目录，不是项目数据：库里那份可能是旧快照，读的时候统一覆盖。
        board.templates = content_templates();
        Ok(board)
    }

    async fn load_board(&self, project_id: ProjectId) -> Result<ActionBoard, IpcError> {
        self.projects().get(project_id).await?;
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

    /// 按模板生成一份文稿：调模型写 Markdown，跑广告法红线扫描，产物恒 `pending_review`。
    pub async fn generate_content(
        &self,
        project_id: ProjectId,
        template_id: String,
        action_id: Option<String>,
    ) -> Result<GeneratedContent, IpcError> {
        let mut board = self.load_board(project_id).await?;
        let template = content_template(&template_id).ok_or_else(|| {
            GeoError::validation("template_id", "invalid_id")
                .with_param("value", template_id.as_str())
        })?;
        let action = match action_id.as_deref() {
            Some(id) => Some(
                board
                    .actions
                    .iter()
                    .find(|action| action.id == id)
                    .cloned()
                    .ok_or_else(|| {
                        GeoError::validation("action_id", "invalid_id").with_param("value", id)
                    })?,
            ),
            None => None,
        };
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
        let action_line = action
            .as_ref()
            .map(|action| {
                format!(
                    "处方：{}；依据：{}；交付物：{}",
                    action.title, action.rationale, action.deliverable
                )
            })
            .unwrap_or_else(|| "没有关联处方，按模板直接成文。".to_string());
        let sections = template.section_keys.join(" / ");
        let prompt = format!(
            "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}；产品：{products}\n\
             {action_line}\n\
             模板：{kind}；章节（按此顺序，每节用二级标题）：{sections}。\n\
             要求：只使用给定信息，不编造资质与数据；不使用“保证排名/第一/最/100%”等绝对化表述；\
             正文 800~1500 字；只输出 JSON，结构为 {{\"title\":\"...\",\"body_markdown\":\"...\"}}。",
            brand = project.brand_name,
            industry = project.industry.label_zh(),
            region = project.region,
            website = project.website.as_deref().unwrap_or("未填写"),
            products = if products.is_empty() { "未填写" } else { &products },
            kind = template.kind.as_str(),
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
        let now = Utc::now();
        let content = GeneratedContent {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            action_id: action_id.clone(),
            template_id: template.id.clone(),
            title,
            body_markdown: body,
            status: ContentStatus::PendingReview,
            // 真后端确实跑过红线词扫描（不是"没扫就写 true"）。
            compliance_checked: true,
            export_formats: template.export_formats.clone(),
            created_at: now,
            updated_at: now,
        };
        board.contents.push(content.clone());
        self.save_board(&project_id.to_string(), &board).await?;
        Ok(content)
    }
    /// 翻处方状态：`done` 首次完成时盖 `completed_at`，回退时清掉；`updated_at` 每次刷新。
    pub async fn update_action_status(
        &self,
        action_id: String,
        status: ActionStatus,
    ) -> Result<ActionItem, IpcError> {
        let now = Utc::now();
        for (project_id, payload) in self.boards().all_action_boards().await? {
            let mut board: ActionBoard = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            if let Some(index) = board
                .actions
                .iter()
                .position(|action| action.id == action_id)
            {
                let action = &mut board.actions[index];
                action.status = status;
                if status == ActionStatus::Done {
                    if action.completed_at.is_none() {
                        action.completed_at = Some(now);
                    }
                } else {
                    action.completed_at = None;
                }
                action.updated_at = now;
                let updated = action.clone();
                self.save_board(&project_id, &board).await?;
                return Ok(updated);
            }
        }
        Err(GeoError::validation("action_id", "invalid_id")
            .with_param("value", action_id)
            .into())
    }

    /// 人工审核一份文稿：只翻状态与 `updated_at`。
    pub async fn update_content_status(
        &self,
        content_id: String,
        status: ContentStatus,
    ) -> Result<GeneratedContent, IpcError> {
        let now = Utc::now();
        for (project_id, payload) in self.boards().all_action_boards().await? {
            let mut board: ActionBoard = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            if let Some(index) = board
                .contents
                .iter()
                .position(|content| content.id == content_id)
            {
                let content = &mut board.contents[index];
                content.status = status;
                content.updated_at = now;
                let updated = content.clone();
                self.save_board(&project_id, &board).await?;
                return Ok(updated);
            }
        }
        Err(GeoError::validation("content_id", "invalid_id")
            .with_param("value", content_id)
            .into())
    }

    fn boards(&self) -> DiagnosisRepo {
        DiagnosisRepo::new(self.pool.clone())
    }

    async fn save_board(&self, project_id: &str, board: &ActionBoard) -> Result<(), IpcError> {
        let payload = serde_json::to_string(board)
            .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
        self.boards()
            .save_action_board(project_id, &payload, &Utc::now().to_rfc3339())
            .await?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct ContentDraft {
    title: String,
    body_markdown: String,
}
