//! 站长数据文本导入的**纯解析器**（M5.5，A2a：百度《AI 流量分析》五列）。
//!
//! 输入是前端已解码的 TSV / CSV 文本（xlsx 由前端先解成 TSV，与 DR-98 的口径一致）。
//! 本模块不碰数据库、不写源状态：只把行分成好行与行级错误，并给出 AI 汇总 / 平台独有留档。
//!
//! 🔴 只承诺 Baidu AI 的五列（`关键词|AI引用量|AI曝光量|AI点击量|AI点击率`，页面表首列 `页面`），
//! 以及我们自己的规范列名；其它源的映射表在后续切片补（E-67 ③ / E-72）。

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::GeoError;
use crate::ids::{ProjectId, SearchAiOverviewId, SearchMetricId, SearchNativeExtraId};
use crate::search::SearchSourceKind;
use crate::search_metrics::{
    SearchAiOverview, SearchCompleteness, SearchNativeExtra, SearchQueryMetric, SearchSurface,
    WindowSource,
};

/// 与 `apps/desktop/ui/src/api/search-mapping.ts` 的 `MAPPING_VERSION` 逐字一致。
pub const MAPPING_VERSION: &str = "2026-10-12.1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchTableError {
    pub row: u32,
    pub reason: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchTableWarning {
    pub row: u32,
    pub kind: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedSearchImport {
    pub metrics: Vec<SearchQueryMetric>,
    pub ai_overviews: Vec<SearchAiOverview>,
    pub native_extras: Vec<SearchNativeExtra>,
    pub errors: Vec<SearchTableError>,
    pub warnings: Vec<SearchTableWarning>,
}

pub struct ParseInput<'a> {
    pub payload: &'a str,
    pub project_id: ProjectId,
    pub kind: SearchSourceKind,
    pub period_start: &'a str,
    pub period_end: &'a str,
    pub data_through: &'a str,
    pub imported_at: DateTime<Utc>,
}

#[derive(Clone, Copy, PartialEq)]
enum Column {
    Query,
    PageUrl,
    Impressions,
    Clicks,
    CtrCheck,
    Citations,
    AiClicks,
    AiCtrCheck,
    CitedPages,
}

fn canonical(header: &str) -> Option<Column> {
    match header.trim() {
        "关键词" | "query" => Some(Column::Query),
        "页面" | "page_url" => Some(Column::PageUrl),
        "AI曝光量" | "曝光量" | "展现量" | "impressions" => Some(Column::Impressions),
        "AI点击量" | "点击量" | "clicks" => Some(Column::Clicks),
        "AI点击率" | "点击率" | "ctr_check" => Some(Column::CtrCheck),
        "AI引用量" | "citations" => Some(Column::Citations),
        "ai_clicks" => Some(Column::AiClicks),
        "ai_ctr_check" => Some(Column::AiCtrCheck),
        "AI引用页面量" | "cited_pages" => Some(Column::CitedPages),
        _ => None,
    }
}

fn parse_int(cell: &str) -> Result<Option<i64>, ()> {
    let text = cell.trim().replace(',', "");
    if text.is_empty() {
        return Ok(None);
    }
    text.parse::<i64>().map(Some).map_err(|_| ())
}

/// 解析「点击率」单元格。
///
/// 🔴 必须认 `%`：2026-11-18 的真机录制样本（`fixtures/search-browser/`）确认，
/// 百度站长页面上的点击率是 **`44.20%` / `0.00%`** 这种带百分号的文本。
/// 而内部口径一律是**小数**（`ratio()` 算出来的就是 0.4420），两者要能直接比较。
/// 原来只 strip 逗号不认 `%`，导致 `44.20%` 解析失败 ——
/// 实测「流量与关键词」页 **10 行全部 `invalid_format`、metrics=0**，
/// 也就是说浏览器取数在真实数据上一直是坏的（不是因为规则包）。
///
/// 语义：带 `%` → 去号后除以 100；不带 `%` → 按小数原样接受
/// （部分导出/接口给的就是 0.4420，两种形态都要能吃）。
///
/// 🔴 它**取代**了原来的 `parse_float`：后者唯一的调用点就是这两处 CtrCheck，
///    换成百分比感知的版本后就成了死代码，已删除（不留 `#[allow(dead_code)]`——
///    留着只会让下一个人以为它还有用）。
fn parse_percent(cell: &str) -> Result<Option<f64>, ()> {
    let text = cell.trim().replace(',', "");
    if text.is_empty() {
        return Ok(None);
    }
    // 🔴 真实导出里"无数据"常用占位符表示。2026-11-18 录制样本里
    //    「索引量」表就出现过 `--`（`变化情况` 列）。这些必须当作 None，
    //    而不是 invalid_format —— 否则一行里只要有一个空指标，整行就被丢掉。
    if matches!(text.as_str(), "-" | "--" | "—" | "N/A" | "n/a") {
        return Ok(None);
    }
    if let Some(number) = text.strip_suffix('%') {
        return number
            .trim()
            .parse::<f64>()
            .map(|v| Some(v / 100.0))
            .map_err(|_| ());
    }
    text.parse::<f64>().map(Some).map_err(|_| ())
}

fn ratio(numerator: Option<i64>, denominator: Option<i64>) -> Option<f64> {
    match (numerator, denominator) {
        (Some(numerator), Some(denominator)) if denominator > 0 => {
            Some(numerator as f64 / denominator as f64)
        }
        _ => None,
    }
}

fn data_through(input: &ParseInput<'_>) -> String {
    input.data_through.to_string()
}

/// 解析一张 Baidu AI / 规范列名的表。表头级错误才返回 `Err`；行级错误进 `errors`。
pub fn parse_search_table(input: ParseInput<'_>) -> Result<ParsedSearchImport, GeoError> {
    let delimiter = if input
        .payload
        .lines()
        .next()
        .is_some_and(|line| line.contains('\t'))
    {
        b'\t'
    } else {
        b','
    };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(input.payload.as_bytes());
    let records: Vec<csv::StringRecord> = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| GeoError::validation("payload", "invalid_format"))?;
    if records.is_empty() {
        return Err(GeoError::validation("payload", "empty"));
    }

    let header: Vec<String> = records[0]
        .iter()
        .map(|cell| cell.trim().to_string())
        .collect();
    let mut columns: Vec<Option<Column>> = Vec::with_capacity(header.len());
    let mut extras: Vec<(usize, String)> = Vec::new();
    for (index, name) in header.iter().enumerate() {
        match canonical(name) {
            Some(column) => columns.push(Some(column)),
            None => {
                columns.push(None);
                extras.push((index, name.clone()));
            }
        }
    }
    let has = |column: Column| columns.contains(&Some(column));
    let summary = !has(Column::Query)
        && !has(Column::PageUrl)
        && (has(Column::AiCtrCheck) || (has(Column::Citations) && has(Column::AiClicks)));
    let row_table = has(Column::Query) || has(Column::PageUrl);
    if !summary && !row_table {
        return Err(GeoError::validation("payload", "missing_header"));
    }

    let mut parsed = ParsedSearchImport {
        metrics: Vec::new(),
        ai_overviews: Vec::new(),
        native_extras: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    if summary {
        parse_summary(&input, &records, &columns, &extras, &mut parsed);
    } else {
        parse_rows(&input, &records, &columns, &extras, &mut parsed);
    }
    Ok(parsed)
}

fn parse_summary(
    input: &ParseInput<'_>,
    records: &[csv::StringRecord],
    columns: &[Option<Column>],
    extras: &[(usize, String)],
    parsed: &mut ParsedSearchImport,
) {
    let Some(record) = records
        .iter()
        .skip(1)
        .find(|row| row.iter().any(|cell| !cell.trim().is_empty()))
    else {
        return;
    };
    let row_number = 2 + records
        .iter()
        .skip(1)
        .position(|row| std::ptr::eq(row, record))
        .unwrap_or(0) as u32;
    let cell = |column: Column| {
        record
            .get(
                columns
                    .iter()
                    .position(|value| *value == Some(column))
                    .unwrap_or(usize::MAX),
            )
            .unwrap_or("")
    };
    let mut errors = Vec::new();
    let mut number = |column: Column, field: &str| match parse_int(cell(column)) {
        Ok(value) => value,
        Err(()) => {
            errors.push(SearchTableError {
                row: row_number,
                reason: "invalid_format".to_string(),
                params: BTreeMap::from([
                    ("column".to_string(), field.to_string()),
                    ("value".to_string(), cell(column).to_string()),
                ]),
            });
            None
        }
    };
    let citations = number(Column::Citations, "citations");
    let impressions = number(Column::Impressions, "impressions");
    let ai_clicks = number(Column::AiClicks, "ai_clicks");
    let cited_pages = number(Column::CitedPages, "cited_pages");
    let given = match parse_percent(cell(Column::CtrCheck)) {
        Ok(value) => value,
        Err(()) => {
            errors.push(SearchTableError {
                row: row_number,
                reason: "invalid_format".to_string(),
                params: BTreeMap::from([
                    ("column".to_string(), "ctr_check".to_string()),
                    ("value".to_string(), cell(Column::CtrCheck).to_string()),
                ]),
            });
            None
        }
    };
    if !errors.is_empty() {
        parsed.errors.extend(errors);
        return;
    }
    let computed = ratio(ai_clicks, citations);
    if let (Some(given), Some(computed)) = (given, computed) {
        if (given - computed).abs() > 0.01 {
            parsed.warnings.push(SearchTableWarning {
                row: row_number,
                kind: "ctr_mismatch".to_string(),
                params: BTreeMap::from([
                    ("given".to_string(), format!("{given:.4}")),
                    ("recalculated".to_string(), format!("{computed:.4}")),
                ]),
            });
        }
    }
    let overview = SearchAiOverview {
        id: SearchAiOverviewId::new(),
        project_id: input.project_id,
        source_kind: input.kind,
        citations,
        ai_impressions: impressions,
        ai_clicks,
        ai_ctr: computed,
        cited_pages,
        period_start: input.period_start.to_string(),
        period_end: input.period_end.to_string(),
        data_through: data_through(input),
        imported_at: input.imported_at,
        completeness: SearchCompleteness::Partial,
        window_source: WindowSource::UserStated,
        mapping_version: MAPPING_VERSION.to_string(),
    };
    if let Some(value) = cited_pages {
        parsed.native_extras.push(SearchNativeExtra {
            id: SearchNativeExtraId::new(),
            project_id: input.project_id,
            source_kind: input.kind,
            label: "AI引用页面量".to_string(),
            value: Some(serde_json::json!(value)),
            metric_id: None,
            observed_at: input.imported_at,
        });
    }
    for (index, label) in extras {
        let value = record.get(*index).unwrap_or("").trim();
        if !value.is_empty() {
            parsed.native_extras.push(SearchNativeExtra {
                id: SearchNativeExtraId::new(),
                project_id: input.project_id,
                source_kind: input.kind,
                label: label.clone(),
                value: Some(serde_json::json!(value)),
                metric_id: None,
                observed_at: input.imported_at,
            });
        }
    }
    parsed.ai_overviews.push(overview);
}

fn parse_rows(
    input: &ParseInput<'_>,
    records: &[csv::StringRecord],
    columns: &[Option<Column>],
    extras: &[(usize, String)],
    parsed: &mut ParsedSearchImport,
) {
    for (offset, record) in records.iter().skip(1).enumerate() {
        if record.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        let row_number = 2 + offset as u32;
        let cell = |column: Column| {
            record
                .get(
                    columns
                        .iter()
                        .position(|value| *value == Some(column))
                        .unwrap_or(usize::MAX),
                )
                .unwrap_or("")
        };
        let query = cell(Column::Query).trim().to_string();
        let page_url = match cell(Column::PageUrl).trim() {
            "" => None,
            value => Some(value.to_string()),
        };
        if query.is_empty() && page_url.is_none() {
            parsed.errors.push(SearchTableError {
                row: row_number,
                reason: "required".to_string(),
                params: BTreeMap::from([("column".to_string(), "query, page_url".to_string())]),
            });
            continue;
        }
        let mut errors = Vec::new();
        let number =
            |column: Column, field: &str, errors: &mut Vec<SearchTableError>| match parse_int(cell(
                column,
            )) {
                Ok(value) => value,
                Err(()) => {
                    errors.push(SearchTableError {
                        row: row_number,
                        reason: "invalid_format".to_string(),
                        params: BTreeMap::from([
                            ("column".to_string(), field.to_string()),
                            ("value".to_string(), cell(column).to_string()),
                        ]),
                    });
                    None
                }
            };
        let impressions = number(Column::Impressions, "impressions", &mut errors);
        let clicks = number(Column::Clicks, "clicks", &mut errors);
        let citations = number(Column::Citations, "citations", &mut errors);
        let given = match parse_percent(cell(Column::CtrCheck)) {
            Ok(value) => value,
            Err(()) => {
                errors.push(SearchTableError {
                    row: row_number,
                    reason: "invalid_format".to_string(),
                    params: BTreeMap::from([
                        ("column".to_string(), "ctr_check".to_string()),
                        ("value".to_string(), cell(Column::CtrCheck).to_string()),
                    ]),
                });
                None
            }
        };
        if !errors.is_empty() {
            parsed.errors.extend(errors);
            continue;
        }
        let denominator = if input.kind == SearchSourceKind::BaiduZiyuanAi {
            citations
        } else {
            impressions
        };
        let computed = ratio(clicks, denominator);
        if let (Some(given), Some(computed)) = (given, computed) {
            if (given - computed).abs() > 0.01 {
                parsed.warnings.push(SearchTableWarning {
                    row: row_number,
                    kind: "ctr_mismatch".to_string(),
                    params: BTreeMap::from([
                        ("given".to_string(), format!("{given:.4}")),
                        ("recalculated".to_string(), format!("{computed:.4}")),
                    ]),
                });
            }
        }
        let metric = SearchQueryMetric {
            id: SearchMetricId::new(),
            project_id: input.project_id,
            source_kind: input.kind,
            surface: if input.kind == SearchSourceKind::BaiduZiyuanAi {
                SearchSurface::AiAnswer
            } else {
                SearchSurface::WebSearch
            },
            query,
            page_url,
            impressions,
            clicks,
            ctr: computed,
            citations,
            ai_clicks: None,
            period_start: input.period_start.to_string(),
            period_end: input.period_end.to_string(),
            data_through: data_through(input),
            imported_at: input.imported_at,
            completeness: SearchCompleteness::Partial,
            window_source: WindowSource::UserStated,
            mapping_version: MAPPING_VERSION.to_string(),
        };
        for (index, label) in extras {
            let value = record.get(*index).unwrap_or("").trim();
            if !value.is_empty() {
                parsed.native_extras.push(SearchNativeExtra {
                    id: SearchNativeExtraId::new(),
                    project_id: input.project_id,
                    source_kind: input.kind,
                    label: label.clone(),
                    value: Some(serde_json::json!(value)),
                    metric_id: Some(metric.id.to_string()),
                    observed_at: input.imported_at,
                });
            }
        }
        parsed.metrics.push(metric);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(payload: &str) -> ParseInput<'_> {
        ParseInput {
            payload,
            project_id: ProjectId::new(),
            kind: SearchSourceKind::BaiduZiyuanAi,
            period_start: "2026-09-01",
            period_end: "2026-09-30",
            data_through: "2026-09-30",
            imported_at: Utc::now(),
        }
    }

    #[test]
    fn header_only_is_success_with_no_rows() {
        let parsed =
            parse_search_table(input("关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n")).unwrap();
        assert!(parsed.metrics.is_empty());
        assert!(parsed.ai_overviews.is_empty());
        assert!(parsed.errors.is_empty());
    }

    #[test]
    fn query_rows_map_to_metrics_and_recompute_ctr_from_citations() {
        let parsed = parse_search_table(input(
            "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n工业除尘器\t40\t1200\t8\t0.2\n布袋除尘器\t20\t500\t4\t0.2\n",
        ))
        .unwrap();
        assert_eq!(parsed.metrics.len(), 2);
        assert_eq!(parsed.metrics[0].query, "工业除尘器");
        assert_eq!(parsed.metrics[0].ctr, Some(0.2));
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn ai_summary_table_maps_to_one_overview_and_cited_pages_extra() {
        let parsed = parse_search_table(input(
            "citations,impressions,ai_clicks,ai_ctr_check,cited_pages\n40,6106,8,0.2,6\n",
        ))
        .unwrap();
        assert_eq!(parsed.metrics.len(), 0);
        assert_eq!(parsed.ai_overviews.len(), 1);
        assert_eq!(parsed.ai_overviews[0].ai_ctr, Some(0.2));
        assert_eq!(parsed.native_extras.len(), 1);
        assert_eq!(parsed.native_extras[0].label, "AI引用页面量");
    }

    #[test]
    fn invalid_number_is_a_row_error_not_a_panic() {
        let parsed = parse_search_table(input(
            "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n工业除尘器\tabc\t1200\t8\t0.2\n",
        ))
        .unwrap();
        assert_eq!(parsed.metrics.len(), 0);
        assert_eq!(parsed.errors.len(), 1);
        assert_eq!(parsed.errors[0].params["column"], "citations");
    }

    #[test]
    fn unknown_header_is_missing_header() {
        let error = parse_search_table(input("foo,bar\n1,2\n")).unwrap_err();
        assert_eq!(error.params()["field"], "payload");
    }

    #[test]
    fn ctr_mismatch_is_a_warning_not_an_error() {
        let parsed = parse_search_table(input(
            "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n工业除尘器\t40\t1200\t8\t0.9\n",
        ))
        .unwrap();
        assert_eq!(parsed.metrics.len(), 1);
        assert_eq!(parsed.warnings.len(), 1);
        assert_eq!(parsed.warnings[0].kind, "ctr_mismatch");
    }
}

#[cfg(test)]
mod percent_cell_tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    /// 🔴 2026-11-18 真机录制确认：百度站长页面上的点击率是 `44.20%` 这种文本。
    ///    而 `ratio()` 算出来的是小数 0.4420，两者必须能直接比较。
    #[test]
    fn percent_sign_is_stripped_and_scaled_to_fraction() {
        assert_eq!(parse_percent("44.20%").unwrap(), Some(0.442));
        assert_eq!(parse_percent("0.00%").unwrap(), Some(0.0));
        assert_eq!(parse_percent("100%").unwrap(), Some(1.0));
        // 带空白/千分位也要吃
        assert_eq!(parse_percent(" 1,234.50% ").unwrap(), Some(12.345));
    }

    /// 部分导出/接口给的就是小数，两种形态都要能吃（否则一半样本解析不了）。
    #[test]
    fn plain_decimal_is_accepted_unchanged() {
        assert_eq!(parse_percent("0.0067").unwrap(), Some(0.0067));
        assert_eq!(parse_percent("0.442").unwrap(), Some(0.442));
        assert_eq!(parse_percent("").unwrap(), None);
        assert!(parse_percent("abc").is_err());
    }

    /// 🔴 真实导出用占位符表示"无数据"（录制样本的「索引量」表里出现过 `--`）。
    ///    必须当 None，而不是 invalid_format —— 否则一行里只要有一个空指标整行就被丢。
    #[test]
    fn missing_value_placeholders_are_none_not_errors() {
        for placeholder in ["-", "--", "—", "N/A", "n/a"] {
            assert_eq!(
                parse_percent(placeholder).unwrap(),
                None,
                "占位符 {placeholder:?}"
            );
        }
    }

    /// 🔴 真实样本端到端回归：「流量与关键词」页 10 行。
    ///    修复前实测 **metrics=0 / errors=10**（每行都因 `44.20%` 解析失败），
    ///    也就是说浏览器取数在真实数据上一直是坏的 —— 不是因为规则包。
    #[test]
    fn real_captured_keywords_page_parses_all_ten_rows() {
        const CAPTURE: &str = include_str!(
            "../../../fixtures/search-browser/baidu-ziyuan-keywords-with-data-2026-11-18.json"
        );
        let doc: serde_json::Value = serde_json::from_str(CAPTURE).expect("样本是合法 JSON");
        let table = doc["tables_tsv"][0].as_str().expect("取第一张表");

        let parsed = parse_search_table(ParseInput {
            payload: table,
            project_id: ProjectId::new(),
            kind: SearchSourceKind::BaiduZiyuan,
            period_start: "2026-11-01",
            period_end: "2026-11-30",
            data_through: "2026-11-18",
            imported_at: Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap(),
        })
        .expect("真实样本必须可解析");

        assert_eq!(parsed.metrics.len(), 10, "10 个关键词都应解析出来");
        assert_eq!(parsed.errors.len(), 0, "不应有任何行级错误");
        // 44.20% 的点击率要与 179/405 对得上 → 无 ctr_mismatch 警告
        assert!(
            parsed.warnings.is_empty(),
            "点击率与点击量/展现量应自洽，实际警告：{:?}",
            parsed
                .warnings
                .iter()
                .map(|w| w.kind.clone())
                .collect::<Vec<_>>()
        );
        let first = &parsed.metrics[0];
        // 🔴 ctr 是**重算**的（clicks / impressions），不是直接采用页面显示的 44.20%。
        //    页面显示值只做交叉校验（两者差 > 0.01 才告警）—— 显示值是四舍五入过的，
        //    直接存它会引入舍入误差。所以这里与 179/405 比，而不是与 0.442 比。
        let expected = 179.0 / 405.0;
        assert!(
            (first.ctr.unwrap_or_default() - expected).abs() < 1e-9,
            "ctr 应为重算值 {expected}，实际 {:?}",
            first.ctr
        );
        // 顺带确认它四舍五入到 2 位后就是页面显示的 44.20%
        assert_eq!(
            format!("{:.2}%", first.ctr.unwrap_or_default() * 100.0),
            "44.20%"
        );
        assert_eq!(first.clicks, Some(179));
        assert_eq!(first.impressions, Some(405));
    }

    /// 真实的「索引量」表（`索引量|变化情况|日期`）不是搜索关键词表 ——
    /// 明确报 missing_header 而不是被误当成关键词数据（否则会把索引量当曝光量统计）。
    #[test]
    fn real_captured_index_table_is_rejected_as_not_a_keyword_table() {
        const CAPTURE: &str = include_str!(
            "../../../fixtures/search-browser/baidu-ziyuan-indexs-with-data-2026-11-18.json"
        );
        let doc: serde_json::Value = serde_json::from_str(CAPTURE).expect("样本是合法 JSON");
        let table = doc["tables_tsv"][0].as_str().expect("取第一张表");
        let err = parse_search_table(ParseInput {
            payload: table,
            project_id: ProjectId::new(),
            kind: SearchSourceKind::BaiduZiyuan,
            period_start: "2026-11-01",
            period_end: "2026-11-30",
            data_through: "2026-11-18",
            imported_at: Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap(),
        })
        .expect_err("索引量表不该被当成关键词表");
        assert_eq!(err.params()["reason"], "missing_header");
    }
}

/// 🔴 AI 流量页的 el-table 拆分结构（2026-11-18 真实录制）：
/// 表头与表体是两个独立 `<table>`，提取器必须合并后才能被解析器接受。
#[cfg(test)]
mod ai_table_split_structure_tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    const CAPTURE: &str = include_str!(
        "../../../fixtures/search-browser/baidu-ziyuan-aiflow-with-data-2026-11-18.json"
    );

    fn tables() -> Vec<String> {
        let doc: serde_json::Value = serde_json::from_str(CAPTURE).expect("样本是合法 JSON");
        doc["tables_tsv"]
            .as_array()
            .expect("tables_tsv 是数组")
            .iter()
            .map(|t| t.as_str().unwrap_or_default().to_string())
            .collect()
    }

    fn parse(payload: &str) -> Result<ParsedSearchImport, GeoError> {
        parse_search_table(ParseInput {
            payload,
            project_id: ProjectId::new(),
            kind: SearchSourceKind::BaiduZiyuanAi,
            period_start: "2026-11-01",
            period_end: "2026-11-30",
            data_through: "2026-11-18",
            imported_at: Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap(),
        })
    }

    /// 样本本身必须是"表头一张表、数据行另一张表"——这是 el-table 的真实形态。
    /// 若将来有人把 fixture 改成单表，这条会红，提醒"你在改的是真实结构的证据"。
    #[test]
    fn capture_really_has_header_and_body_in_separate_tables() {
        let ts = tables();
        assert_eq!(ts.len(), 2, "真实录制应有 2 张表（表头表 + 表体表）");
        assert!(ts[0].starts_with("关键词\tAI引用量"), "表0 应是表头");
        assert_eq!(ts[1].split('\n').count(), 1, "表1 应是纯数据行、不含表头");
        assert!(
            ts[1].starts_with("示例站点app大小\t"),
            "表1 首行是数据不是表头"
        );
    }

    /// 🔴 复现 bug：不合并时（现有提取器的输出），表头表解析出 0 行，
    ///    表体表因首行被当成表头而 missing_header —— 两者都拿不到数据。
    #[test]
    fn unmerged_tables_yield_no_metrics_which_is_the_bug() {
        let ts = tables();
        // 表头表：能识别成关键词表，但没有数据行
        let header_only = parse(&ts[0]).expect("表头表应可识别（只是没有数据行）");
        assert!(header_only.metrics.is_empty(), "表头表不可能产出数据行");

        // 表体表：首行被当成表头 → 认不出任何列 → missing_header
        let err = parse(&ts[1]).expect_err("表体表缺少表头，必须被拒绝");
        assert_eq!(err.params()["reason"], "missing_header");

        // 合起来 = 0 行。这就是"AI 流量取数恒为 0"的机械原因。
        assert_eq!(header_only.metrics.len(), 0);
    }

    /// 🔴 修复后：提取器把表头表与表体表合并成一张正规表，解析器就能正常工作。
    #[test]
    fn merged_table_yields_the_real_row() {
        let ts = tables();
        let merged = format!("{}\n{}", ts[0], ts[1]);
        let parsed = parse(&merged).expect("合并后应可解析");

        assert_eq!(parsed.metrics.len(), 1, "应解析出 1 行真实数据");
        assert_eq!(parsed.errors.len(), 0);
        let m = &parsed.metrics[0];
        assert_eq!(m.query, "示例站点app大小");
        assert_eq!(m.citations, Some(1));
        assert_eq!(m.impressions, Some(0));
        assert_eq!(m.clicks, Some(0));
        // AI 表的 ctr 分母是 citations（见 parse_rows 的 denominator 分支）；
        // citations=1、点击量=0 → 0.0，与页面显示的 0.00% 一致
        assert_eq!(m.ctr, Some(0.0));
    }

    /// 合并后的表头比数据行多一个空 gutter 单元格（真实页 `操作` 后还有一个空 th），
    /// 解析器应按列名匹配、不受多余列影响。
    #[test]
    fn extra_header_gutter_cell_does_not_shift_columns() {
        let ts = tables();
        // 表头有 6 列、数据行 6 列；再加一个尾部空列模拟 gutter 未裁掉的情形
        let merged = format!("{}\t\n{}", ts[0], ts[1]);
        let parsed = parse(&merged).expect("多余空列不该导致解析失败");
        assert_eq!(parsed.metrics.len(), 1);
        assert_eq!(parsed.metrics[0].query, "示例站点app大小");
        assert_eq!(parsed.metrics[0].citations, Some(1));
    }
}

#[cfg(test)]
mod traditional_alias_tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn traditional_baidu_headers_map_to_canonical_columns() {
        let parsed = parse_search_table(ParseInput {
            payload: "关键词\t点击量\t展现量\t点击率\n工业除尘器\t8\t1200\t0.0067",
            project_id: ProjectId::new(),
            kind: SearchSourceKind::BaiduZiyuan,
            period_start: "2026-09-01",
            period_end: "2026-09-30",
            data_through: "2026-09-30",
            imported_at: Utc.with_ymd_and_hms(2026, 9, 30, 0, 0, 0).unwrap(),
        })
        .expect("传统百度表头应可识别");
        assert_eq!(parsed.metrics.len(), 1);
        assert_eq!(parsed.metrics[0].impressions, Some(1200));
        assert_eq!(parsed.metrics[0].clicks, Some(8));
        assert_eq!(parsed.metrics[0].surface, SearchSurface::WebSearch);
    }
}
