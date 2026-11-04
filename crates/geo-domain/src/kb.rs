//! 知识库条目模型（M1.2b，Plan C 第三个纵向切片）。
//!
//! 设计规格：`docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`
//! （DR-73 … DR-82 / DR-119）。
//!
//! 🔴 本模块只做**纯校验与纯计数**：标题必填；`scenario` 只在两个话术模块保留；
//! `KbStats` 是数数，不是覆盖率 / 可信度评分（规则 9）。
//! 修订留痕的逐字段 diff 也在这里：改两个字段记两条，`body_markdown` 只截留痕副本。

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::compliance::ContentStatus;
use crate::entity_card::FieldStatus;
use crate::error::GeoError;
use crate::ids::{KbEntryId, ProjectId, RevisionId};

/// 知识条目的正文进留痕前的截断上限（库里的正文不截断）。
pub const KB_REVISION_BODY_LIMIT: usize = 120;

/// 知识模块（11 档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KbModule {
    Brand,
    Product,
    SellingPoint,
    SalesScript,
    SupportScript,
    Case,
    Competitor,
    Audience,
    Tone,
    Qualification,
    Media,
}

impl KbModule {
    pub fn all() -> [Self; 11] {
        [
            Self::Brand,
            Self::Product,
            Self::SellingPoint,
            Self::SalesScript,
            Self::SupportScript,
            Self::Case,
            Self::Competitor,
            Self::Audience,
            Self::Tone,
            Self::Qualification,
            Self::Media,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Brand => "brand",
            Self::Product => "product",
            Self::SellingPoint => "selling_point",
            Self::SalesScript => "sales_script",
            Self::SupportScript => "support_script",
            Self::Case => "case",
            Self::Competitor => "competitor",
            Self::Audience => "audience",
            Self::Tone => "tone",
            Self::Qualification => "qualification",
            Self::Media => "media",
        }
    }

    /// 只有两个话术模块允许非空 `scenario`（DR-75）。
    pub fn is_script(&self) -> bool {
        matches!(self, Self::SalesScript | Self::SupportScript)
    }
}

/// 话术场景（10 档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KbScenario {
    SalesFirstContact,
    SalesNeeds,
    SalesObjection,
    SalesQuote,
    SalesClosing,
    SalesFollowup,
    SupportPresale,
    SupportAftersale,
    SupportComplaint,
    SupportReturn,
}

/// 素材形式（6 档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KbEntryKind {
    Statement,
    Text,
    Link,
    Image,
    Video,
    File,
}

impl KbEntryKind {
    pub fn is_media(&self) -> bool {
        matches!(self, Self::Image | Self::Video | Self::File)
    }
}

/// 知识来源（3 档）。`imported` = 从实体卡 / 项目信息一次性复制，不跟随源头。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KbSource {
    Manual,
    Generated,
    Imported,
}

/// 一条知识条目。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KbEntry {
    pub id: KbEntryId,
    pub project_id: ProjectId,
    pub module: KbModule,
    pub kind: KbEntryKind,
    pub title: String,
    pub body_markdown: String,
    pub url: Option<String>,
    pub mime: Option<String>,
    pub tags: Vec<String>,
    pub status: ContentStatus,
    pub source: KbSource,
    pub scenario: Option<KbScenario>,
    pub verified_at: Option<DateTime<Utc>>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 手动录入 / 导入一条知识的草稿。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KbEntryDraft {
    pub module: KbModule,
    pub kind: KbEntryKind,
    pub title: String,
    #[serde(default)]
    pub body_markdown: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub scenario: Option<KbScenario>,
    /// 只认 `imported` 这一个覆盖值；其余一律按 `manual` 落库（DR-81）。
    #[serde(default)]
    pub source: Option<KbSource>,
    /// 只在导入时被尊重；只认 `approved` / `pending_review`。
    #[serde(default)]
    pub status: Option<ContentStatus>,
}

/// 知识库统计（6 个数数）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KbStats {
    pub modules: usize,
    pub entries: usize,
    pub scripts: usize,
    pub pending_review: usize,
    pub unverified: usize,
    pub media: usize,
}

impl KbStats {
    pub fn from_entries(entries: &[KbEntry]) -> Self {
        Self {
            modules: entries
                .iter()
                .map(|entry| entry.module)
                .collect::<HashSet<_>>()
                .len(),
            entries: entries.len(),
            scripts: entries
                .iter()
                .filter(|entry| entry.module.is_script())
                .count(),
            pending_review: entries
                .iter()
                .filter(|entry| entry.status == ContentStatus::PendingReview)
                .count(),
            unverified: entries
                .iter()
                .filter(|entry| entry.verified_at.is_none())
                .count(),
            media: entries.iter().filter(|entry| entry.kind.is_media()).count(),
        }
    }
}

/// 一条知识条目的字段级修订留痕（与 `EntityCardRevision` 六键同构）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KbEntryRevision {
    pub id: RevisionId,
    pub entry_id: KbEntryId,
    pub project_id: ProjectId,
    pub field_path: String,
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
    pub status: FieldStatus,
    pub note: Option<String>,
    pub edited_at: DateTime<Utc>,
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn clipped(field_path: &str, value: &Value) -> Value {
    if field_path != "body_markdown" {
        return value.clone();
    }
    match value.as_str() {
        Some(text) if text.chars().count() > KB_REVISION_BODY_LIMIT => {
            Value::String(text.chars().take(KB_REVISION_BODY_LIMIT).collect())
        }
        _ => value.clone(),
    }
}

/// 审核态 → 留痕可信态（`approved → official` / `pending_review → pending` / `rejected → disputed`）。
pub fn field_status_of(status: ContentStatus) -> FieldStatus {
    match status {
        ContentStatus::Approved => FieldStatus::Official,
        ContentStatus::PendingReview => FieldStatus::Pending,
        ContentStatus::Rejected => FieldStatus::Disputed,
    }
}

fn revision(
    entry: &KbEntry,
    field_path: &str,
    old_value: Value,
    new_value: Value,
    status: FieldStatus,
    stamp: DateTime<Utc>,
) -> KbEntryRevision {
    KbEntryRevision {
        id: RevisionId::new(),
        entry_id: entry.id,
        project_id: entry.project_id,
        field_path: field_path.to_string(),
        old_value: Some(clipped(field_path, &old_value)),
        new_value: Some(clipped(field_path, &new_value)),
        status,
        note: None,
        edited_at: stamp,
    }
}

impl KbEntry {
    pub fn validate(&self) -> Result<(), GeoError> {
        if self.title.trim().is_empty() {
            return Err(GeoError::validation("kb_title", "required"));
        }
        Ok(())
    }

    /// 逐字段比对 `before` / `after`，只给真的变了的 9 个字段各记一条（DR-119）。
    pub fn diff_revisions(
        before: &Self,
        after: &Self,
        stamp: DateTime<Utc>,
    ) -> Vec<KbEntryRevision> {
        let status = field_status_of(after.status);
        let pairs: [(&str, Value, Value); 9] = [
            ("module", json!(before.module), json!(after.module)),
            ("kind", json!(before.kind), json!(after.kind)),
            ("title", json!(before.title), json!(after.title)),
            (
                "body_markdown",
                json!(before.body_markdown),
                json!(after.body_markdown),
            ),
            ("url", json!(before.url), json!(after.url)),
            ("mime", json!(before.mime), json!(after.mime)),
            ("tags", json!(before.tags), json!(after.tags)),
            ("status", json!(before.status), json!(after.status)),
            ("scenario", json!(before.scenario), json!(after.scenario)),
        ];
        pairs
            .into_iter()
            .filter(|(_, old, new)| old != new)
            .map(|(field, old, new)| revision(before, field, old, new, status, stamp))
            .collect()
    }
}

/// `kb_entry_verify` 的那一条留痕：`field_path` 恒 `verified_at`。
pub fn verify_revision(
    entry: &KbEntry,
    previous: Option<DateTime<Utc>>,
    stamp: DateTime<Utc>,
) -> KbEntryRevision {
    KbEntryRevision {
        id: RevisionId::new(),
        entry_id: entry.id,
        project_id: entry.project_id,
        field_path: "verified_at".to_string(),
        old_value: previous.map(|value| json!(value)),
        new_value: Some(json!(stamp)),
        status: FieldStatus::Official,
        note: None,
        edited_at: stamp,
    }
}

impl KbEntryDraft {
    pub fn validate(&self) -> Result<(), GeoError> {
        if self.title.trim().is_empty() {
            return Err(GeoError::validation("kb_title", "required"));
        }
        Ok(())
    }

    /// 落库形态：人工录入恒 `manual + approved`；导入只认 `imported`，并尊重
    /// `approved` / `pending_review` 两档状态。`scenario` 只对两个话术模块保留。
    pub fn into_item(
        self,
        project_id: ProjectId,
        position: i32,
        now: DateTime<Utc>,
    ) -> Result<KbEntry, GeoError> {
        self.validate()?;
        let imported = self.source == Some(KbSource::Imported);
        let status = if imported {
            match self.status {
                Some(ContentStatus::Approved) => ContentStatus::Approved,
                _ => ContentStatus::PendingReview,
            }
        } else {
            ContentStatus::Approved
        };
        Ok(KbEntry {
            id: KbEntryId::new(),
            project_id,
            module: self.module,
            kind: self.kind,
            title: self.title.trim().to_string(),
            body_markdown: self.body_markdown,
            url: clean_optional(self.url),
            mime: clean_optional(self.mime),
            tags: self
                .tags
                .into_iter()
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .collect(),
            status,
            source: if imported {
                KbSource::Imported
            } else {
                KbSource::Manual
            },
            scenario: if self.module.is_script() {
                self.scenario
            } else {
                None
            },
            verified_at: None,
            position,
            created_at: now,
            updated_at: now,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> KbEntryDraft {
        KbEntryDraft {
            module: KbModule::SalesScript,
            kind: KbEntryKind::Statement,
            title: "  一句话说清价值  ".to_string(),
            body_markdown: "我们帮客户做 GEO。".to_string(),
            url: None,
            mime: None,
            tags: vec![" 开场 ".to_string(), "".to_string()],
            scenario: Some(KbScenario::SalesFirstContact),
            source: None,
            status: None,
        }
    }

    fn item() -> KbEntry {
        draft().into_item(ProjectId::new(), 0, Utc::now()).unwrap()
    }

    #[test]
    fn draft_requires_title() {
        let mut value = draft();
        value.title = "   ".to_string();
        let error = value.validate().unwrap_err();
        assert_eq!(error.code(), "validation/failed");
        assert_eq!(error.params()["field"], "kb_title");
    }

    #[test]
    fn manual_entry_is_approved_and_scenario_only_for_scripts() {
        let value = draft().into_item(ProjectId::new(), 3, Utc::now()).unwrap();
        assert_eq!(value.title, "一句话说清价值");
        assert_eq!(value.source, KbSource::Manual);
        assert_eq!(value.status, ContentStatus::Approved);
        assert_eq!(value.scenario, Some(KbScenario::SalesFirstContact));
        assert_eq!(value.tags, vec!["开场".to_string()]);
        assert_eq!(value.position, 3);
        assert!(value.verified_at.is_none());

        let mut brand = draft();
        brand.module = KbModule::Brand;
        brand.scenario = Some(KbScenario::SalesQuote);
        let value = brand.into_item(ProjectId::new(), 0, Utc::now()).unwrap();
        assert_eq!(value.scenario, None, "非话术模块的场景必须被摘掉");
    }

    #[test]
    fn imported_draft_respects_only_approved_or_pending() {
        let mut value = draft();
        value.source = Some(KbSource::Imported);
        value.status = Some(ContentStatus::Approved);
        assert_eq!(
            value
                .clone()
                .into_item(ProjectId::new(), 0, Utc::now())
                .unwrap()
                .status,
            ContentStatus::Approved
        );
        value.status = Some(ContentStatus::Rejected);
        assert_eq!(
            value
                .into_item(ProjectId::new(), 0, Utc::now())
                .unwrap()
                .status,
            ContentStatus::PendingReview
        );
    }

    #[test]
    fn stats_count_modules_scripts_pending_unverified_and_media() {
        let mut first = item();
        first.module = KbModule::Brand;
        first.kind = KbEntryKind::Text;
        first.status = ContentStatus::PendingReview;
        let mut second = item();
        second.kind = KbEntryKind::Image;
        second.verified_at = Some(Utc::now());
        let stats = KbStats::from_entries(&[first, second]);
        assert_eq!(stats.modules, 2);
        assert_eq!(stats.entries, 2);
        assert_eq!(stats.scripts, 1);
        assert_eq!(stats.pending_review, 1);
        assert_eq!(stats.unverified, 1);
        assert_eq!(stats.media, 1);
    }

    #[test]
    fn diff_records_each_changed_field_and_clips_body_copy() {
        let before = item();
        let mut after = before.clone();
        after.title = "新标题".to_string();
        after.body_markdown = "字".repeat(KB_REVISION_BODY_LIMIT + 20);
        after.status = ContentStatus::Rejected;
        let rows = KbEntry::diff_revisions(&before, &after, Utc::now());
        let fields: Vec<&str> = rows.iter().map(|row| row.field_path.as_str()).collect();
        assert_eq!(fields, vec!["title", "body_markdown", "status"]);
        let body = rows[1].new_value.as_ref().unwrap().as_str().unwrap();
        assert_eq!(body.chars().count(), KB_REVISION_BODY_LIMIT);
        assert_eq!(rows[2].status, FieldStatus::Disputed);
    }

    #[test]
    fn verify_revision_uses_previous_time_as_old_value() {
        let entry = item();
        let first = verify_revision(&entry, None, Utc::now());
        assert_eq!(first.field_path, "verified_at");
        assert!(first.old_value.is_none());
        assert_eq!(first.status, FieldStatus::Official);
    }
}
