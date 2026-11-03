//! FAQ 素材库模型（M1.5）。
//!
//! 设计规格：`docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`。
//!
//! 🔴 本模块只做**纯校验**：问题与答案都必填（去首尾空白后非空）。长度上限尚未由产品
//! 裁定，因此这里不发明阈值；超长正文由存储层 TEXT 承载，真后端若要限长，先在规格里定值。
//! 🔴 人工录入的 `source` 恒为 `manual`、`status` 恒为 `approved`；生成路径不在本切片。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::compliance::ContentStatus;
use crate::error::GeoError;
use crate::ids::{FaqId, ProjectId};
use crate::keyword::LibrarySource;
use crate::prompt::IntentCategory;

/// 一条 FAQ 素材（问题 + Markdown 答案）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FaqItem {
    pub id: FaqId,
    pub project_id: ProjectId,
    pub question: String,
    /// Markdown 原文；导出 JSON-LD 时按原文塞进 `acceptedAnswer.text`。
    pub answer_markdown: String,
    /// 自由文本分类（如「选型」「售后」）；它是**数据**，不是枚举。
    pub category: Option<String>,
    pub intent: IntentCategory,
    pub status: ContentStatus,
    pub source: LibrarySource,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 手动录入一条 FAQ 的草稿。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FaqDraft {
    pub question: String,
    pub answer_markdown: String,
    #[serde(default)]
    pub category: Option<String>,
    pub intent: IntentCategory,
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

impl FaqItem {
    pub fn validate(&self) -> Result<(), GeoError> {
        require_text("question", &self.question)?;
        require_text("answer_markdown", &self.answer_markdown)
    }
}

impl FaqDraft {
    pub fn validate(&self) -> Result<(), GeoError> {
        require_text("question", &self.question)?;
        require_text("answer_markdown", &self.answer_markdown)
    }

    /// 人工录入：`source = manual`、`status = approved`。
    pub fn into_item(
        self,
        project_id: ProjectId,
        position: i32,
        now: DateTime<Utc>,
    ) -> Result<FaqItem, GeoError> {
        self.validate()?;
        Ok(FaqItem {
            id: FaqId::new(),
            project_id,
            question: self.question.trim().to_string(),
            // 🔴 答案正文保留首尾空白之外的原文（换行与列表记号不能动，JSON-LD 要原样导出）。
            answer_markdown: self.answer_markdown.trim().to_string(),
            category: clean_optional(self.category),
            intent: self.intent,
            status: ContentStatus::Approved,
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

    fn draft() -> FaqDraft {
        FaqDraft {
            question: "  除尘器多久换一次滤芯？  ".to_string(),
            answer_markdown: "\n- 视压差而定\n- 一般 3~6 个月\n".to_string(),
            category: Some("  售后  ".to_string()),
            intent: IntentCategory::AfterSalesReputation,
        }
    }

    fn item() -> FaqItem {
        draft()
            .into_item(ProjectId::new(), 0, Utc::now())
            .expect("样例合法")
    }

    #[test]
    fn draft_requires_question() {
        let mut value = draft();
        value.question = "   ".to_string();
        let error = value.validate().unwrap_err();
        assert_eq!(error.code(), "validation/failed");
        assert_eq!(error.params()["field"], "question");
    }

    #[test]
    fn draft_requires_answer() {
        let mut value = draft();
        value.answer_markdown = "\n  \n".to_string();
        let error = value.validate().unwrap_err();
        assert_eq!(error.params()["field"], "answer_markdown");
    }

    #[test]
    fn into_item_trims_edges_but_keeps_markdown_body() {
        let value = draft().into_item(ProjectId::new(), 3, Utc::now()).unwrap();
        assert_eq!(value.question, "除尘器多久换一次滤芯？");
        assert_eq!(value.answer_markdown, "- 视压差而定\n- 一般 3~6 个月");
        assert_eq!(value.category.as_deref(), Some("售后"));
        assert_eq!(value.source, LibrarySource::Manual);
        assert_eq!(value.status, ContentStatus::Approved);
        assert_eq!(value.position, 3);
    }

    #[test]
    fn empty_category_becomes_none() {
        let mut value = draft();
        value.category = Some("   ".to_string());
        let item = value.into_item(ProjectId::new(), 0, Utc::now()).unwrap();
        assert_eq!(item.category, None);
    }

    #[test]
    fn item_validation_matches_draft() {
        let mut value = item();
        value.question = String::new();
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
        value.question = "问题".to_string();
        value.answer_markdown = String::new();
        assert_eq!(value.validate().unwrap_err().code(), "validation/failed");
        value.answer_markdown = "答案".to_string();
        assert!(value.validate().is_ok());
        assert_ne!(item().id, item().id, "不同调用生成不同 id");
    }
}
