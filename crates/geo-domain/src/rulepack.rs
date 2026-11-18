//! 声明式规则包（DR-A4）：解析 + 页面分类 + 表格归一。
//!
//! 🔴 本模块**只处理数据**，没有任何脚本执行入口（DR-A4 第③道门禁的客户端落点）：
//! 不 `eval`、不 `Function`、不加载 JS、不拼接语句。规则包描述的是
//! "去哪个元素取、取哪一列、怎么归一化"，全部是**声明式数据**。
//!
//! 为什么必须这样：客户端的浏览器自动化通道运行在**用户已登录的第三方平台会话**里
//! （如百度站长）。远程下发脚本 == 把客户的第三方账号交给任何能篡改我方服务器/
//! DNS/发布流程的人。详见设计文档 §7.2。
//!
//! 🔴 本模块不做 IO、不依赖其他 crate（AGENTS 规则 4）：不读文件、不发网络。
//! 规则包从哪来（后台数据面 `/client/v1/rulepacks/…` 或编译期内置）由壳侧决定。

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::GeoError;

/// 列类型：决定单元格怎么归一化。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnType {
    Text,
    Integer,
    Decimal,
    /// 页面显示 `44.20%` → 内部 `0.442`
    Percent,
    /// `2026-11-16` → 原样保留 ISO 日期串（本模块不做时区推算）
    Date,
}

impl ColumnType {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "text" => Some(Self::Text),
            "integer" => Some(Self::Integer),
            "decimal" => Some(Self::Decimal),
            "percent" => Some(Self::Percent),
            "date" => Some(Self::Date),
            // 🔴 未知类型**不报错也不猜**：由调用方按"无法识别该列"处理（见 parse 的说明）
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnRule {
    /// 表头别名；匹配语义是**子串** `header.contains(pattern)`，从左到右取首个命中。
    /// 🔴 正因为是子串，「点击」会同时匹配「AI点击量」与「AI点击率」——
    /// 规则要用 `AI点击量` / `AI点击率` 这种精确别名，别用裸 `点击`。
    pub header_match: Vec<String>,
    pub field: String,
    pub ty: ColumnType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableRule {
    pub kind: String,
    pub columns: Vec<ColumnRule>,
    /// 全部单元格为空 → 返回空集（"无数据"而不是"解析失败"）
    pub empty_when_all_cells_blank: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PageClassifier {
    pub kind: String,
    pub title_contains: Vec<String>,
    pub url_contains: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rulepack {
    pub schema_version: u64,
    pub engine_code: String,
    pub version: u64,
    pub start_url: String,
    pub page_classifiers: Vec<PageClassifier>,
    pub table_rules: Vec<TableRule>,
    /// 🔴 解析时被忽略的未知字段名（前向兼容的观测点，供壳侧记日志）
    pub ignored_fields: Vec<String>,
}

/// 当前支持的 rulepack schema 版本。
pub const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// 🔴 已知的**结构键**白名单。
///
/// 为什么需要它：黑名单里的 `code` 是"规则字段名"层面的判据，
/// 而结构键 `engine_code` 天然含 `code` —— 第一版对所有键无差别跑黑名单，
/// 结果**每个合法规则包都被自己拒了**（报 not_allowed），测试当场红。
/// 所以：结构键放行，只对"未知键"跑黑名单。
const KNOWN_STRUCTURAL: [&str; 24] = [
    "schema_version",
    "engine_code",
    "version",
    "min_app_version",
    "max_app_version",
    "start_url",
    "page_classifiers",
    "table_rules",
    "pagination",
    "kind",
    "match",
    "title_contains",
    "url_contains",
    "columns",
    "header_match",
    "field",
    "type",
    "empty_when",
    "all_cells_blank",
    "visibility",
    "require_bounding_box_nonzero",
    "require_computed_visible",
    "max_rows",
    "notes_zh",
];

/// 🔴 字段名黑名单（与后台仓 `FORBIDDEN_RULEPACK_FIELD_PATTERN`
/// `script|code|js|eval|handler|on_` 同口径），**只作用于未知键**。
///
/// 为什么客户端也要自己查一遍（后端已经有一道门禁）：
/// 后端门禁保护的是"从后台发出去的包"，而客户端是**最终执行者**。
/// 若某天产物被篡改、或规则包从别的来源进来，客户端这一层就是最后一道。
fn is_forbidden_field(name: &str) -> bool {
    if KNOWN_STRUCTURAL.contains(&name) {
        return false;
    }
    let n = name.to_ascii_lowercase();
    ["script", "code", "js", "eval", "handler"]
        .iter()
        .any(|p| n.contains(p))
        || n.starts_with("on_")
}

/// 递归收集所有出现过的属性名（用于黑名单检查）。
fn collect_keys(node: &Value, out: &mut Vec<String>) {
    match node {
        Value::Object(map) => {
            for (k, v) in map {
                out.push(k.clone());
                collect_keys(v, out);
            }
        }
        Value::Array(items) => {
            for v in items {
                collect_keys(v, out);
            }
        }
        _ => {}
    }
}

fn str_list(node: Option<&Value>) -> Vec<String> {
    node.and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn req_u64(node: &Value, field: &str) -> Result<u64, GeoError> {
    node.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| GeoError::validation(field, "required"))
}

fn req_str(node: &Value, field: &str) -> Result<String, GeoError> {
    node.get(field)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GeoError::validation(field, "required"))
}

/// 解析规则包。
///
/// # 前向兼容（🔴 这三条是刻意的，别"顺手收紧"）
/// * **未知字段忽略**，记进 [`Rulepack::ignored_fields`] 供观测 ——
///   若未知字段直接报错，后台每加一个可选字段就会让所有未升级客户端**拒收整包**，
///   远程规则更新静默失效。
/// * **未知列类型**：该列被跳过（不猜、不报错），其余列照常工作。
/// * **未知 `kind`**：该规则/分类器被跳过。
///
/// # 硬错误
/// * 出现字段名命中黑名单（`script`/`code`/`js`/`eval`/`handler`/`on_*`）→ `21001`
/// * `schema_version` 高于 [`SUPPORTED_SCHEMA_VERSION`] → `out_of_range`
///   （主版本升高意味着破坏性变更，必须明确拒绝而不是猜着解析）
/// * 缺 `engine_code` / `version` / `start_url` / `table_rules` 为空 → `required`
pub fn parse(json: &str) -> Result<Rulepack, GeoError> {
    let root: Value = serde_json::from_str(json)
        // 🔴 不回显 serde 原文：可能带上规则包片段
        .map_err(|_| GeoError::validation("rulepack", "parse_failed"))?;

    // ① 黑名单：先于任何结构解析，确保"带脚本字段的包"一定被拒
    let mut keys = Vec::new();
    collect_keys(&root, &mut keys);
    if let Some(bad) = keys.iter().find(|k| is_forbidden_field(k)) {
        let mut extra = BTreeMap::new();
        extra.insert("value".to_string(), bad.clone());
        return Err(GeoError::Validation {
            field: "rulepack".into(),
            reason: "not_allowed".into(),
            extra,
        });
    }

    let schema_version = req_u64(&root, "schema_version")?;
    if schema_version > SUPPORTED_SCHEMA_VERSION {
        let mut extra = BTreeMap::new();
        extra.insert(
            "expected".to_string(),
            format!("<={SUPPORTED_SCHEMA_VERSION}"),
        );
        extra.insert("value".to_string(), schema_version.to_string());
        return Err(GeoError::Validation {
            field: "schema_version".into(),
            reason: "out_of_range".into(),
            extra,
        });
    }

    let engine_code = req_str(&root, "engine_code")?;
    let version = req_u64(&root, "version")?;
    let start_url = req_str(&root, "start_url")?;

    // ② 分类器
    let mut page_classifiers = Vec::new();
    if let Some(list) = root.get("page_classifiers").and_then(Value::as_array) {
        for item in list {
            let kind = match item.get("kind").and_then(Value::as_str) {
                Some(k) if !k.trim().is_empty() => k.trim().to_string(),
                _ => continue, // 未知/缺失 kind → 跳过
            };
            let m = item.get("match");
            page_classifiers.push(PageClassifier {
                kind,
                title_contains: str_list(m.and_then(|x| x.get("title_contains"))),
                url_contains: str_list(m.and_then(|x| x.get("url_contains"))),
            });
        }
    }

    // ③ 表规则
    let mut table_rules = Vec::new();
    let rules = root
        .get("table_rules")
        .and_then(Value::as_array)
        .ok_or_else(|| GeoError::validation("table_rules", "required"))?;
    for item in rules {
        let kind = match item.get("kind").and_then(Value::as_str) {
            Some(k) if !k.trim().is_empty() => k.trim().to_string(),
            _ => continue,
        };
        let mut columns = Vec::new();
        for col in item
            .get("columns")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let field = match col.get("field").and_then(Value::as_str) {
                Some(f) if !f.trim().is_empty() => f.trim().to_string(),
                _ => continue,
            };
            let Some(ty) = col
                .get("type")
                .and_then(Value::as_str)
                .and_then(ColumnType::parse)
            else {
                // 🔴 未知列类型：跳过该列（不猜、不报错）—— 前向兼容
                continue;
            };
            let header_match = str_list(col.get("header_match"));
            if header_match.is_empty() {
                continue;
            }
            columns.push(ColumnRule {
                header_match,
                field,
                ty,
            });
        }
        let empty_when_all_cells_blank = item
            .get("empty_when")
            .and_then(|e| e.get("all_cells_blank"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        table_rules.push(TableRule {
            kind,
            columns,
            empty_when_all_cells_blank,
        });
    }
    if table_rules.is_empty() {
        return Err(GeoError::validation("table_rules", "empty"));
    }

    // ④ 记录被忽略的顶层/嵌套字段（仅供观测，不影响解析）
    // 🔴 复用 KNOWN_STRUCTURAL，避免"黑名单白名单各写一份"漂移
    let mut ignored_fields: Vec<String> = keys
        .into_iter()
        .filter(|k| !KNOWN_STRUCTURAL.contains(&k.as_str()))
        .collect();
    ignored_fields.sort();
    ignored_fields.dedup();

    Ok(Rulepack {
        schema_version,
        engine_code,
        version,
        start_url,
        page_classifiers,
        table_rules,
        ignored_fields,
    })
}

/// 判断当前页面属于哪些 `kind`。
///
/// 🔴 条件语义是 **AND**：同一分类器里 `title_contains` 与 `url_contains` 都满足才算命中；
/// 某一项为空表示"该项不限制"。
/// 这个语义有现实后果：百度站长 AI 页的真实 title 是
/// `百度搜索资源平台_共创共享鲜活搜索`（不含「AI 流量」），所以规则包**不能**用
/// `title_contains: ["AI 流量"]` —— 那会永远命中不了。用 `url_contains: ["aiflow"]` 即可。
pub fn classify(rp: &Rulepack, url: &str, title: &str) -> Vec<String> {
    let mut kinds = Vec::new();
    for c in &rp.page_classifiers {
        let title_ok =
            c.title_contains.is_empty() || c.title_contains.iter().any(|t| title.contains(t));
        let url_ok = c.url_contains.is_empty() || c.url_contains.iter().any(|t| url.contains(t));
        if title_ok && url_ok && !kinds.contains(&c.kind) {
            kinds.push(c.kind.clone());
        }
    }
    kinds
}

// ─────────────────────────────────────────────────────────────────────────────
// 表格归一
// ─────────────────────────────────────────────────────────────────────────────

fn parse_int(cell: &str) -> Option<i64> {
    let t = cell.trim().replace(',', "");
    if t.is_empty() || matches!(t.as_str(), "-" | "--" | "—" | "N/A" | "n/a") {
        return None;
    }
    t.parse::<i64>().ok()
}

fn parse_decimal(cell: &str) -> Option<f64> {
    let t = cell.trim().replace(',', "");
    if t.is_empty() || matches!(t.as_str(), "-" | "--" | "—" | "N/A" | "n/a") {
        return None;
    }
    t.parse::<f64>().ok()
}

/// 百分比：`44.20%` → `0.442`。🔴 真实页面就是带 `%` 的文本（2026-11-18 录制确认）。
fn parse_percent(cell: &str) -> Option<f64> {
    let t = cell.trim().replace(',', "");
    if t.is_empty() || matches!(t.as_str(), "-" | "--" | "—" | "N/A" | "n/a") {
        return None;
    }
    match t.strip_suffix('%') {
        Some(num) => num.trim().parse::<f64>().ok().map(|v| v / 100.0),
        None => t.parse::<f64>().ok(),
    }
}

fn normalize_cell(raw: &str, ty: ColumnType) -> Value {
    match ty {
        ColumnType::Text => Value::String(raw.trim().to_string()),
        ColumnType::Integer => parse_int(raw).map_or(Value::Null, Value::from),
        ColumnType::Decimal => parse_decimal(raw).map_or(Value::Null, Value::from),
        ColumnType::Percent => parse_percent(raw).map_or(Value::Null, Value::from),
        ColumnType::Date => {
            let t = raw.trim();
            if t.is_empty() {
                Value::Null
            } else {
                Value::String(t.to_string())
            }
        }
    }
}

/// 把「表头 + 数据行」归一成行数组。
///
/// * 第一行是表头；列按 `header_match` 的**子串**匹配、从左到右取首个命中
/// * 一行里只要有一个非空单元格就产出，空行跳过
/// * `empty_when_all_cells_blank` 且所有数据行全空 → 返回空集（"无数据"，不是错误）
///
/// 🔴 与 `search_import::parse_search_table` 的差别：本函数**只做类型归一**，
/// 不重算派生指标（如 ctr = clicks/impressions）。重算属于业务口径，留在原处。
pub fn normalize_table(
    raw_rows: &[Vec<String>],
    rule: &TableRule,
) -> Result<Vec<BTreeMap<String, Value>>, GeoError> {
    let Some(header) = raw_rows.first() else {
        return Err(GeoError::validation("table", "empty"));
    };
    // 列 → 索引（子串匹配，左侧优先）
    let mut col_index: Vec<(&ColumnRule, usize)> = Vec::new();
    for col in &rule.columns {
        if let Some(idx) = header
            .iter()
            .position(|h| col.header_match.iter().any(|m| h.contains(m)))
        {
            col_index.push((col, idx));
        }
    }
    if col_index.is_empty() {
        return Err(GeoError::validation("table", "missing_header"));
    }

    let mut rows = Vec::new();
    let mut all_blank = true;
    for cells in raw_rows.iter().skip(1) {
        if cells.is_empty() {
            continue;
        }
        if cells.iter().any(|c| !c.trim().is_empty()) {
            all_blank = false;
        } else {
            continue;
        }
        let mut row = BTreeMap::new();
        for (col, idx) in &col_index {
            row.insert(
                col.field.clone(),
                normalize_cell(cells.get(*idx).map(String::as_str).unwrap_or(""), col.ty),
            );
        }
        rows.push(row);
    }
    if rows.is_empty() && all_blank && rule.empty_when_all_cells_blank {
        return Ok(Vec::new());
    }
    Ok(rows)
}

/// 🔴 编译期内置规则包（plan Task 10：`remote_rulepack_get` 缺失/不可用时用它）。
///
/// 为什么内置：I-1「断网可用」。服务端全挂、DNS 黑洞、规则包验签失败时，
/// 百度站长取数仍要能工作 —— 它跑在用户的登录会话里，不依赖我方服务器。
///
/// 🔴 内容与后台仓 `packages/contracts/samples/rulepack/valid/baidu-ziyan.json`
/// 同口径；改它必须同步改那边，并跑 `crates/geo-domain/tests/rulepack_parity.rs`。
const BUILTIN_BAIDU_ZIYAN: &str = include_str!("../data/rulepacks/baidu_ziyan.json");

/// 按 engine_code 取内置规则包。目前只有百度站长一份。
pub fn builtin_rulepack(engine_code: &str) -> Option<&'static str> {
    match engine_code {
        "baidu_ziyan" => Some(BUILTIN_BAIDU_ZIYAN),
        _ => None,
    }
}

#[cfg(test)]
mod builtin_tests {
    use super::*;

    #[test]
    fn builtin_baidu_ziyan_parses_and_matches_real_headers() {
        let json = builtin_rulepack("baidu_ziyan").expect("必须有内置规则包");
        let rp = parse(json).expect("内置规则包必须合法（仓库内自检）");
        assert_eq!(rp.engine_code, "baidu_ziyan");
        assert_eq!(rp.table_rules.len(), 1);

        // 🔴 内置包的列别名必须能对上**真实表头**（2026-11-18 录制）
        let real_header = [
            "关键词",
            "AI引用量",
            "AI曝光量",
            "AI点击量",
            "AI点击率",
            "操作",
        ];
        let rule = &rp.table_rules[0];
        for field in ["query", "citations", "impressions", "clicks", "ctr"] {
            let col = rule
                .columns
                .iter()
                .find(|c| c.field == field)
                .unwrap_or_else(|| panic!("内置包缺字段 {field}"));
            let hit = real_header
                .iter()
                .position(|h| col.header_match.iter().any(|m| h.contains(m)));
            assert!(
                hit.is_some(),
                "字段 {field} 的别名对不上任何真实表头：{real_header:?}"
            );
        }

        // 🔴 clicks 必须绑到「AI点击量」而不是「AI点击率」
        let clicks = rule.columns.iter().find(|c| c.field == "clicks").unwrap();
        let idx = real_header
            .iter()
            .position(|h| clicks.header_match.iter().any(|m| h.contains(m)))
            .unwrap();
        assert_eq!(real_header[idx], "AI点击量");
    }

    #[test]
    fn unknown_engine_has_no_builtin() {
        assert!(builtin_rulepack("some_other_engine").is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = include_str!(
        "../../../fixtures/search-browser/baidu-ziyuan-keywords-with-data-2026-11-18.json"
    );

    fn real_tables() -> Vec<Vec<Vec<String>>> {
        let doc: Value = serde_json::from_str(REAL).expect("样本是合法 JSON");
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

    /// 后台仓 `packages/contracts/samples/rulepack/valid/baidu-ziyan.json` 的口径
    fn spec() -> Rulepack {
        parse(
            r#"{
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
            }"#,
        )
        .expect("应能解析")
    }

    #[test]
    fn parses_the_real_rulepack_shape() {
        let rp = spec();
        assert_eq!(rp.engine_code, "baidu_ziyan");
        assert_eq!(rp.version, 4);
        assert_eq!(rp.table_rules.len(), 1);
        assert_eq!(rp.table_rules[0].columns.len(), 5);
        assert_eq!(rp.page_classifiers.len(), 2);
        // `pagination` 是已知字段，不该被记成"忽略"
        assert!(!rp.ignored_fields.iter().any(|f| f == "pagination"));
    }

    #[test]
    fn normalize_table_maps_real_headers_and_coerces_types() {
        let ts = real_tables();
        let rows = normalize_table(&ts[0], &spec().table_rules[0]).expect("应能归一");
        assert_eq!(rows.len(), 10, "10 个关键词都该产出");
        let r0 = &rows[0];
        assert_eq!(r0["query"], Value::String("示例品牌ai设计".into()));
        assert_eq!(r0["clicks"], Value::from(179));
        assert_eq!(r0["impressions"], Value::from(405));
        // 44.20% → 0.442（percent 去 % 再除以 100）
        let ctr = r0["ctr"].as_f64().expect("ctr 是数字");
        assert!((ctr - 0.442).abs() < 1e-9, "ctr={ctr}");
    }

    #[test]
    fn integer_column_strips_thousands_separator() {
        // 用真实「索引量」样本里的千分位（7,100 / -2,992）验整数归一
        let rows = vec![
            vec!["关键词".to_string(), "曝光量".to_string()],
            vec!["甲".to_string(), "7,100".to_string()],
            vec!["乙".to_string(), "-2,992".to_string()],
        ];
        let rule = TableRule {
            kind: "t".into(),
            columns: vec![
                ColumnRule {
                    header_match: vec!["关键词".into()],
                    field: "query".into(),
                    ty: ColumnType::Text,
                },
                ColumnRule {
                    header_match: vec!["曝光".into()],
                    field: "impressions".into(),
                    ty: ColumnType::Integer,
                },
            ],
            empty_when_all_cells_blank: true,
        };
        let out = normalize_table(&rows, &rule).unwrap();
        assert_eq!(out[0]["impressions"], Value::from(7100));
        assert_eq!(out[1]["impressions"], Value::from(-2992));
    }

    #[test]
    fn header_match_accepts_any_alias() {
        let rows = vec![
            vec!["关键词".to_string(), "CTR".to_string()],
            vec!["甲".to_string(), "5%".to_string()],
        ];
        let rule = TableRule {
            kind: "t".into(),
            columns: vec![
                ColumnRule {
                    header_match: vec!["关键词".into()],
                    field: "query".into(),
                    ty: ColumnType::Text,
                },
                // 别名列表里任取其一命中即可（这里命中 CTR）
                ColumnRule {
                    header_match: vec!["AI点击率".into(), "点击率".into(), "CTR".into()],
                    field: "ctr".into(),
                    ty: ColumnType::Percent,
                },
            ],
            empty_when_all_cells_blank: true,
        };
        let out = normalize_table(&rows, &rule).unwrap();
        assert_eq!(out[0]["ctr"].as_f64().unwrap(), 0.05);
    }

    #[test]
    fn unknown_fields_are_ignored_not_rejected() {
        // 🔴 前向兼容：后台将来加可选字段（如 max_rows），老客户端只忽略、不报错。
        //    若报错，后台每加一个字段就会让所有未升级客户端拒收整包。
        let rp = parse(
            r#"{"schema_version":1,"engine_code":"e","version":1,"start_url":"https://x/",
                "some_future_field": {"nested": true},
                "table_rules":[{"kind":"k","columns":[{"header_match":["关键词"],"field":"query","type":"text"}]}]}"#,
        )
        .expect("未知字段必须被忽略");
        assert!(rp.ignored_fields.iter().any(|f| f == "some_future_field"));
        assert_eq!(rp.table_rules.len(), 1);
    }

    #[test]
    fn forbidden_script_field_is_rejected() {
        // 🔴 计划要求：additionalProperties 违规（出现 script 字段）→ 解析错误
        for bad in [
            r#"{"schema_version":1,"engine_code":"e","version":1,"start_url":"https://x/","script":"alert(1)","table_rules":[{"kind":"k","columns":[]}]}"#,
            r#"{"schema_version":1,"engine_code":"e","version":1,"start_url":"https://x/","table_rules":[{"kind":"k","columns":[{"header_match":["a"],"field":"f","type":"text","on_load":"x"}]}]}"#,
            r#"{"schema_version":1,"engine_code":"e","version":1,"start_url":"https://x/","table_rules":[{"kind":"k","columns":[{"header_match":["a"],"field":"f","type":"text","handler":"x"}]}]}"#,
        ] {
            let err = parse(bad).expect_err("带脚本字段的包必须被拒");
            assert_eq!(err.params()["reason"], "not_allowed", "包：{bad}");
        }
    }

    #[test]
    fn unknown_column_type_is_skipped_not_fatal() {
        let rp = parse(
            r#"{"schema_version":1,"engine_code":"e","version":1,"start_url":"https://x/",
                "table_rules":[{"kind":"k","columns":[
                  {"header_match":["关键词"],"field":"query","type":"text"},
                  {"header_match":["x"],"field":"weird","type":"quantum"}
                ]}]}"#,
        )
        .expect("未知列类型不该让整包失败");
        assert_eq!(rp.table_rules[0].columns.len(), 1, "只保留能识别的列");
        assert_eq!(rp.table_rules[0].columns[0].field, "query");
    }

    #[test]
    fn higher_schema_version_is_rejected() {
        let err = parse(
            r#"{"schema_version":2,"engine_code":"e","version":1,"start_url":"https://x/","table_rules":[{"kind":"k","columns":[]}]}"#,
        )
        .expect_err("主版本升高必须明确拒绝");
        assert_eq!(err.params()["reason"], "out_of_range");
    }

    #[test]
    fn parse_error_does_not_echo_payload() {
        let err = parse(r#"{"schema_version":1,"engine_code":"SECRET-MARKER""#).unwrap_err();
        let msg = format!("{err}");
        assert!(!msg.contains("SECRET-MARKER"), "解析错误回显了原文：{msg}");
    }

    #[test]
    fn classifier_uses_and_semantics_and_url_alone_is_enough() {
        let rp = spec();
        // 真实 AI 页：title 不含「AI 流量」，但 url 含 aiflow → 命中
        let kinds = classify(
            &rp,
            "https://ziyuan.baidu.com/aiflow/index",
            "百度搜索资源平台_共创共享鲜活搜索",
        );
        assert_eq!(kinds, vec!["ai_table".to_string()]);

        // 「收录」页：title 命中 page_table
        let kinds = classify(
            &rp,
            "https://ziyuan.baidu.com/indexs/index",
            "索引量_百度官方收录分析工具",
        );
        assert_eq!(kinds, vec!["page_table".to_string()]);

        // 都不匹配 → 空
        assert!(classify(&rp, "https://ziyuan.baidu.com/x", "别的页面").is_empty());
    }

    #[test]
    fn empty_table_returns_empty_set_when_declared() {
        let rule = &spec().table_rules[0];
        // 只有表头、没有数据行
        let header_only = vec![vec![
            "关键词".to_string(),
            "AI引用量".to_string(),
            "AI曝光量".to_string(),
            "AI点击量".to_string(),
            "AI点击率".to_string(),
        ]];
        assert!(normalize_table(&header_only, rule).unwrap().is_empty());

        // 有数据行但全空
        let blank = vec![
            header_only[0].clone(),
            vec!["".into(), "".into(), "".into(), "".into(), "".into()],
        ];
        assert!(normalize_table(&blank, rule).unwrap().is_empty());
    }

    #[test]
    fn missing_recognized_header_errors() {
        let rule = &spec().table_rules[0];
        let rows = vec![vec!["完全无关".to_string(), "列".to_string()]];
        let err = normalize_table(&rows, rule).unwrap_err();
        assert_eq!(err.params()["reason"], "missing_header");
    }
}
