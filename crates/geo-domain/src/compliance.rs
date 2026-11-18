//! 合规红线：广告法绝对化用语词库与扫描。
//!
//! # 🔴 内置词库编译期固化
//! 内置词表来自数据文件 `data/adlaw_terms.txt`，由 `include_str!` **编进二进制**：
//! 它随版本一起签名分发，离线可用，也不会因为磁盘上的文件被删/改而静默失效。
//! 因此"运营改词表"**不能**靠改安装目录里的文件 —— 那既不生效也不可信。
//!
//! # 🔴 远程只能加严，不能放宽
//! 运营新增的词经**远程规则包**（`compliance.json`）下发，由 [`terms_with`] 与内置词取**并集**生效。
//! 并集语义是刻意的：远程可以加词（监管口径变化时不必等客户端发版），
//! 但**不能删除或弱化**内置词 —— 否则任何能篡改服务端的人都能把"保证排名"从黑名单里拿掉，
//! 让客户端的违规内容照常生成。

use std::sync::{OnceLock, RwLock};

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

/// 内置词表 ∪ 远程词表（去重 + 稳定排序）。
///
/// - 远程词只做 `trim` 与去空；**不做任何"删除内置词"的语义**（并集，不是覆盖）。
/// - 排序用 `sort_unstable` 后再 `dedup`：词表很小，稳定性对结果无影响，
///   但去重必须在排序之后，否则同名但顺序不同的重复项会留下来。
/// - `terms()` 保持不变（只回内置），既有调用点与"内置词表完整性"测试不受影响。
pub fn terms_with(remote: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = terms().to_vec();
    for term in remote {
        let term = term.trim();
        if !term.is_empty() {
            merged.push(term.to_string());
        }
    }
    merged.sort_unstable();
    merged.dedup();
    merged
}

/// 远程下发的附加词表（进程内缓存）。
///
/// 🔴 **只增不减**：这里只放"远程新增的词"，内置词永远由 [`terms`] 提供。
/// `scan` 每次取 `terms_with(extra)` 的并集，因此远程词一旦同步就立即对所有
/// 生成/编辑/导入路径生效，不需要重启客户端。
static EXTRA_TERMS: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// 设置远程附加词表（同步成功后调用；传空也合法 = 回到只用内置词）。
pub fn set_extra_terms(terms: Vec<String>) {
    let cleaned: Vec<String> = terms
        .into_iter()
        .map(|term| term.trim().to_string())
        .filter(|term| !term.is_empty())
        .collect();
    if let Ok(mut guard) = EXTRA_TERMS.write() {
        *guard = cleaned;
    }
}

/// 当前生效的词表 = 内置 ∪ 远程附加。
pub fn active_terms() -> Vec<String> {
    let extra = EXTRA_TERMS
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    terms_with(&extra)
}

/// 扫描文本中的绝对化用语，返回全部命中项（含位置）。
///
/// 🔴 词表是 [`active_terms`]（内置 ∪ 远程），不是只有内置：
/// 运营在后台新加的红线词必须**立刻**对生成与导入生效。
pub fn scan(text: &str) -> Vec<Violation> {
    let mut violations = Vec::new();
    for term in active_terms() {
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
    fn terms_with_is_a_union_and_never_lets_remote_delete_a_builtin_term() {
        let custom = vec!["新红线词".to_string(), "  命中我  ".to_string()];
        let merged = terms_with(&custom);
        // 内置词一个都不能少
        for term in terms() {
            assert!(merged.contains(term), "远程并集丢了内置词：{term}");
        }
        assert!(merged.contains(&"新红线词".to_string()));
        // 首尾空白被裁掉，而不是带进匹配器（带空格的词永远匹配不到，等于静默失效）
        assert!(merged.contains(&"命中我".to_string()));
        assert!(!merged.iter().any(|t| t.contains(' ')), "词条不该带空白");
        // 无重复
        let mut sorted = merged.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), merged.len(), "并集结果有重复");
    }

    #[test]
    fn remote_cannot_shadow_or_relax_builtin_terms() {
        // 🔴 远程即使"重新定义"同一个词（或传空串试图占位），内置词仍在，语义不变
        let merged = terms_with(&["霸屏".to_string(), "".to_string(), "   ".to_string()]);
        assert!(merged.contains(&"霸屏".to_string()));
        assert_eq!(
            merged.iter().filter(|t| t.as_str() == "霸屏").count(),
            1,
            "同名内置词必须只出现一次"
        );
        assert!(!merged.iter().any(|t| t.is_empty()), "空词条必须被丢弃");
    }

    #[test]
    fn remote_terms_take_effect_immediately_for_scan_and_check() {
        // 🔴 这条守的是"并集词表真的接上了扫描路径"：
        //   只加 terms_with() 而不改 scan()，远程词就是一份没人用的数据。
        set_extra_terms(vec!["新红线词".to_string()]);
        let hits = scan("这句里出现新红线词");
        assert!(hits.iter().any(|hit| hit.term == "新红线词"), "{hits:?}");
        assert!(check("这句里出现新红线词").is_err());
        // 内置词照旧生效
        assert!(check("保证排名").is_err());

        set_extra_terms(Vec::new());
        assert!(scan("这句里出现新红线词").is_empty());
        assert!(check("这句里出现新红线词").is_ok());
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
