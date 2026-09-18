//! 合规红线：广告法绝对化用语词库与扫描。
//!
//! 词库为数据文件 `data/adlaw_terms.txt`，运营可增删而无需改代码。

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::error::GeoError;

/// 生成内容的审核状态：默认进入「待人工审核」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ContentStatus {
    #[default]
    PendingReview,
    Approved,
    Rejected,
}

impl ContentStatus {
    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::PendingReview => "待人工审核",
            Self::Approved => "已通过",
            Self::Rejected => "已驳回",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    pub term: String,
    /// 字符（非字节）偏移，便于前端高亮。
    pub start: usize,
    pub end: usize,
}

static TERMS: OnceLock<Vec<String>> = OnceLock::new();

const TERMS_SOURCE: &str = include_str!("../data/adlaw_terms.txt");

pub fn terms() -> &'static [String] {
    TERMS.get_or_init(|| {
        TERMS_SOURCE
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(str::to_string)
            .collect()
    })
}

/// 扫描文本中的绝对化用语，返回全部命中项（含位置）。
pub fn scan(text: &str) -> Vec<Violation> {
    let mut violations = Vec::new();
    for term in terms() {
        let mut search_from = 0;
        while let Some(relative) = text[search_from..].find(term.as_str()) {
            let byte_start = search_from + relative;
            let byte_end = byte_start + term.len();
            violations.push(Violation {
                term: term.clone(),
                start: text[..byte_start].chars().count(),
                end: text[..byte_end].chars().count(),
            });
            search_from = byte_end;
        }
    }
    violations.sort_by_key(|violation| (violation.start, violation.end));
    violations
}

pub fn is_clean(text: &str) -> bool {
    scan(text).is_empty()
}

/// 命中红线词时返回校验错误，错误信息列出全部命中词（去重）。
pub fn check(text: &str) -> Result<(), GeoError> {
    let hits = scan(text);
    if hits.is_empty() {
        return Ok(());
    }
    let mut unique: Vec<String> = Vec::new();
    for hit in hits {
        if !unique.contains(&hit.term) {
            unique.push(hit.term);
        }
    }
    // `value` 装命中的原始词（数据，不是文案）：词典模板只说「需改写」，
    // 绝不复述红线词本身（AGENTS 规则 6）。
    Err(GeoError::validation("content", "not_allowed").with_param("value", unique.join("、")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terms_load_without_comments_or_blanks() {
        let list = terms();
        assert!(list.len() >= 20, "词库过短：{}", list.len());
        assert!(list
            .iter()
            .all(|term| !term.is_empty() && !term.starts_with('#')));
        assert!(list.iter().any(|term| term == "霸屏"));
    }

    #[test]
    fn scan_finds_terms_with_char_offsets() {
        let text = "我们保证排名第一，效果100%";
        let hits = scan(text);
        let found: Vec<&str> = hits.iter().map(|hit| hit.term.as_str()).collect();
        assert!(found.contains(&"保证排名"), "{found:?}");
        assert!(found.contains(&"排名第一"), "{found:?}");
        assert!(found.contains(&"100%"), "{found:?}");
        let first = &hits[0];
        let chars: Vec<char> = text.chars().collect();
        assert_eq!(
            chars[first.start..first.end].iter().collect::<String>(),
            first.term
        );
    }

    #[test]
    fn percentages_other_than_absolute_are_clean() {
        assert!(is_clean("豆包提及率提升 18%，事实错误减少 5 条"));
        assert!(!is_clean("效果 100% 可见"));
    }

    #[test]
    fn scan_reports_multiple_occurrences() {
        let hits = scan("霸屏，还是霸屏");
        assert_eq!(hits.iter().filter(|h| h.term == "霸屏").count(), 2);
    }

    #[test]
    fn check_returns_validation_error_listing_terms() {
        let err = check("行业第一，永久有效").unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert!(err.user_message().contains("行业第一"));
        assert!(err.user_message().contains("永久"));
        assert!(check("可见度覆盖率 42%").is_ok());
    }

    #[test]
    fn content_status_defaults_to_pending_review() {
        assert_eq!(ContentStatus::default(), ContentStatus::PendingReview);
        assert_eq!(
            serde_json::to_string(&ContentStatus::PendingReview).unwrap(),
            "\"pending_review\""
        );
        assert_eq!(ContentStatus::Approved.label_zh(), "已通过");
    }
}
