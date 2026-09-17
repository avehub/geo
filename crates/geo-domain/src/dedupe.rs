//! Prompt 去重：字符 3-gram Jaccard 相似度，纯本地、确定性强、可单测。
//!
//! 口径见 spec FR-M2-3：归一化 → 3-gram 集合 → Jaccard ≥ 0.85 判重，
//! 合并时保留 weight 较高者，并把被合并条目的 tags / competitor_ids 并入保留条目。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::prompt::PromptItem;

pub const DUPLICATE_THRESHOLD: f64 = 0.85;
pub const NGRAM_SIZE: usize = 3;

/// 需要剔除的中文标点与常见符号（ASCII 标点由 `is_ascii_punctuation` 覆盖）。
const CJK_PUNCTUATION: &[char] = &[
    '，', '。', '！', '？', '；', '：', '“', '”', '‘', '’', '（', '）', '《', '》', '、', '…', '—',
    '·', '～', '￥', '【', '】', '〈', '〉', '「', '」', '『', '』',
];

/// 归一化：去空白、全角转半角、去标点、转小写。
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        let ch = match ch {
            '\u{3000}' => ' ',
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(ch as u32 - 0xFEE0).unwrap_or(ch),
            other => other,
        };
        if ch.is_whitespace() || ch.is_ascii_punctuation() || CJK_PUNCTUATION.contains(&ch) {
            continue;
        }
        for lower in ch.to_lowercase() {
            out.push(lower);
        }
    }
    out
}

/// 字符 n-gram 集合。文本短于 n 时退化为整串，保证只有完全相同才判等。
pub fn char_ngrams(text: &str, n: usize) -> HashSet<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < n {
        let mut set = HashSet::new();
        if !chars.is_empty() {
            set.insert(chars.iter().collect::<String>());
        }
        return set;
    }
    chars
        .windows(n)
        .map(|window| window.iter().collect())
        .collect()
}

pub fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        return 1.0;
    }
    intersection as f64 / union as f64
}

/// 两条 prompt 的相似度（0.0~1.0）。
pub fn similarity(a: &str, b: &str) -> f64 {
    let left = char_ngrams(&normalize(a), NGRAM_SIZE);
    let right = char_ngrams(&normalize(b), NGRAM_SIZE);
    jaccard(&left, &right)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemovedItem {
    pub item: PromptItem,
    /// 被合并进的保留条目文本。
    pub merged_into: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DedupeReport {
    pub kept: Vec<PromptItem>,
    pub removed: Vec<RemovedItem>,
    /// 去重后仍存在的高相似条目对数，验收要求为 0。
    pub duplicate_pairs: usize,
}

impl DedupeReport {
    pub fn kept_count(&self) -> usize {
        self.kept.len()
    }

    pub fn removed_count(&self) -> usize {
        self.removed.len()
    }
}

/// 对 prompt 列表去重。保留输入顺序，重复时保留 weight 较高者。
pub fn dedupe(items: Vec<PromptItem>) -> DedupeReport {
    let mut kept: Vec<PromptItem> = Vec::with_capacity(items.len());
    let mut kept_grams: Vec<HashSet<String>> = Vec::with_capacity(items.len());
    let mut removed: Vec<RemovedItem> = Vec::new();

    for item in items {
        let grams = char_ngrams(&normalize(&item.text), NGRAM_SIZE);
        let hit = kept_grams
            .iter()
            .enumerate()
            .find(|(_, existing)| jaccard(existing, &grams) >= DUPLICATE_THRESHOLD)
            .map(|(index, _)| index);

        match hit {
            None => {
                kept.push(item);
                kept_grams.push(grams);
            }
            Some(index) => {
                let replace = item.weight > kept[index].weight;
                let (survivor, loser) = if replace {
                    let previous = std::mem::replace(&mut kept[index], item);
                    (kept[index].clone(), previous)
                } else {
                    (kept[index].clone(), item)
                };
                merge_into(&mut kept[index], &loser);
                if replace {
                    kept_grams[index] = char_ngrams(&normalize(&kept[index].text), NGRAM_SIZE);
                }
                let _ = survivor;
                removed.push(RemovedItem {
                    item: loser,
                    merged_into: kept[index].text.clone(),
                });
            }
        }
    }

    let duplicate_pairs = count_duplicate_pairs(&kept);
    DedupeReport {
        kept,
        removed,
        duplicate_pairs,
    }
}

fn merge_into(target: &mut PromptItem, source: &PromptItem) {
    for tag in &source.tags {
        if !target.tags.contains(tag) {
            target.tags.push(tag.clone());
        }
    }
    for competitor in &source.competitor_ids {
        if !target.competitor_ids.contains(competitor) {
            target.competitor_ids.push(*competitor);
        }
    }
    target.weight = target.weight.max(source.weight);
    target.repeat_count = target.repeat_count.max(source.repeat_count);
}

fn count_duplicate_pairs(items: &[PromptItem]) -> usize {
    let grams: Vec<HashSet<String>> = items
        .iter()
        .map(|item| char_ngrams(&normalize(&item.text), NGRAM_SIZE))
        .collect();
    let mut pairs = 0;
    for left in 0..grams.len() {
        for right in (left + 1)..grams.len() {
            if jaccard(&grams[left], &grams[right]) >= DUPLICATE_THRESHOLD {
                pairs += 1;
            }
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{CompetitorId, PromptSetId};
    use crate::prompt::{IntentCategory, PromptSource};

    fn item(text: &str, weight: u8) -> PromptItem {
        PromptItem::new(PromptSetId::new(), text, IntentCategory::CategoryAwareness)
            .with_weight(weight)
    }

    #[test]
    fn normalize_strips_whitespace_fullwidth_and_punctuation() {
        assert_eq!(normalize("ＡＢＣ　１２３，。"), "abc123");
        assert_eq!(normalize("国内做 水泵的厂家？"), "国内做水泵的厂家");
        assert_eq!(normalize("A-B_C"), "abc");
    }

    #[test]
    fn similarity_is_high_for_near_duplicates() {
        let score = similarity("国内做工业水泵的厂家有哪些？", "国内做工业水泵的厂家有哪些");
        assert!(score >= DUPLICATE_THRESHOLD, "实际 {score}");
    }

    #[test]
    fn similarity_is_low_for_different_questions() {
        let score = similarity(
            "预算10万以内工业水泵推荐哪几家？",
            "工业水泵售后怎么样？有没有投诉案例？",
        );
        assert!(score < 0.5, "实际 {score}");
    }

    #[test]
    fn short_texts_only_match_when_identical() {
        assert_eq!(similarity("水泵", "水泵"), 1.0);
        assert!(similarity("水泵", "风机") < DUPLICATE_THRESHOLD);
    }

    #[test]
    fn empty_input_yields_empty_report() {
        let report = dedupe(vec![]);
        assert_eq!(report.kept_count(), 0);
        assert_eq!(report.removed_count(), 0);
        assert_eq!(report.duplicate_pairs, 0);
    }

    #[test]
    fn keeps_higher_weight_and_merges_metadata() {
        let competitor = CompetitorId::new();
        let mut low = item("国内做工业水泵的厂家有哪些？", 2);
        low.tags = vec!["核心词".to_string()];
        low.competitor_ids = vec![competitor];
        low.source = PromptSource::Template;
        let high = item("国内做工业水泵的厂家有哪些", 5);

        let report = dedupe(vec![low.clone(), high.clone()]);
        assert_eq!(report.kept_count(), 1);
        assert_eq!(report.removed_count(), 1);
        assert_eq!(report.duplicate_pairs, 0);

        let kept = &report.kept[0];
        assert_eq!(kept.weight, 5, "保留 weight 高者");
        assert_eq!(kept.text, high.text);
        assert_eq!(kept.tags, vec!["核心词".to_string()], "标签应并入保留条目");
        assert_eq!(kept.competitor_ids, vec![competitor]);
        assert_eq!(report.removed[0].merged_into, high.text);
        assert_eq!(report.removed[0].item.text, low.text);
    }

    #[test]
    fn keeps_first_when_weight_ties() {
        let first = item("国内做工业水泵的厂家有哪些？", 3);
        let second = item("国内做工业水泵的厂家有哪些", 3);
        let report = dedupe(vec![first.clone(), second]);
        assert_eq!(report.kept_count(), 1);
        assert_eq!(report.kept[0].text, first.text);
    }

    #[test]
    fn distinct_items_are_all_kept() {
        let items = vec![
            item("国内做工业水泵的厂家有哪些？", 3),
            item("预算10万以内工业水泵推荐哪几家？", 4),
            item("工业水泵的国标认证要求是什么？", 3),
            item("上海有没有靠谱的水泵维修服务商？", 3),
        ];
        let report = dedupe(items.clone());
        assert_eq!(report.kept_count(), 4);
        assert_eq!(report.removed_count(), 0);
        assert_eq!(report.duplicate_pairs, 0);
        assert_eq!(
            report
                .kept
                .iter()
                .map(|i| i.text.clone())
                .collect::<Vec<_>>(),
            items.iter().map(|i| i.text.clone()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn repeat_count_takes_maximum_on_merge() {
        let mut a = item("国内做工业水泵的厂家有哪些？", 3);
        a.repeat_count = 3;
        let b = item("国内做工业水泵的厂家有哪些", 3);
        let report = dedupe(vec![a, b]);
        assert_eq!(report.kept[0].repeat_count, 3);
    }
}
