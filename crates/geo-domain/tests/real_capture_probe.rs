//! 🔴 临时探针：把**真实录制的 TSV** 喂给现有 `parse_search_table`，看清当前究竟解析出什么。
//! 这份文件是 Task 10 冻结基线前的取证，定稿后会改成带断言的回归测试。
use chrono::{TimeZone, Utc};
use geo_domain::ids::ProjectId;
use geo_domain::search::SearchSourceKind;
use geo_domain::search_import::{parse_search_table, ParseInput};

fn parse(payload: &str, kind: SearchSourceKind) -> Result<String, String> {
    let input = ParseInput {
        payload,
        project_id: ProjectId::new(),
        kind,
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        data_through: "2026-11-18",
        imported_at: Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap(),
    };
    match parse_search_table(input) {
        Ok(p) => Ok(format!(
            "metrics={} ai_overviews={} errors={} warnings={}",
            p.metrics.len(),
            p.ai_overviews.len(),
            p.errors.len(),
            p.warnings.len()
        )),
        Err(e) => Err(format!("{e}")),
    }
}

fn tsv(path: &str) -> Vec<String> {
    let raw = std::fs::read_to_string(path).expect("读样本");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("解析 JSON");
    v["tables_tsv"]
        .as_array()
        .expect("tables_tsv 是数组")
        .iter()
        .map(|t| t.as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn probe_real_captures() {
    for (file, label) in [
        (
            "fixtures/search-browser/baidu-ziyuan-aiflow-2026-11-18.json",
            "AI 流量页",
        ),
        (
            "fixtures/search-browser/baidu-ziyuan-keywords-with-data-2026-11-18.json",
            "流量与关键词页",
        ),
        (
            "fixtures/search-browser/baidu-ziyuan-indexs-with-data-2026-11-18.json",
            "索引量页",
        ),
    ] {
        let path = format!("../../{file}");
        println!("\n════ {label}（{file}）════");
        for (i, table) in tsv(&path).iter().enumerate() {
            let header = table.lines().next().unwrap_or("");
            for kind in [
                SearchSourceKind::BaiduZiyuanAi,
                SearchSourceKind::BaiduZiyuan,
            ] {
                match parse(table, kind) {
                    Ok(s) => println!("  表{i} [{kind:?}] 表头={header:.40?} → ✅ {s}"),
                    Err(e) => println!("  表{i} [{kind:?}] 表头={header:.40?} → ❌ {e}"),
                }
            }
        }
    }
}
