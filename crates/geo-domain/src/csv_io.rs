//! CSV 导入导出：prompt 题库、竞品清单与资产清单。
//!
//! 列顺序即契约；表头缺列直接报错（不静默），行级错误逐行回报（允许部分成功）。

use std::collections::BTreeMap;
use std::fmt;

use csv::{ReaderBuilder, Writer};
use serde::{Deserialize, Serialize};

use crate::asset::ProjectAsset;
use crate::error::GeoError;
use crate::ids::PromptSetId;
use crate::project::Competitor;
use crate::prompt::{
    IntentCategory, PromptItem, PromptSource, MAX_PROMPT_CHARS, MAX_REPEAT_COUNT, MAX_WEIGHT,
};

pub const PROMPT_CSV_HEADER: [&str; 7] = [
    "text",
    "intent",
    "weight",
    "group_name",
    "tags",
    "source",
    "repeat_count",
];
pub const COMPETITOR_CSV_HEADER: [&str; 5] = ["name", "aliases", "website", "note", "position"];
pub const ASSET_CSV_HEADER: [&str; 4] = ["kind", "url", "title", "note"];

/// tags 单元格内的分隔符（避免与 CSV 逗号混淆）。
const TAG_SEPARATOR: char = ';';

/// CSV 单行失败。**行号 + 目录 key + 语言中立参数**，不含任何自然语言：
/// 前端（`CsvToolbar`）按 `reason` 查词典、用 `params` 插值，与 `IpcError` 同构。
///
/// `reason` 取 `crates/geo-domain/src/error.rs` 模块注释那张目录表里的 key；
/// `params` 是该 key 的配套参数（`value` / `limit` / `expected`）。
/// 合规那一支直接透传 `compliance::check()` 的 `GeoError::params()`（裁定 R-C），
/// 因此除配套参数外还会带 `field` 与 `reason` 两个基础键——**原样透传、不重写字面量**，
/// 命中词是数据不是文案，渲不渲染由词典决定（裁定 §J）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CsvRowError {
    /// CSV 物理行号（表头为第 1 行）。
    pub row: usize,
    pub reason: String,
    /// 该 reason key 的配套参数。`default` 是为了兼容升级前落库/序列化的旧载荷。
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

/// `parse_prompt_row` 的失败形态（crate 内私有）。
///
/// **刻意不经 `GeoError` 构造**（裁定 R-B）：① 行级失败本来就不是 `GeoError`
/// （它是 `Result<_, String>` 的产物），硬套 `GeoError` 只为拿 key 是绕路；
/// ② 这样 `csv_io.rs` 的 `GeoError::{validation,conflict,config}(` 生产站点数
/// 保持 **10** 不变，`crates/geo-domain/tests/reason_key_sites.rs` 的反向计数守卫
/// 原地绿，不必改它。
#[derive(Debug, Clone, PartialEq)]
struct RowFailure {
    reason: String,
    params: BTreeMap<String, String>,
}

impl RowFailure {
    fn new(reason: &str) -> Self {
        Self {
            reason: reason.to_string(),
            params: BTreeMap::new(),
        }
    }

    /// 链式追加一个语言中立参数（`value` / `limit` / `expected`）。
    fn with_param(mut self, key: &str, value: impl fmt::Display) -> Self {
        self.params.insert(key.to_string(), value.to_string());
        self
    }

    /// 复用领域自己的映射（裁定 R-C）：`compliance::check` 返回的 `GeoError`
    /// 已经带 `reason="not_allowed"` + `value=命中词`，原样搬过来，不在这里重写字面量。
    fn from_geo(error: &GeoError) -> Self {
        let params = error.params();
        let reason = params.get("reason").cloned().unwrap_or_default();
        Self { reason, params }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CsvImportResult {
    pub items: Vec<PromptItem>,
    pub errors: Vec<CsvRowError>,
}

impl CsvImportResult {
    pub fn imported_count(&self) -> usize {
        self.items.len()
    }

    pub fn error_count(&self) -> usize {
        self.errors.len()
    }
}

pub fn prompts_to_csv(items: &[PromptItem]) -> Result<String, GeoError> {
    let mut writer = Writer::from_writer(Vec::new());
    writer
        .write_record(PROMPT_CSV_HEADER)
        .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    for item in items {
        let record = [
            item.text.clone(),
            item.intent.as_str().to_string(),
            item.weight.to_string(),
            item.group_name.clone().unwrap_or_default(),
            item.tags.join(&TAG_SEPARATOR.to_string()),
            item.source.as_str().to_string(),
            item.repeat_count.to_string(),
        ];
        writer
            .write_record(&record)
            .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    // 加 BOM，保证 Excel 打开中文不乱码
    let mut out = String::from("\u{FEFF}");
    out.push_str(&String::from_utf8_lossy(&bytes));
    Ok(out)
}

/// 解析 prompt CSV。表头缺列返回 `Err`；单行非法记入 `errors` 并继续。
pub fn prompts_from_csv(raw: &str, set_id: PromptSetId) -> Result<CsvImportResult, GeoError> {
    let content = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|err| GeoError::conflict("parse_failed").with_param("value", err))?
        .clone();
    let columns: Vec<String> = headers
        .iter()
        .map(|value| value.trim().to_string())
        .collect();
    let mut missing: Vec<&str> = Vec::new();
    for required in PROMPT_CSV_HEADER {
        if !columns.iter().any(|column| column == required) {
            missing.push(required);
        }
    }
    if !missing.is_empty() {
        return Err(GeoError::validation("csv_header", "missing_header")
            .with_param("value", missing.join(", ")));
    }
    let index_of = |name: &str| columns.iter().position(|column| column == name).unwrap();

    let mut result = CsvImportResult::default();
    for record in reader.records() {
        let record = match record {
            Ok(record) => record,
            Err(err) => {
                // csv 库自己读不出这一物理行：`row_invalid` + `value` = 库原文
                // （目录语义规则 3：解析器库返回的 Error 走 `parse_failed`/`row_invalid`，
                // `value` 装原文）。
                result.errors.push(CsvRowError {
                    row: err.position().map(|pos| pos.line() as usize).unwrap_or(0),
                    reason: "row_invalid".to_string(),
                    params: BTreeMap::from([("value".to_string(), err.to_string())]),
                });
                continue;
            }
        };
        let row = record
            .position()
            .map(|pos| pos.line() as usize)
            .unwrap_or(0);
        let cell = |name: &str| record.get(index_of(name)).unwrap_or("").trim().to_string();
        match parse_prompt_row(&cell, set_id, result.items.len() as i32) {
            Ok(item) => result.items.push(item),
            Err(failure) => result.errors.push(CsvRowError {
                row,
                reason: failure.reason,
                params: failure.params,
            }),
        }
    }
    Ok(result)
}

/// 逐列判据一律发目录 key + 配套参数（裁定 R-D 把参数定死）：
/// 留空 → `required`；字符数超限 → `too_long` + `limit`（**不带「字」**）；
/// 我们自己的取值判据不通过（intent / weight / repeat_count / source 非法）→
/// `invalid_format` + `value`=原始串；数值越界 → `out_of_range` + `expected`=`1~{MAX}` + `value`；
/// 命中广告法红线词 → `not_allowed` + `value`=命中词（透传 `compliance::check` 的 params）。
fn parse_prompt_row(
    cell: &dyn Fn(&str) -> String,
    set_id: PromptSetId,
    position: i32,
) -> Result<PromptItem, RowFailure> {
    let text = cell("text");
    if text.is_empty() {
        return Err(RowFailure::new("required"));
    }
    if text.chars().count() > MAX_PROMPT_CHARS {
        return Err(RowFailure::new("too_long").with_param("limit", MAX_PROMPT_CHARS));
    }
    // 导入的清单会直接变成采集用的抽样内容，所以红线检查不能只在生成/编辑环节做：
    // 「导出 → Excel 里改词 → 再导入」否则就是一条现成的绕过路径。
    if let Err(error) = crate::compliance::check(&text) {
        return Err(RowFailure::from_geo(&error));
    }
    let intent_raw = cell("intent");
    let intent = IntentCategory::parse(&intent_raw)
        .ok_or_else(|| RowFailure::new("invalid_format").with_param("value", &intent_raw))?;
    let weight_raw = cell("weight");
    let weight = if weight_raw.is_empty() {
        3
    } else {
        weight_raw
            .parse::<u8>()
            .map_err(|_| RowFailure::new("invalid_format").with_param("value", &weight_raw))?
    };
    if !(1..=MAX_WEIGHT).contains(&weight) {
        return Err(RowFailure::new("out_of_range")
            .with_param("expected", format!("1~{MAX_WEIGHT}"))
            .with_param("value", weight));
    }
    let repeat_raw = cell("repeat_count");
    let repeat_count = if repeat_raw.is_empty() {
        1
    } else {
        repeat_raw
            .parse::<u8>()
            .map_err(|_| RowFailure::new("invalid_format").with_param("value", &repeat_raw))?
    };
    if !(1..=MAX_REPEAT_COUNT).contains(&repeat_count) {
        return Err(RowFailure::new("out_of_range")
            .with_param("expected", format!("1~{MAX_REPEAT_COUNT}"))
            .with_param("value", repeat_count));
    }
    let source_raw = cell("source");
    let source = if source_raw.is_empty() {
        PromptSource::Imported
    } else {
        PromptSource::parse(&source_raw)
            .ok_or_else(|| RowFailure::new("invalid_format").with_param("value", &source_raw))?
    };
    let group_name = cell("group_name");
    let tags_raw = cell("tags");
    let tags: Vec<String> = if tags_raw.is_empty() {
        Vec::new()
    } else {
        tags_raw
            .split(TAG_SEPARATOR)
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(str::to_string)
            .collect()
    };

    let mut item = PromptItem::new(set_id, text, intent)
        .with_weight(weight)
        .with_tags(tags);
    item.source = source;
    item.repeat_count = repeat_count;
    item.position = position;
    item.group_name = if group_name.is_empty() {
        Some(intent.label_zh().to_string())
    } else {
        Some(group_name)
    };
    Ok(item)
}

pub fn competitors_to_csv(competitors: &[Competitor]) -> Result<String, GeoError> {
    let mut writer = Writer::from_writer(Vec::new());
    writer
        .write_record(COMPETITOR_CSV_HEADER)
        .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    for competitor in competitors {
        writer
            .write_record(&[
                competitor.name.clone(),
                competitor.aliases.join(&TAG_SEPARATOR.to_string()),
                competitor.website.clone().unwrap_or_default(),
                competitor.note.clone().unwrap_or_default(),
                competitor.position.to_string(),
            ])
            .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    }
    finish(writer)
}

pub fn assets_to_csv(assets: &[ProjectAsset]) -> Result<String, GeoError> {
    let mut writer = Writer::from_writer(Vec::new());
    writer
        .write_record(ASSET_CSV_HEADER)
        .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    for asset in assets {
        let kind: serde_json::Value = serde_json::to_value(asset.kind)?;
        writer
            .write_record(&[
                kind.as_str().unwrap_or("other").to_string(),
                asset.url.clone(),
                asset.title.clone().unwrap_or_default(),
                asset.note.clone().unwrap_or_default(),
            ])
            .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    }
    finish(writer)
}

fn finish(writer: Writer<Vec<u8>>) -> Result<String, GeoError> {
    let bytes = writer
        .into_inner()
        .map_err(|err| GeoError::conflict("write_failed").with_param("value", err))?;
    let mut out = String::from("\u{FEFF}");
    out.push_str(&String::from_utf8_lossy(&bytes));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset::AssetKind;
    use crate::ids::{AssetId, CompetitorId, ProjectId};
    use chrono::{DateTime, Utc};

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
    }

    fn sample_items(set_id: PromptSetId) -> Vec<PromptItem> {
        let mut first = PromptItem::new(
            set_id,
            "国内做工业水泵的厂家有哪些？各自特点是什么？",
            IntentCategory::CategoryAwareness,
        )
        .with_weight(4)
        .with_tags(vec!["核心词".to_string(), "水泵".to_string()]);
        first.repeat_count = 2;
        first.source = PromptSource::Generated;
        first.position = 0;
        let mut second = PromptItem::new(
            set_id,
            "预算10万以内，工业水泵推荐哪几家？为什么？",
            IntentCategory::PurchaseRecommendation,
        );
        second.position = 1;
        vec![first, second]
    }

    #[test]
    fn prompt_csv_roundtrip_preserves_data() {
        let set_id = PromptSetId::new();
        let items = sample_items(set_id);
        let csv = prompts_to_csv(&items).unwrap();
        assert!(csv.starts_with('\u{FEFF}'), "应带 BOM 以便 Excel 识别");
        let result = prompts_from_csv(&csv, set_id).unwrap();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.items.len(), 2);
        for (original, imported) in items.iter().zip(result.items.iter()) {
            assert_eq!(original.text, imported.text);
            assert_eq!(original.intent, imported.intent);
            assert_eq!(original.weight, imported.weight);
            assert_eq!(original.tags, imported.tags);
            assert_eq!(original.source, imported.source);
            assert_eq!(original.repeat_count, imported.repeat_count);
            assert_eq!(original.group_name, imported.group_name);
        }
    }

    #[test]
    fn csv_handles_quotes_and_commas_in_text() {
        let set_id = PromptSetId::new();
        let mut item = PromptItem::new(
            set_id,
            "问：\"水泵\"，哪家好？,真的",
            IntentCategory::BrandComparison,
        );
        item.position = 0;
        let csv = prompts_to_csv(&[item.clone()]).unwrap();
        let result = prompts_from_csv(&csv, set_id).unwrap();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.items[0].text, item.text);
    }

    #[test]
    fn missing_header_column_is_rejected() {
        let err = prompts_from_csv("text,weight\n问题,3\n", PromptSetId::new()).unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert!(err.user_message().contains("intent"));
        assert!(err.user_message().contains("source"));
    }

    #[test]
    fn invalid_row_is_reported_with_line_number_and_others_succeed() {
        let csv = "text,intent,weight,group_name,tags,source,repeat_count\n\
问题一,category_awareness,3,,,,\n\
问题二,category_awareness,9,,,,\n\
问题三,unknown_intent,3,,,,\n\
问题四,pricing_plan,3,,核心词,template,1\n";
        let result = prompts_from_csv(csv, PromptSetId::new()).unwrap();
        assert_eq!(result.imported_count(), 2);
        assert_eq!(result.error_count(), 2);
        assert_eq!(result.errors[0].row, 3, "weight 非法在第 3 行");
        assert_eq!(result.errors[0].reason, "out_of_range");
        assert_eq!(result.errors[1].row, 4);
        assert_eq!(result.errors[1].reason, "invalid_format");
        assert_eq!(result.items[1].tags, vec!["核心词".to_string()]);
        assert_eq!(
            result.items[0].source,
            PromptSource::Imported,
            "source 缺省为 imported"
        );
    }

    #[test]
    fn empty_text_row_is_rejected() {
        let csv = "text,intent,weight,group_name,tags,source,repeat_count\n ,pricing_plan,3,,,,\n";
        let result = prompts_from_csv(csv, PromptSetId::new()).unwrap();
        assert_eq!(result.imported_count(), 0);
        assert_eq!(result.errors[0].reason, "required");
    }

    /// 导出 → Excel 里加一句「保证排名」→ 再导入，是绕过红线检查的现成路径，
    /// 而导入结果会直接变成采集用的抽样清单，所以导入行必须同样过合规扫描。
    #[test]
    fn import_rejects_rows_hitting_the_ad_law_red_lines() {
        let payload = "text,intent,weight,group_name,tags,source,repeat_count\n\
                       宏宇泵业保证排名第一,category_awareness,3,品类认知,,manual,1\n\
                       宏宇泵业的水泵多少钱一台,pricing_plan,3,价格方案,,manual,1\n";
        let result = prompts_from_csv(payload, PromptSetId::new()).unwrap();
        assert_eq!(result.imported_count(), 1, "干净行照常导入");
        assert_eq!(result.error_count(), 1);
        assert_eq!(result.errors[0].row, 2, "行号要能对上物理行");
        assert_eq!(result.errors[0].reason, "not_allowed");
    }

    /// 行级错误的**逐处映射**：`reason` 是目录 key，`params` 恰好是该 key 登记的配套参数
    /// （裁定 R-D 把参数定死）。全部经生产函数 `prompts_from_csv` 触发。
    #[test]
    fn row_errors_carry_directory_keys_and_language_neutral_params() {
        let long = "长".repeat(MAX_PROMPT_CHARS + 1);
        // 一行只坏一列：`parse_prompt_row` 是顺序判据，一个单元格坏了就轮不到后面的列。
        let mut payload = String::from("text,intent,weight,group_name,tags,source,repeat_count\n");
        payload.push_str(",category_awareness,3,,,,\n");
        payload.push_str(&format!("{long},category_awareness,3,,,,\n"));
        payload.push_str("这个水泵100%好用,category_awareness,3,,,,\n");
        payload.push_str("意图写错,not_an_intent,3,,,,\n");
        payload.push_str("权重不是数字,category_awareness,abc,,,,\n");
        payload.push_str("权重越界,category_awareness,9,,,,\n");
        payload.push_str("采样不是数字,category_awareness,3,,,,x\n");
        payload.push_str("采样越界,category_awareness,3,,,,7\n");
        payload.push_str("来源非法,category_awareness,3,,,nope,\n");

        let result = prompts_from_csv(&payload, PromptSetId::new()).expect("表头合法");
        assert_eq!(result.imported_count(), 0, "每一行都该被拒");
        assert_eq!(result.error_count(), 9, "{:?}", result.errors);

        let expect = |index: usize, reason: &str, extra: &[(&str, &str)]| {
            let error = &result.errors[index];
            assert_eq!(error.reason, reason, "第 {} 条行错误", index + 1);
            for (key, value) in extra {
                assert_eq!(
                    error.params.get(*key).map(String::as_str),
                    Some(*value),
                    "第 {} 条行错误的 params[{key:?}]：{:?}",
                    index + 1,
                    error.params
                );
            }
        };

        // 第 1 行：text 留空 → `required`，目录登记它不带任何配套参数
        expect(0, "required", &[]);
        assert_eq!(result.errors[0].params.len(), 0, "{:?}", result.errors[0]);
        // 第 2 行：字符数超限 → `too_long` + `limit`（数字，**不带「字」**）
        expect(1, "too_long", &[("limit", "300")]);
        assert_eq!(result.errors[1].params.len(), 1);
        // 第 3 行：命中广告法红线词 → 透传 `compliance::check` 的 params（裁定 R-C / §J）
        expect(2, "not_allowed", &[("value", "100%")]);
        assert_eq!(
            result.errors[2].params["field"], "content",
            "R-C 要求原样透传领域的 params，因此带 `field`：{:?}",
            result.errors[2].params
        );
        assert_eq!(result.errors[2].params["reason"], "not_allowed");
        // 第 4~9 行：逐列判据
        expect(3, "invalid_format", &[("value", "not_an_intent")]);
        expect(4, "invalid_format", &[("value", "abc")]);
        expect(5, "out_of_range", &[("expected", "1~5"), ("value", "9")]);
        expect(6, "invalid_format", &[("value", "x")]);
        expect(7, "out_of_range", &[("expected", "1~3"), ("value", "7")]);
        expect(8, "invalid_format", &[("value", "nope")]);

        // 行号是 CSV **物理行号**（表头为第 1 行）
        let line_numbers: Vec<usize> = result.errors.iter().map(|error| error.row).collect();
        assert_eq!(
            line_numbers,
            (2..=10).collect::<Vec<_>>(),
            "{line_numbers:?}"
        );
    }

    /// 计划正文验收：`csv_io.rs` 里 `user_message()` 的**生产**用法归零。
    ///
    /// 它今天是紧凑日志串（`{code} k=v …`），而 `CsvRowError.reason` 直送 UI
    /// （`CsvToolbar` 逐字渲染），日志串与散文混排是 Task 3 留下的可见退化。
    #[test]
    fn user_message_has_no_production_use_left_in_this_file() {
        let source = include_str!("csv_io.rs");
        let production = source.split("#[cfg(test)]").next().unwrap_or(source);
        assert!(
            !production.contains("user_message()"),
            "`user_message()` 不得再进 `CsvRowError.reason`：行级错误要发目录 key + params"
        );
    }

    /// 「物理行读不出来」那一支**从公开 API 不可达**：`prompts_from_csv` 只收 `&str`
    /// （UTF-8 必然合法），reader 又是 `flexible(true)`（列数不齐不算错），
    /// 于是 `records()` 的 `Err` 只剩 IO 错误，而源是内存里的 `&[u8]`。
    /// 因此用源码字面量钉住映射（与 `tests/reason_key_sites.rs` 的 `UNREACHABLE` 同一手法）。
    #[test]
    fn the_unreachable_physical_row_failure_pins_row_invalid() {
        let source = include_str!("csv_io.rs");
        assert!(
            source.contains("\"row_invalid\""),
            "物理行失败必须发目录 key `row_invalid`"
        );
        assert!(
            source.contains("err.to_string()"),
            "`row_invalid` 必须配 `value` = csv 库原文（裁定 R-D）"
        );
    }

    #[test]
    fn competitor_and_asset_csv_have_expected_headers() {
        let project_id = ProjectId::new();
        let competitors = vec![Competitor {
            id: CompetitorId::new(),
            project_id,
            name: "SheepGeo".to_string(),
            aliases: vec![" sheep ".to_string()],
            website: Some("https://sheepgeo.example".to_string()),
            note: None,
            position: 0,
            created_at: now(),
        }];
        let csv = competitors_to_csv(&competitors).unwrap();
        assert!(csv.contains("name,aliases,website,note,position"));
        assert!(csv.contains("SheepGeo"));

        let assets = vec![ProjectAsset {
            id: AssetId::new(),
            project_id,
            kind: AssetKind::Baike,
            url: "https://baike.example/词条".to_string(),
            title: Some("品牌词条".to_string()),
            note: None,
            created_at: now(),
        }];
        let csv = assets_to_csv(&assets).unwrap();
        assert!(csv.contains("kind,url,title,note"));
        assert!(csv.contains("baike"));
        assert!(csv.contains("品牌词条"));
    }
}
