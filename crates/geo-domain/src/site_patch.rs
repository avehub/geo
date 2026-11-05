//! 站点补丁台账模型与三态状态机（M6.5，Plan C 第四切片第二段）。
//!
//! 设计规格：`docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`
//! （DR-47 / DR-51 / DR-56）。
//!
//! 🔴 本模块只做**模型、校验与状态迁移**：不调模型、不真下发、不算收益。
//! `publish` 只翻状态 + 盖快照 + 记事件；线上站点一个字节都不会变。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::compliance::ContentStatus;
use crate::error::GeoError;
use crate::ids::{ProjectId, SitePatchEventId, SitePatchId};
use crate::keyword::LibrarySource;
use crate::site::SiteChannelKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePatchKind {
    LlmsTxt,
    RobotsTxt,
    Jsonld,
    HtmlFragment,
    MetaTitle,
    MetaDescription,
    Canonical,
    AltText,
    InternalLink,
    EntityConsistency,
}

impl SitePatchKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LlmsTxt => "llms_txt",
            Self::RobotsTxt => "robots_txt",
            Self::Jsonld => "jsonld",
            Self::HtmlFragment => "html_fragment",
            Self::MetaTitle => "meta_title",
            Self::MetaDescription => "meta_description",
            Self::Canonical => "canonical",
            Self::AltText => "alt_text",
            Self::InternalLink => "internal_link",
            Self::EntityConsistency => "entity_consistency",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePatchStatus {
    Draft,
    Published,
    Unpublished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePatchTransition {
    Publish,
    Unpublish,
    Rollback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePatchEventKind {
    Created,
    Saved,
    Published,
    Unpublished,
    RolledBack,
    Exported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SitePatch {
    pub id: SitePatchId,
    pub project_id: ProjectId,
    pub action_id: Option<String>,
    /// 行动中心的轮次 id；行动族尚未落 Rust 时为空串（归因链待补）。
    pub round_id: String,
    pub kind: SitePatchKind,
    pub title: String,
    pub target_url: String,
    pub target_hint: Option<String>,
    pub body: String,
    pub published_body: Option<String>,
    pub published_kind: Option<SitePatchKind>,
    pub published_target_url: Option<String>,
    pub published_channel_kind: Option<SiteChannelKind>,
    pub status: SitePatchStatus,
    pub review_status: ContentStatus,
    pub channel_kind: SiteChannelKind,
    pub source: LibrarySource,
    pub position: i32,
    pub published_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SitePatchEvent {
    pub id: SitePatchEventId,
    pub patch_id: SitePatchId,
    pub kind: SitePatchEventKind,
    pub channel_kind: Option<SiteChannelKind>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SitePatchDraft {
    pub kind: SitePatchKind,
    pub title: String,
    pub target_url: String,
    #[serde(default)]
    pub target_hint: Option<String>,
    pub body: String,
    pub channel_kind: SiteChannelKind,
    #[serde(default)]
    pub action_id: Option<String>,
}

fn require_text(field: &str, value: &str) -> Result<(), GeoError> {
    if value.trim().is_empty() {
        return Err(GeoError::validation(field, "required"));
    }
    Ok(())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn event(
    patch: &SitePatch,
    kind: SitePatchEventKind,
    channel_kind: Option<SiteChannelKind>,
    at: DateTime<Utc>,
) -> SitePatchEvent {
    SitePatchEvent {
        id: SitePatchEventId::new(),
        patch_id: patch.id,
        kind,
        channel_kind,
        note: None,
        created_at: at,
    }
}

impl SitePatch {
    pub fn validate(&self) -> Result<(), GeoError> {
        require_text("patch_title", &self.title)?;
        require_text("patch_target_url", &self.target_url)?;
        require_text("patch_body", &self.body)
    }

    /// `publish`：必须已人工审核通过；盖完整发布快照并记事件。
    pub fn publish(&mut self, at: DateTime<Utc>) -> Result<SitePatchEvent, GeoError> {
        if self.review_status != ContentStatus::Approved {
            return Err(GeoError::validation("review_status", "not_allowed")
                .with_param("value", format!("{:?}", self.review_status).to_lowercase()));
        }
        self.status = SitePatchStatus::Published;
        self.published_body = Some(self.body.clone());
        self.published_kind = Some(self.kind);
        self.published_target_url = Some(self.target_url.clone());
        self.published_channel_kind = Some(self.channel_kind);
        self.published_at = Some(at);
        self.updated_at = at;
        Ok(event(
            self,
            SitePatchEventKind::Published,
            Some(self.channel_kind),
            at,
        ))
    }

    /// `unpublish`：已经是 `unpublished` 就原样返回、不记事件；保留发布快照供回滚。
    pub fn unpublish(&mut self, at: DateTime<Utc>) -> Option<SitePatchEvent> {
        if self.status == SitePatchStatus::Unpublished {
            return None;
        }
        self.status = SitePatchStatus::Unpublished;
        self.published_at = None;
        self.updated_at = at;
        Some(event(
            self,
            SitePatchEventKind::Unpublished,
            Some(self.channel_kind),
            at,
        ))
    }

    /// `rollback`：把草案恢复成上一次发布快照；没有落点或已经一致就什么都不做。
    /// 🔴 不动 `status`：回滚的是草案，不是替用户撤回线上版本。
    pub fn rollback(&mut self, at: DateTime<Utc>) -> Option<SitePatchEvent> {
        let snapshot = self.published_body.as_ref()?;
        if self.body == *snapshot {
            return None;
        }
        self.body = snapshot.clone();
        if let Some(kind) = self.published_kind {
            self.kind = kind;
        }
        if let Some(target) = &self.published_target_url {
            self.target_url = target.clone();
        }
        if let Some(channel) = self.published_channel_kind {
            self.channel_kind = channel;
        }
        self.updated_at = at;
        Some(event(self, SitePatchEventKind::RolledBack, None, at))
    }
}

impl SitePatchDraft {
    pub fn validate(&self) -> Result<(), GeoError> {
        require_text("patch_title", &self.title)?;
        require_text("patch_target_url", &self.target_url)?;
        require_text("patch_body", &self.body)
    }

    /// 手动新建：`status = draft`、`review_status = approved`、`source = manual`。
    /// `action_id` / `round_id` 由服务层决定（行动族未落 Rust 时为空）。
    pub fn into_patch(
        self,
        project_id: ProjectId,
        position: i32,
        now: DateTime<Utc>,
    ) -> Result<SitePatch, GeoError> {
        self.validate()?;
        Ok(SitePatch {
            id: SitePatchId::new(),
            project_id,
            action_id: None,
            round_id: String::new(),
            kind: self.kind,
            title: self.title.trim().to_string(),
            target_url: self.target_url.trim().to_string(),
            target_hint: clean_optional(self.target_hint),
            body: self.body,
            published_body: None,
            published_kind: None,
            published_target_url: None,
            published_channel_kind: None,
            status: SitePatchStatus::Draft,
            review_status: ContentStatus::Approved,
            channel_kind: self.channel_kind,
            source: LibrarySource::Manual,
            position,
            published_at: None,
            created_at: now,
            updated_at: now,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::site::SiteChannelKind;

    fn patch() -> SitePatch {
        SitePatchDraft {
            kind: SitePatchKind::LlmsTxt,
            title: "上线 llms.txt".to_string(),
            target_url: "/llms.txt".to_string(),
            target_hint: None,
            body: "User-agent: *".to_string(),
            channel_kind: SiteChannelKind::Bundle,
            action_id: None,
        }
        .into_patch(ProjectId::new(), 0, Utc::now())
        .unwrap()
    }

    #[test]
    fn draft_requires_title_target_and_body() {
        for (field, mutate) in [
            ("patch_title", 0usize),
            ("patch_target_url", 1),
            ("patch_body", 2),
        ] {
            let mut draft = SitePatchDraft {
                kind: SitePatchKind::LlmsTxt,
                title: "标题".to_string(),
                target_url: "/llms.txt".to_string(),
                target_hint: None,
                body: "正文".to_string(),
                channel_kind: SiteChannelKind::Bundle,
                action_id: None,
            };
            match mutate {
                0 => draft.title = " ".to_string(),
                1 => draft.target_url = " ".to_string(),
                _ => draft.body = " ".to_string(),
            }
            let error = draft.validate().unwrap_err();
            assert_eq!(error.params()["field"], field);
        }
    }

    #[test]
    fn manual_draft_is_draft_approved_and_manual() {
        let value = patch();
        assert_eq!(value.status, SitePatchStatus::Draft);
        assert_eq!(value.review_status, ContentStatus::Approved);
        assert_eq!(value.source, LibrarySource::Manual);
        assert!(value.published_body.is_none());
        assert!(value.action_id.is_none());
    }

    #[test]
    fn publish_requires_approved_and_snapshots_full_definition() {
        let mut value = patch();
        value.review_status = ContentStatus::PendingReview;
        assert_eq!(
            value.publish(Utc::now()).unwrap_err().params()["field"],
            "review_status"
        );

        value.review_status = ContentStatus::Approved;
        let at = Utc::now();
        let event = value.publish(at).unwrap();
        assert_eq!(value.status, SitePatchStatus::Published);
        assert_eq!(value.published_body.as_deref(), Some("User-agent: *"));
        assert_eq!(value.published_kind, Some(SitePatchKind::LlmsTxt));
        assert_eq!(event.kind, SitePatchEventKind::Published);
        assert_eq!(event.channel_kind, Some(SiteChannelKind::Bundle));
        assert_eq!(value.published_at, Some(at));
    }

    #[test]
    fn unpublish_is_idempotent_and_keeps_snapshot() {
        let mut value = patch();
        value.publish(Utc::now()).unwrap();
        assert!(value.unpublish(Utc::now()).is_some());
        assert_eq!(value.status, SitePatchStatus::Unpublished);
        assert!(value.published_at.is_none());
        assert!(value.published_body.is_some());
        assert!(value.unpublish(Utc::now()).is_none());
    }

    #[test]
    fn rollback_restores_snapshot_without_changing_status() {
        let mut value = patch();
        value.publish(Utc::now()).unwrap();
        value.body = "改过的草案".to_string();
        value.kind = SitePatchKind::RobotsTxt;
        value.target_url = "/robots.txt".to_string();
        value.channel_kind = SiteChannelKind::Cms;
        let event = value.rollback(Utc::now()).unwrap();
        assert_eq!(value.body, "User-agent: *");
        assert_eq!(value.kind, SitePatchKind::LlmsTxt);
        assert_eq!(value.target_url, "/llms.txt");
        assert_eq!(value.channel_kind, SiteChannelKind::Bundle);
        assert_eq!(value.status, SitePatchStatus::Published, "回滚不动状态");
        assert_eq!(event.kind, SitePatchEventKind::RolledBack);
        assert!(value.rollback(Utc::now()).is_none(), "已一致时不再记事件");
    }
}
