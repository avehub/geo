//! 文章管理（Article Studio）的领域模型：方向 → 模板 → 排期 → 文章。
//!
//! 设计规格：`docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`
//! （DR-83 … DR-89）。本模块只做类型与纯校验/取值，不调模型、不读库。
//!
//! 🔴 没有真 cron：`next_run_at` 是可算的显示值 + `article_schedule_run` 的账，
//! 后台定时器不在本切片内（差异台账 E-65）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::kb::KbModule;
use crate::ProjectId;

pub const ARTICLE_LENGTH_MIN: i32 = 200;
pub const ARTICLE_LENGTH_MAX: i32 = 5_000;
pub const ARTICLE_WEEKDAY_MIN: i32 = 1;
pub const ARTICLE_WEEKDAY_MAX: i32 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleSlot {
    Brand,
    Product,
    Keyword,
    Audience,
    Scenario,
    Competitor,
}

impl ArticleSlot {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Brand => "brand",
            Self::Product => "product",
            Self::Keyword => "keyword",
            Self::Audience => "audience",
            Self::Scenario => "scenario",
            Self::Competitor => "competitor",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleDirectionSource {
    Manual,
    Generated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleDirectionStatus {
    Active,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleFreq {
    Daily,
    Weekly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleSource {
    Scheduled,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleStatus {
    PendingReview,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleDirection {
    pub id: String,
    pub project_id: ProjectId,
    pub title: String,
    pub summary: String,
    pub source: ArticleDirectionSource,
    pub status: ArticleDirectionStatus,
    pub created_at: DateTime<Utc>,
}

/// `article_direction_add` 的入参：`id` 有值即就地改（归档）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ArticleDirectionDraft {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    /// 契约外的值**收敛为不改**（照 demo 的口径），因此收字符串不收紧枚举。
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ArticleTemplateBindings {
    #[serde(default)]
    pub product_names: Vec<String>,
    #[serde(default)]
    pub keyword_texts: Vec<String>,
    #[serde(default)]
    pub audience: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleTemplate {
    pub id: String,
    pub project_id: ProjectId,
    pub direction_id: String,
    pub name: String,
    pub prompt_template: String,
    pub slots: Vec<ArticleSlot>,
    pub bindings: ArticleTemplateBindings,
    pub kb_modules: Vec<KbModule>,
    pub style: String,
    pub length: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `article_template_save` 的入参：`id` 为空即新建。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleTemplateDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub direction_id: String,
    pub name: String,
    pub prompt_template: String,
    /// 只保留契约内的值并去重（DR-16 收敛）。
    #[serde(default)]
    pub slots: Vec<String>,
    #[serde(default)]
    pub bindings: ArticleTemplateBindings,
    #[serde(default)]
    pub kb_modules: Vec<String>,
    #[serde(default)]
    pub style: String,
    pub length: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleSchedule {
    pub id: String,
    pub project_id: ProjectId,
    pub template_id: String,
    pub freq: ArticleFreq,
    pub time: String,
    pub weekday: Option<i32>,
    pub enabled: bool,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub run_count: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleScheduleDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub template_id: String,
    /// 认不出就报 `validation/failed {field:'schedule_freq', reason:'not_allowed'}`。
    pub freq: String,
    pub time: String,
    #[serde(default)]
    pub weekday: Option<i32>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Article {
    pub id: String,
    pub project_id: ProjectId,
    pub direction_id: String,
    pub template_id: String,
    pub schedule_id: Option<String>,
    pub source: ArticleSource,
    pub title: String,
    pub body_markdown: String,
    pub status: ArticleStatus,
    pub word_count: i32,
    pub generated_at: DateTime<Utc>,
}

/// `article_list` 的入参。`review` 有值时先批量改状态，再回快照。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ArticleListQuery {
    /// `all` 或三档状态；认不出当没传（不误伤成空清单）。
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub review: Option<ArticleReviewRequest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArticleReviewRequest {
    pub ids: Vec<String>,
    /// 认不出就报 `validation/failed {field:'review_status', reason:'not_allowed'}`。
    pub status: String,
}

/// 校验 `HH:mm` 形状；合法返回规范化后的串。
pub fn normalize_schedule_time(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (hour, minute) = trimmed.split_once(':')?;
    if hour.len() != 2 || minute.len() != 2 {
        return None;
    }
    let hour: u32 = hour.parse().ok()?;
    let minute: u32 = minute.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(format!("{hour:02}:{minute:02}"))
}

/// 目标字数夹回区间（DR-16：数据字段收敛而不是拒绝）。
pub fn clamp_article_length(value: i32) -> i32 {
    value.clamp(ARTICLE_LENGTH_MIN, ARTICLE_LENGTH_MAX)
}

/// 按 `{{slot}}` 替换模板；取不到值的槽位**保留原记号**，让界面看得见"还没绑"。
pub fn render_prompt(template: &str, values: &[(ArticleSlot, Option<String>)]) -> String {
    let mut rendered = template.to_string();
    for (slot, value) in values {
        let Some(value) = value.as_ref().filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        rendered = rendered.replace(&format!("{{{{{}}}}}", slot.as_str()), value);
    }
    rendered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_time_requires_hh_mm() {
        assert_eq!(normalize_schedule_time("09:05").as_deref(), Some("09:05"));
        assert_eq!(normalize_schedule_time("9:5"), None);
        assert_eq!(normalize_schedule_time("24:00"), None);
        assert_eq!(normalize_schedule_time("09:60"), None);
    }

    #[test]
    fn length_is_clamped() {
        assert_eq!(clamp_article_length(10), ARTICLE_LENGTH_MIN);
        assert_eq!(clamp_article_length(99_999), ARTICLE_LENGTH_MAX);
        assert_eq!(clamp_article_length(1_200), 1_200);
    }

    #[test]
    fn render_prompt_keeps_unbound_slots() {
        let rendered = render_prompt(
            "{{brand}} 在 {{scenario}} 推荐 {{product}}",
            &[
                (ArticleSlot::Brand, Some("澜舟".to_string())),
                (ArticleSlot::Product, None),
                (ArticleSlot::Scenario, Some("选型".to_string())),
            ],
        );
        assert_eq!(rendered, "澜舟 在 选型 推荐 {{product}}");
    }
}
