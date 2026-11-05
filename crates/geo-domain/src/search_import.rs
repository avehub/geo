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
        "AI曝光量" | "impressions" => Some(Column::Impressions),
        "AI点击量" | "clicks" => Some(Column::Clicks),
        "AI点击率" | "ctr_check" => Some(Column::CtrCheck),
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

fn parse_float(cell: &str) -> Result<Option<f64>, ()> {
    let text = cell.trim().replace(',', "");
    if text.is_empty() {
        return Ok(None);
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
    let given = match parse_float(cell(Column::CtrCheck)) {
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
        let given = match parse_float(cell(Column::CtrCheck)) {
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
