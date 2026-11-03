//! 关键词素材库模型（M1.5）。
//!
//! 设计规格：`docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`。
//!
//! 🔴 本模块只做**纯校验**：不查库、不调模型、不生成。`monthly_volume` / `difficulty`
//! 在真后端来自关键词接口，demo 里是种子静态值；这里只规定它们的合法范围。
//! 🔴 人工录入的 `source` 恒为 `manual`、`status` 恒为 `approved`——服务层负责固定，
//! 前端草稿里自称 `generated` 不算数（照 `prompt_item_add` 的同一纪律）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::compliance::ContentStatus;
use crate::error::GeoError;
use crate::ids::{KeywordId, ProjectId};
use crate::prompt::IntentCategory;

/// 关键词文本上限：与 Prompt 条目同一量级，避免把整段文章塞进素材库。
pub const MAX_KEYWORD_CHARS: usize = 300;
/// 优先级下限 / 上限（引用成 Prompt 条目时当 `weight` 用）。
pub const MIN_PRIORITY: u8 = 1;
pub const MAX_PRIORITY: u8 = 5;
/// 竞争难度上限（0~100）。
pub const MAX_DIFFICULTY: u8 = 100;

/// 关键词类型（5 类），序列化值即数据库与前端契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeywordKind {
    Core,
    LongTail,
    Brand,
    Competitor,
    Question,
}

impl KeywordKind {
    pub fn all() -> [Self; 5] {
        [
            Self::Core,
            Self::LongTail,
            Self::Brand,
            Self::Competitor,
            Self::Question,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::LongTail => "long_tail",
            Self::Brand => "brand",
            Self::Competitor => "competitor",
            Self::Question => "question",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Self::all().into_iter().find(|kind| kind.as_str() == raw)
    }
}

/// 素材来源（3 档）。刻意不复用 `PromptSource`：素材库没有模板展开 / 改写两条链路。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LibrarySource {
    Manual,
    Generated,
    Imported,
}

impl LibrarySource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Generated => "generated",
            Self::Imported => "imported",
        }
    }
}

/// 一条关键词素材。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeywordItem {
    pub id: KeywordId,
    pub project_id: ProjectId,
    pub text: String,
    pub kind: KeywordKind,
    pub intent: IntentCategory,
    pub monthly_volume: Option<i64>,
    pub difficulty: Option<u8>,
    pub priority: u8,
    pub status: ContentStatus,
    pub note: Option<String>,
    pub source: LibrarySource,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 手动录入一条关键词的草稿。`source` / `status` / `position` / 时间戳由服务层固定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeywordDraft {
    pub text: String,
    pub kind: KeywordKind,
    pub intent: IntentCategory,
    #[serde(default)]
    pub priority: Option<u8>,
    #[serde(default)]
    pub note: Option<String>,
}

/// 共享的文本校验：去首尾空白后非空且不超长。
fn validate_text(text: &str) -> Result<(), GeoError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(GeoError::validation("text", "required"));
    }
    if trimmed.chars().count() > MAX_KEYWORD_CHARS {
        return Err(GeoError::validation("text", "too_long").with_param("limit", MAX_KEYWORD_CHARS));
    }
    Ok(())
}

fn validate_priority(priority: u8) -> Result<(), GeoError> {
    if !(MIN_PRIORITY..=MAX_PRIORITY).contains(&priority) {
        return Err(GeoError::validation("priority", "out_of_range")
            .with_param("expected", format!("{MIN_PRIORITY}..={MAX_PRIORITY}")));
    }
    Ok(())
}

impl KeywordItem {
    /// 整行校验。更新路径必须走这里（否则绕过弹窗直接调 IPC 就能写进非法值）。
    pub fn validate(&self) -> Result<(), GeoError> {
        validate_text(&self.text)?;
        validate_priority(self.priority)?;
        if let Some(difficulty) = self.difficulty {
            if difficulty > MAX_DIFFICULTY {
                return Err(GeoError::validation("difficulty", "out_of_range")
                    .with_param("expected", format!("0..={MAX_DIFFICULTY}")));
            }
        }
        if let Some(volume) = self.monthly_volume {
            if volume < 0 {
                return Err(GeoError::validation("monthly_volume", "out_of_range")
                    .with_param("expected", ">=0"));
            }
        }
        Ok(())
    }
}

impl KeywordDraft {
    pub fn validate(&self) -> Result<(), GeoError> {
        validate_text(&self.text)?;
        if let Some(priority) = self.priority {
            validate_priority(priority)?;
        }
        Ok(())
    }

    /// 人工录入：`source = manual`、`status = approved`，搜索量 / 难度留空。
    pub fn into_item(
        self,
        project_id: ProjectId,
        position: i32,
        now: DateTime<Utc>,
    ) -> Result<KeywordItem, GeoError> {
        self.validate()?;
        Ok(KeywordItem {
            id: KeywordId::new(),
            project_id,
            text: self.text.trim().to_string(),
            kind: self.kind,
            intent: self.intent,
            monthly_volume: None,
            difficulty: None,
            priority: self.priority.unwrap_or(3),
            status: ContentStatus::Approved,
            note: self
                .note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            source: LibrarySource::Manual,
            position,
            created_at: now,
            updated_at: now,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::KeywordId;

    fn item() -> KeywordItem {
        let now = Utc::now();
        KeywordItem {
            id: KeywordId::new(),
            project_id: ProjectId::new(),
            text: "工业除尘器".to_string(),
            kind: KeywordKind::Core,
            intent: IntentCategory::CategoryAwareness,
            monthly_volume: Some(1200),
            difficulty: Some(30),
            priority: 3,
            status: ContentStatus::Approved,
            note: None,
            source: LibrarySource::Manual,
            position: 0,
            created_at: now,
            updated_at: now,
        }
    }

    fn draft(text: &str) -> KeywordDraft {
        KeywordDraft {
            text: text.to_string(),
            kind: KeywordKind::Core,
            intent: IntentCategory::CategoryAwareness,
            priority: Some(3),
            note: None,
        }
    }

    #[test]
    fn kind_roundtrips_all_values() {
        for kind in KeywordKind::all() {
            assert_eq!(KeywordKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(KeywordKind::parse("scenario"), None);
    }

    #[test]
    fn draft_rejects_blank_and_too_long_text() {
        assert_eq!(
            draft("   ").validate().unwrap_err().code(),
            "validation/failed"
        );
        let long = "字".repeat(MAX_KEYWORD_CHARS + 1);
        let error = draft(&long).validate().unwrap_err();
        assert_eq!(error.code(), "validation/failed");
        assert!(error.params().contains_key("limit"));
    }

    #[test]
    fn draft_rejects_priority_out_of_range() {
        let mut value = draft("工业除尘器");
        value.priority = Some(6);
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
        value.priority = Some(0);
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
    }

    #[test]
    fn into_item_fixes_source_status_and_trims_text() {
        let item = draft("  工业除尘器  ")
            .into_item(ProjectId::new(), 7, Utc::now())
            .unwrap();
        assert_eq!(item.text, "工业除尘器");
        assert_eq!(item.source, LibrarySource::Manual);
        assert_eq!(item.status, ContentStatus::Approved);
        assert_eq!(item.position, 7);
        assert_eq!(item.monthly_volume, None);
        assert_eq!(item.difficulty, None);
        assert_eq!(item.priority, 3);
    }

    #[test]
    fn item_rejects_negative_volume_and_difficulty_over_hundred() {
        let mut value = item();
        value.monthly_volume = Some(-1);
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
        value.monthly_volume = None;
        value.difficulty = Some(101);
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
    }

    #[test]
    fn item_accepts_null_metrics() {
        let mut value = item();
        value.monthly_volume = None;
        value.difficulty = None;
        assert!(value.validate().is_ok());
    }
}
