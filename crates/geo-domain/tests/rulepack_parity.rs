//! 🔴 Task 10 的 parity 安全网：**声明式规则包**的归一结果必须与
//! **现有硬编码路径**（`search_import::parse_search_table`）在真实录制样本上一致。
//!
//! 为什么这是本 task 最关键的测试：Task 10 要把"硬编码列名别名"换成"从规则包读"，
//! 而这条链路跑在用户已登录的第三方平台会话里、正确性只能靠真人真机验证。
//! 一旦规则包写得不对（例如 `点击` 用子串会同时匹配「AI点击量」和「AI点击率」），
//! 取数就会静默取错列 —— 界面上看起来"有数据"，实际是错的。
//! parity 测试让"两条路的输出必须逐字段一致"变成 CI 里可执行的断言。
//!
//! 🔴 基线纪律：这里比对的是**两条实现之间的一致性**，不是"现有实现的输出"本身
//! （现有实现对 AI 页曾经恒 0 行 —— 拿它当黄金标准会把 bug 固化）。
//! 真实数据的期望值另由 `search_import::ai_table_split_structure_tests` 与
//! `rulepack::tests::normalize_table_maps_real_headers_and_coerces_types` 钉住。
use std::collections::BTreeMap;

use chrono::{TimeZone, Utc};
use geo_domain::ids::ProjectId;
use geo_domain::rulepack::{self, Rulepack};
use geo_domain::search::SearchSourceKind;
use geo_domain::search_import::{parse_search_table, ParseInput};
use serde_json::Value;

const AI_CAPTURE: &str =
    include_str!("../../../fixtures/search-browser/baidu-ziyuan-aiflow-with-data-2026-11-18.json");
const KEYWORDS_CAPTURE: &str = include_str!(
    "../../../fixtures/search-browser/baidu-ziyuan-keywords-with-data-2026-11-18.json"
);

/// 与后台仓 `packages/contracts/samples/rulepack/valid/baidu-ziyan.json` 同口径
const SPEC: &str = r#"{
  "schema_version": 1,
  "engine_code": "baidu_ziyan",
  "version": 4,
  "start_url": "https://ziyuan.baidu.com/aiflow/index",
  "page_classifiers": [
    { "kind": "ai_table", "match": { "url_contains": ["aiflow"] } },
    { "kind": "page_table", "match": { "title_contains": ["收录"] } }
  ],
  "table_rules": [
    { "kind": "ai_table",
      "columns": [
        { "header_match": ["关键词","查询","问题"], "field": "query", "type": "text" },
        { "header_match": ["AI引用量","引用量"], "field": "citations", "type": "integer" },
        { "header_match": ["AI曝光量","曝光量","展现量"], "field": "impressions", "type": "integer" },
        { "header_match": ["AI点击量","点击量"], "field": "clicks", "type": "integer" },
        { "header_match": ["AI点击率","点击率","CTR"], "field": "ctr", "type": "percent" }
      ],
      "empty_when": { "all_cells_blank": true } }
  ],
  "pagination": { "kind": "none" }
}"#;

fn tables(capture: &str) -> Vec<Vec<Vec<String>>> {
    let doc: Value = serde_json::from_str(capture).expect("样本是合法 JSON");
    doc["tables_tsv"]
        .as_array()
        .expect("tables_tsv")
        .iter()
        .map(|t| {
            t.as_str()
                .unwrap_or_default()
                .lines()
                .map(|line| line.split('\t').map(|c| c.to_string()).collect())
                .collect()
        })
        .collect()
}

/// 把"表头表 + 表体表"合成一张（与提取器归并后的产物等价）
fn merged(ts: &[Vec<Vec<String>>]) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    for t in ts {
        out.extend(t.iter().cloned());
    }
    out
}

fn parse_hardcoded(
    rows: &[Vec<String>],
    kind: SearchSourceKind,
) -> Vec<(String, i64, i64, f64, i64)> {
    let payload = rows
        .iter()
        .map(|r| r.join("\t"))
        .collect::<Vec<_>>()
        .join("\n");
    let parsed = parse_search_table(ParseInput {
        payload: &payload,
        project_id: ProjectId::new(),
        kind,
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        data_through: "2026-11-18",
        imported_at: Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap(),
    })
    .expect("硬编码路径应能解析真实样本");
    parsed
        .metrics
        .iter()
        .map(|m| {
            (
                m.query.clone(),
                m.impressions.unwrap_or(-1),
                m.clicks.unwrap_or(-1),
                m.ctr.unwrap_or(f64::NAN),
                m.citations.unwrap_or(-1),
            )
        })
        .collect()
}

fn parse_rulepack(rows: &[Vec<String>], rp: &Rulepack) -> Vec<BTreeMap<String, Value>> {
    rulepack::normalize_table(rows, &rp.table_rules[0]).expect("规则包路径应能归一真实样本")
}

fn i(v: Option<&Value>) -> i64 {
    v.and_then(Value::as_i64).unwrap_or(-1)
}
fn f(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(f64::NAN)
}
fn s(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
}

#[test]
fn rulepack_spec_parses() {
    let rp = rulepack::parse(SPEC).expect("规则包应可解析");
    assert_eq!(rp.engine_code, "baidu_ziyan");
}

/// 🔴 关键：AI 页（真实录制）两条路必须一致
#[test]
fn parity_ai_page_real_capture() {
    let rp = rulepack::parse(SPEC).unwrap();
    let rows = merged(&tables(AI_CAPTURE));
    let hard = parse_hardcoded(&rows, SearchSourceKind::BaiduZiyuanAi);
    let decl = parse_rulepack(&rows, &rp);

    assert_eq!(hard.len(), decl.len(), "行数必须一致");
    assert_eq!(hard.len(), 1, "真实 AI 样本有 1 行");
    for (h, d) in hard.iter().zip(decl.iter()) {
        assert_eq!(h.0, s(d.get("query")), "query");
        assert_eq!(h.1, i(d.get("impressions")), "impressions");
        assert_eq!(h.2, i(d.get("clicks")), "clicks");
        assert_eq!(h.4, i(d.get("citations")), "citations");
        // 🔴 ctr：硬编码路径是 clicks/citations 重算值，规则包路径取页面显示值；
        //    页面显示是四舍五入过的，允许 1e-3 的差。
        let diff = (h.3 - f(d.get("ctr"))).abs();
        assert!(
            diff < 1e-3,
            "ctr 差异 {diff} 超容差（hard={} decl={}）",
            h.3,
            f(d.get("ctr"))
        );
    }
}

/// 🔴 关键：关键词页（10 行真实数据）两条路必须一致
#[test]
fn parity_keywords_page_real_capture() {
    let rp = rulepack::parse(SPEC).unwrap();
    let rows = tables(KEYWORDS_CAPTURE)
        .first()
        .cloned()
        .unwrap_or_default();
    let hard = parse_hardcoded(&rows, SearchSourceKind::BaiduZiyuan);
    let decl = parse_rulepack(&rows, &rp);

    assert_eq!(hard.len(), 10, "真实样本 10 行");
    assert_eq!(hard.len(), decl.len(), "行数必须一致");
    for (h, d) in hard.iter().zip(decl.iter()) {
        assert_eq!(h.0, s(d.get("query")), "query");
        assert_eq!(h.1, i(d.get("impressions")), "impressions");
        assert_eq!(h.2, i(d.get("clicks")), "clicks");
        let diff = (h.3 - f(d.get("ctr"))).abs();
        assert!(
            diff < 1e-3,
            "ctr 差异 {diff} 超容差（hard={} decl={}）",
            h.3,
            f(d.get("ctr"))
        );
    }
}

#[test]
fn parity_holds_for_thousands_separator_rows() {
    // 「索引量」样本里的 7,100 / -2,992 千分位：两条路的整数归一必须一致。
    // 该表不是关键词表（无 query/page_url），硬编码路径会 missing_header，
    // 所以这里只验规则包路径的归一结果与人工期望一致。
    let rp = rulepack::parse(SPEC).unwrap();
    let rows = vec![
        vec!["关键词".to_string(), "AI曝光量".to_string()],
        vec!["甲".to_string(), "7,100".to_string()],
        vec!["乙".to_string(), "-2,992".to_string()],
    ];
    let out = parse_rulepack(&rows, &rp);
    assert_eq!(i(out[0].get("impressions")), 7100);
    assert_eq!(i(out[1].get("impressions")), -2992);
}

/// 🔴 反证：退化别名必须造成 parity 失败，否则这条网没在守东西
#[test]
fn declared_alias_swap_would_break_parity() {
    // 反证：把 clicks 的别名退化成子串「点击」，再把 ctr 也写成子串，
    // 就会与硬编码路径不一致 —— 证明 parity 测试真的在守列映射，不是摆设。
    let loose = SPEC
        .replace(
            r#""header_match": ["AI点击量","点击量"], "field": "clicks""#,
            r#""header_match": ["点击"], "field": "clicks""#,
        )
        .replace(
            r#""header_match": ["AI点击率","点击率","CTR"], "field": "ctr""#,
            r#""header_match": ["点击"], "field": "ctr""#,
        );
    let rp = rulepack::parse(&loose).unwrap();
    let rows = tables(KEYWORDS_CAPTURE)
        .first()
        .cloned()
        .unwrap_or_default();
    let hard = parse_hardcoded(&rows, SearchSourceKind::BaiduZiyuan);
    let decl = parse_rulepack(&rows, &rp);

    // 子串「点击」会把 clicks 与 ctr 都绑到「点击量」这一列 → 与硬路径不一致
    let mismatched = hard
        .iter()
        .zip(decl.iter())
        .any(|(h, d)| i(d.get("clicks")) != h.2 || (h.3 - f(d.get("ctr"))).abs() >= 1e-3);
    assert!(
        mismatched,
        "退化别名应当造成 parity 失败（否则这条测试没在守东西）"
    );
}
