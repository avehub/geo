//! 50 处 reason key **生产站点**的表驱动守卫（Plan A Task 3 · fix round 1 · I-1）。
//!
//! 复审实证过：把 `project.rs:193` 的 `with_param("limit", …)` 改成 `with_param("expected", …)`
//! （M2），或把 `project.rs:192` 的 `"too_long"` 改成 `"duplicate"`（M4），
//! `cargo test --workspace` 都是 453 passed / 0 failed——50 处映射写错了没人知道。
//! 本文件就是让这两个变异变红：每一行都断言 `code` / `field` / `reason` /
//! **extra 的键与值**（`limit=50` 与 `limit=51` 是不同语义，只断言键集会漏掉值写错）。
//!
//! ## 为什么放集成测试（`tests/`）而不是各文件的 `#[cfg(test)]`
//!
//! 1. `tests/` 只能拿到**公开 API**，因此每行的 `trigger` 在编译期就被迫真的调用生产函数
//!    （`ProjectDraft::validate` / `EntityFields::validate` / `ProductSpec::validate` /
//!    `EntityCard::set_field` / `normalize_url` / `compliance::check` / `prompts_from_csv` /
//!    `PromptItem::validate` / `ProjectId::from_str`）。「拿 `GeoError::validation(...)`
//!    合成实例充数」正是复审者指出的盲区（`error.rs` 测试模块里那条），这里结构上就绕不开。
//! 2. 50 行集中在一个文件，`SITES.len() + UNREACHABLE.len() == 50` 一眼数得清，
//!    `no` 字段与 `task-3-report.md` §1 那张表同号，可逐条对照。
//! 3. [`the_table_covers_every_production_site`] 用 `include_str!` **反向数源码**里的
//!    `GeoError::{validation,conflict,config}(` 站点（只数 `#[cfg(test)]` 之前的部分），
//!    加站点/删站点而不同步这张表 → 立刻红。
//!
//! ## 不可达站点
//!
//! 10 处无法从公开 API 触发（CSV 写失败的 sink 是 `Vec<u8>`、`prompts_from_csv` 只收
//! `&str`、`root_field` 的 `Index` 分支是死代码），列在 [`UNREACHABLE`] 里，
//! 用**源码字面量**钉住 reason key 与配套参数名（`cargo fmt --check` 是门禁，格式稳定）。
//! 清单与「为什么不可达」见 `task-3-fix1-report.md`。

use chrono::{DateTime, Utc};
use geo_domain::compliance::check as compliance_check;
use geo_domain::entity_card::{MAX_FOUNDING_YEAR, MAX_NAME_CHARS, MIN_FOUNDING_YEAR};
use geo_domain::project::{
    MAX_ALIASES, MAX_ALIAS_CHARS, MAX_BRAND_NAME_CHARS, MAX_COMPETITORS, MAX_PROJECT_NAME_CHARS,
    MAX_REGION_CHARS, MAX_TAGS,
};
use geo_domain::prompt::{MAX_PROMPT_CHARS, MAX_REPEAT_COUNT, MAX_WEIGHT};
use geo_domain::{
    normalize_url, prompts_from_csv, CompetitorDraft, EntityCard, EntityFields, FieldStatus,
    GeoError, IntentCategory, ProductSpec, ProjectDraft, ProjectId, PromptItem, PromptSetId,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::str::FromStr;

/// 期望的参数值。
///
/// `Num` / `AtMost` / `Range` 不是「把站点算出来的值抄一遍」，而是把**表达式的形状**钉住：
/// 站点若从 `format!("<={MAX_TAGS}")` 改成 `format!("最多 {MAX_TAGS} 个")`，这里立刻红
/// ——单位属于文案，只能由前端词典模板给出（`error.rs` 目录注释的语义规则 2）。
enum Val {
    /// 与字面量逐字相等。
    Eq(&'static str),
    /// 等于 `n.to_string()`（`too_long` / `too_short` 的 `limit`）。
    Num(usize),
    /// 等于 `format!("<={n}")`（`out_of_range` 的上限表达式）。
    AtMost(usize),
    /// 等于 `format!("{a}~{b}")`（`out_of_range` 的闭区间表达式）。
    Range(i32, i32),
    /// 只钉前缀：底层错误原文（serde / csv 的报文）随依赖版本变化，
    /// 钉死全文会让「升级 serde_json」变成一条红测试，而它不是映射回归。
    Prefix(&'static str),
}

impl Val {
    fn matches(&self, actual: &str) -> bool {
        match self {
            Self::Eq(want) => actual == *want,
            Self::Num(n) => actual == n.to_string(),
            Self::AtMost(n) => actual == format!("<={n}"),
            Self::Range(a, b) => actual == format!("{a}~{b}"),
            Self::Prefix(prefix) => actual.starts_with(prefix),
        }
    }

    fn describe(&self) -> String {
        match self {
            Self::Eq(want) => format!("{want:?}"),
            Self::Num(n) => format!("{n:?}"),
            Self::AtMost(n) => format!("\"<={n}\""),
            Self::Range(a, b) => format!("\"{a}~{b}\""),
            Self::Prefix(prefix) => format!("以 {prefix:?} 开头"),
        }
    }
}

/// 一行 = 一处**可达**的生产站点。
struct Site {
    /// 与 `task-3-report.md` §1 的 50 行表同号。
    no: u8,
    /// 生产站点的源码位置（人读 + 复核用）。
    at: &'static str,
    /// 真的调用生产函数把它触发出来；返回的必须是 `Err`。
    trigger: fn() -> GeoError,
    code: &'static str,
    /// `Validation` 的 field；`Conflict` 没有 field，置 `None`。
    field: Option<&'static str>,
    reason: &'static str,
    /// extra（= `params()` 去掉基础键 `field` / `reason`）的期望键值，**按键名字典序书写**。
    extra: &'static [(&'static str, Val)],
}

/// 一行 = 一处**不可达**的生产站点，用源码字面量钉住映射。
struct UnreachableSite {
    no: u8,
    at: &'static str,
    /// 属于哪个源文件（`include_str!` 的那份）。
    file: File,
    /// 生产源码里必须逐字存在的片段。
    literal: &'static str,
    reason: &'static str,
    extra_keys: &'static [&'static str],
    /// 为什么从公开 API 触发不了。
    why: &'static str,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum File {
    CsvIo,
    EntityCard,
}

impl File {
    fn source(self) -> &'static str {
        match self {
            Self::CsvIo => include_str!("../src/csv_io.rs"),
            Self::EntityCard => include_str!("../src/entity_card.rs"),
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::CsvIo => "crates/geo-domain/src/csv_io.rs",
            Self::EntityCard => "crates/geo-domain/src/entity_card.rs",
        }
    }
}

// ---------------------------------------------------------------------------
// 触发用的最小夹具。
//
// `ProjectDraft` / `EntityFields` / `ProductSpec` / `CompetitorDraft` 都 `derive(Default)`，
// 且 `validate()` 在第一个错误处短路，所以「只填必填项 + 只弄坏一个字段」就够触发单个站点，
// 不必复刻各文件 `#[cfg(test)]` 里那份完整夹具。
// ---------------------------------------------------------------------------

fn now() -> DateTime<Utc> {
    DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
}

/// 除 `brand_name` 外全空的合法草稿：`validate()` 应当返回 `Ok`。
fn draft() -> ProjectDraft {
    ProjectDraft {
        brand_name: "稿得快".to_string(),
        ..ProjectDraft::default()
    }
}

/// 弄坏草稿的某一个字段，取回校验错误。
fn broken_draft(mutate: impl FnOnce(&mut ProjectDraft)) -> GeoError {
    let mut draft = draft();
    mutate(&mut draft);
    draft.validate().expect_err("该字段应当被拒绝")
}

fn card_fields() -> EntityFields {
    EntityFields {
        standard_name: "稿得快".to_string(),
        products: vec![ProductSpec {
            name: "GEO 客户端".to_string(),
            ..ProductSpec::default()
        }],
        ..EntityFields::default()
    }
}

/// 走 `EntityCard::set_field`（公开 API）触发 `parse_path` / `root_field` / `set_at` /
/// `validate_field` 里的站点。
fn set_field(path: &str, value: serde_json::Value) -> GeoError {
    let mut card = EntityCard::from_manual(ProjectId::new(), card_fields(), now());
    card.set_field(path, value, FieldStatus::Official, now(), None)
        .expect_err("set_field 应当失败")
}

fn prompt(text: &str) -> PromptItem {
    PromptItem::new(
        PromptSetId::new(),
        text.to_string(),
        IntentCategory::CategoryAwareness,
    )
}

/// 超长字符串：`chars().count()` 恰好比 `limit` 多 1（「刚好越界」）。
fn over(limit: usize) -> String {
    "字".repeat(limit + 1)
}

/// `params()` 去掉基础键，剩下的就是变体的 `extra`。
fn extra_of(error: &GeoError) -> BTreeMap<String, String> {
    let mut extra = error.params();
    extra.remove("field");
    extra.remove("reason");
    extra
}

const VALIDATION: &str = "validation/failed";

/// `csv_io.rs` 里三段写失败共用的字面量（8 处）。
const WRITE_FAILED: &str = r#"GeoError::conflict("write_failed").with_param("value", err)"#;
/// `csv_io.rs:91` 的表头解析失败。
const PARSE_FAILED: &str = r#"GeoError::conflict("parse_failed").with_param("value", err)"#;
/// `entity_card.rs` 里 `invalid_format` + `value=index` 的字面量：
/// 出现 2 次——`root_field` 的 `Index` 分支（#46，死代码）与 `set_at` 的「目标不是数组」（#49）。
const INVALID_FORMAT_INDEX: &str =
    r#"GeoError::validation("field_path", "invalid_format").with_param("value", index)"#;

/// 40 处**可达**站点。`no` 与 `task-3-report.md` §1 同号；缺号（22–25、27–31、46）
/// 都在 [`UNREACHABLE`] 里，两张表合起来恰好 50。
const SITES: &[Site] = &[
    // ---- project.rs（11 处）----
    Site {
        no: 1,
        at: "project.rs:189",
        trigger: || broken_draft(|d| d.brand_name = "   ".to_string()),
        code: VALIDATION,
        field: Some("brand_name"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 2,
        at: "project.rs:192",
        trigger: || broken_draft(|d| d.brand_name = over(MAX_BRAND_NAME_CHARS)),
        code: VALIDATION,
        field: Some("brand_name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_BRAND_NAME_CHARS))],
    },
    Site {
        no: 3,
        at: "project.rs:196",
        trigger: || broken_draft(|d| d.aliases = vec!["别名".to_string(); MAX_ALIASES + 1]),
        code: VALIDATION,
        field: Some("aliases"),
        reason: "out_of_range",
        extra: &[("expected", Val::AtMost(MAX_ALIASES))],
    },
    Site {
        no: 4,
        at: "project.rs:202",
        trigger: || broken_draft(|d| d.aliases = vec!["   ".to_string()]),
        code: VALIDATION,
        field: Some("aliases"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 5,
        at: "project.rs:205",
        trigger: || broken_draft(|d| d.aliases = vec![over(MAX_ALIAS_CHARS)]),
        code: VALIDATION,
        field: Some("aliases"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_ALIAS_CHARS))],
    },
    Site {
        no: 6,
        at: "project.rs:211",
        trigger: || broken_draft(|d| d.name = Some(over(MAX_PROJECT_NAME_CHARS))),
        code: VALIDATION,
        field: Some("name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_PROJECT_NAME_CHARS))],
    },
    Site {
        no: 7,
        at: "project.rs:229",
        trigger: || broken_draft(|d| d.region = Some(over(MAX_REGION_CHARS))),
        code: VALIDATION,
        field: Some("region"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_REGION_CHARS))],
    },
    Site {
        no: 8,
        at: "project.rs:234",
        trigger: || broken_draft(|d| d.tags = vec!["标签".to_string(); MAX_TAGS + 1]),
        code: VALIDATION,
        field: Some("tags"),
        reason: "out_of_range",
        extra: &[("expected", Val::AtMost(MAX_TAGS))],
    },
    Site {
        no: 9,
        at: "project.rs:238",
        trigger: || {
            broken_draft(|d| {
                d.competitors = vec![CompetitorDraft::default(); MAX_COMPETITORS + 1];
            })
        },
        code: VALIDATION,
        field: Some("competitors"),
        reason: "out_of_range",
        extra: &[("expected", Val::AtMost(MAX_COMPETITORS))],
    },
    Site {
        no: 10,
        at: "project.rs:244",
        trigger: || broken_draft(|d| d.competitors = vec![CompetitorDraft::default()]),
        code: VALIDATION,
        field: Some("competitors[0].name"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 11,
        at: "project.rs:251",
        trigger: || {
            broken_draft(|d| {
                d.competitors = vec![CompetitorDraft {
                    name: over(MAX_BRAND_NAME_CHARS),
                    ..CompetitorDraft::default()
                }];
            })
        },
        code: VALIDATION,
        field: Some("competitors[0].name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_BRAND_NAME_CHARS))],
    },
    // ---- asset.rs（4 处，全部在 `normalize_url` 里）----
    Site {
        no: 12,
        at: "asset.rs:100",
        trigger: || normalize_url("website", "   ").unwrap_err(),
        code: VALIDATION,
        field: Some("website"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 13,
        at: "asset.rs:108",
        trigger: || normalize_url("website", "not a url").unwrap_err(),
        code: VALIDATION,
        field: Some("website"),
        reason: "invalid_url",
        extra: &[("value", Val::Eq("not a url"))],
    },
    Site {
        no: 14,
        at: "asset.rs:110",
        trigger: || normalize_url("website", "ftp://example.com").unwrap_err(),
        code: VALIDATION,
        field: Some("website"),
        reason: "not_allowed",
        extra: &[("value", Val::Eq("ftp"))],
    },
    Site {
        no: 15,
        at: "asset.rs:117",
        trigger: || normalize_url("website", "localhost").unwrap_err(),
        code: VALIDATION,
        field: Some("website"),
        reason: "invalid_url",
        extra: &[("value", Val::Eq("localhost"))],
    },
    // ---- ids.rs（1 处，在 `id_type!` 宏体里，6 个 ID 类型共用）----
    Site {
        no: 16,
        at: "ids.rs:42",
        trigger: || ProjectId::from_str("not-a-uuid").unwrap_err(),
        code: VALIDATION,
        field: Some("ProjectId"),
        reason: "invalid_id",
        extra: &[("value", Val::Eq("not-a-uuid"))],
    },
    // ---- prompt.rs（4 处）----
    Site {
        no: 17,
        at: "prompt.rs:227",
        trigger: || prompt("   ").validate().unwrap_err(),
        code: VALIDATION,
        field: Some("text"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 18,
        at: "prompt.rs:231",
        trigger: || prompt(&over(MAX_PROMPT_CHARS)).validate().unwrap_err(),
        code: VALIDATION,
        field: Some("text"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_PROMPT_CHARS))],
    },
    Site {
        no: 19,
        at: "prompt.rs:235",
        trigger: || {
            prompt("问题")
                .with_weight(MAX_WEIGHT + 1)
                .validate()
                .unwrap_err()
        },
        code: VALIDATION,
        field: Some("weight"),
        reason: "out_of_range",
        extra: &[("expected", Val::Range(1, MAX_WEIGHT as i32))],
    },
    Site {
        no: 20,
        at: "prompt.rs:239",
        trigger: || {
            let mut item = prompt("问题");
            item.repeat_count = MAX_REPEAT_COUNT + 1;
            item.validate().unwrap_err()
        },
        code: VALIDATION,
        field: Some("repeat_count"),
        reason: "out_of_range",
        extra: &[("expected", Val::Range(1, MAX_REPEAT_COUNT as i32))],
    },
    // ---- compliance.rs（1 处）----
    // `value` 装命中的原始词（数据，不是文案）；词典模板不得复述红线词（AGENTS 规则 6）。
    Site {
        no: 21,
        at: "compliance.rs:93",
        trigger: || compliance_check("行业第一").unwrap_err(),
        code: VALIDATION,
        field: Some("content"),
        reason: "not_allowed",
        extra: &[("value", Val::Eq("行业第一"))],
    },
    // ---- csv_io.rs（10 处里唯一可达的一处）----
    Site {
        no: 26,
        at: "csv_io.rs:104",
        trigger: || prompts_from_csv("text,weight\n问题,3\n", PromptSetId::new()).unwrap_err(),
        code: VALIDATION,
        field: Some("csv_header"),
        reason: "missing_header",
        extra: &[(
            "value",
            Val::Eq("intent, group_name, tags, source, repeat_count"),
        )],
    },
    // ---- entity_card.rs：`ProductSpec::validate` / `EntityFields::validate`（5 处）----
    Site {
        no: 32,
        at: "entity_card.rs:86",
        trigger: || ProductSpec::default().validate().unwrap_err(),
        code: VALIDATION,
        field: Some("products.name"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 33,
        at: "entity_card.rs:89",
        trigger: || {
            ProductSpec {
                name: over(MAX_NAME_CHARS),
                ..ProductSpec::default()
            }
            .validate()
            .unwrap_err()
        },
        code: VALIDATION,
        field: Some("products.name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_NAME_CHARS))],
    },
    Site {
        no: 34,
        at: "entity_card.rs:137",
        trigger: || EntityFields::default().validate().unwrap_err(),
        code: VALIDATION,
        field: Some("standard_name"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 35,
        at: "entity_card.rs:140",
        trigger: || {
            EntityFields {
                standard_name: over(MAX_NAME_CHARS),
                ..EntityFields::default()
            }
            .validate()
            .unwrap_err()
        },
        code: VALIDATION,
        field: Some("standard_name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_NAME_CHARS))],
    },
    Site {
        no: 36,
        at: "entity_card.rs:146",
        trigger: || {
            EntityFields {
                standard_name: "稿得快".to_string(),
                founded_year: Some(MIN_FOUNDING_YEAR - 1),
                ..EntityFields::default()
            }
            .validate()
            .unwrap_err()
        },
        code: VALIDATION,
        field: Some("founded_year"),
        reason: "out_of_range",
        extra: &[("expected", Val::Range(MIN_FOUNDING_YEAR, MAX_FOUNDING_YEAR))],
    },
    // ---- entity_card.rs：经 `EntityCard::set_field`（14 处）----
    Site {
        no: 37,
        at: "entity_card.rs:323",
        trigger: || set_field("founded_year", json!("二〇一六")),
        code: VALIDATION,
        // `field` 是调用方传进来的动态 path
        field: Some("founded_year"),
        reason: "invalid_format",
        extra: &[("value", Val::Prefix("invalid type"))],
    },
    Site {
        no: 38,
        at: "entity_card.rs:352",
        trigger: || set_field("standard_name", json!("   ")),
        code: VALIDATION,
        field: Some("standard_name"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 39,
        at: "entity_card.rs:355",
        trigger: || set_field("standard_name", json!(over(MAX_NAME_CHARS))),
        code: VALIDATION,
        field: Some("standard_name"),
        reason: "too_long",
        extra: &[("limit", Val::Num(MAX_NAME_CHARS))],
    },
    Site {
        no: 40,
        at: "entity_card.rs:363",
        trigger: || set_field("founded_year", json!(MIN_FOUNDING_YEAR - 1)),
        code: VALIDATION,
        field: Some("founded_year"),
        reason: "out_of_range",
        extra: &[("expected", Val::Range(MIN_FOUNDING_YEAR, MAX_FOUNDING_YEAR))],
    },
    Site {
        no: 41,
        at: "entity_card.rs:402",
        trigger: || set_field("   ", json!("x")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 42,
        at: "entity_card.rs:420",
        trigger: || set_field("products[x].name", json!("y")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "invalid_format",
        extra: &[("value", Val::Eq("x"))],
    },
    Site {
        no: 43,
        at: "entity_card.rs:427",
        trigger: || set_field("[]", json!("x")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "required",
        extra: &[],
    },
    Site {
        no: 44,
        at: "entity_card.rs:430",
        trigger: || set_field("[0].name", json!("x")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "invalid_format",
        extra: &[("value", Val::Eq("[0].name"))],
    },
    Site {
        no: 45,
        at: "entity_card.rs:441",
        trigger: || set_field("nope", json!("x")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "unknown_field",
        extra: &[("value", Val::Eq("nope"))],
    },
    Site {
        no: 47,
        at: "entity_card.rs:468",
        trigger: || set_field("standard_name.x", json!("y")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "invalid_format",
        extra: &[("value", Val::Eq("x"))],
    },
    Site {
        no: 48,
        at: "entity_card.rs:476",
        trigger: || set_field("products[0].nonexistent.name", json!("y")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "unknown_field",
        extra: &[("value", Val::Eq("nonexistent"))],
    },
    Site {
        no: 49,
        at: "entity_card.rs:482",
        trigger: || set_field("standard_name[0]", json!("y")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "invalid_format",
        extra: &[("value", Val::Eq("0"))],
    },
    Site {
        no: 50,
        at: "entity_card.rs:492",
        trigger: || set_field("products[9].name", json!("y")),
        code: VALIDATION,
        field: Some("field_path"),
        reason: "out_of_range",
        // 夹具里只有 1 个产品，故合法区间是 `0~0`；空数组的 `<0` 分支由
        // `entity_card.rs` 单元测试 `out_of_range_index_reports_a_language_neutral_expected_range` 钉住。
        extra: &[("expected", Val::Eq("0~0")), ("value", Val::Eq("9"))],
    },
];

/// 10 处**不可达**站点：从公开 API 造不出触发条件，改用源码字面量钉住映射。
const UNREACHABLE: &[UnreachableSite] = &[
    UnreachableSite {
        no: 22,
        at: "csv_io.rs:58",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "`prompts_to_csv` 的 sink 是 `Writer::from_writer(Vec::new())`，写 `Vec<u8>` 不会失败，公开 API 没有注入点",
    },
    UnreachableSite {
        no: 23,
        at: "csv_io.rs:71",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22：写行失败也只可能来自 sink，`Vec<u8>` 不会失败",
    },
    UnreachableSite {
        no: 24,
        at: "csv_io.rs:75",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22：`into_inner()` 对 `Vec<u8>` 只是 flush，不会失败",
    },
    UnreachableSite {
        no: 25,
        at: "csv_io.rs:91",
        file: File::CsvIo,
        literal: PARSE_FAILED,
        reason: "parse_failed",
        extra_keys: &["value"],
        why: "`prompts_from_csv(raw: &str)` 只接受合法 UTF-8，而 `headers()` 的失败路径只有 UTF-8 错误与 IO 错误，公开签名造不出来",
    },
    UnreachableSite {
        no: 27,
        at: "csv_io.rs:215",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22（`competitors_to_csv`）",
    },
    UnreachableSite {
        no: 28,
        at: "csv_io.rs:225",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22（`competitors_to_csv`）",
    },
    UnreachableSite {
        no: 29,
        at: "csv_io.rs:234",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22（`assets_to_csv`）",
    },
    UnreachableSite {
        no: 30,
        at: "csv_io.rs:244",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22（`assets_to_csv`）",
    },
    UnreachableSite {
        no: 31,
        at: "csv_io.rs:252",
        file: File::CsvIo,
        literal: WRITE_FAILED,
        reason: "write_failed",
        extra_keys: &["value"],
        why: "同 #22（`finish`，`competitors_to_csv` / `assets_to_csv` 共用）",
    },
    UnreachableSite {
        no: 46,
        at: "entity_card.rs:444",
        file: File::EntityCard,
        literal: INVALID_FORMAT_INDEX,
        reason: "invalid_format",
        extra_keys: &["value"],
        why: "死代码：`root_field` 只在 `set_field`（entity_card.rs:318）里被调用，而它前面的 `parse_path` 已经用 #44 拦掉了 `segments[0]` 不是 `Key` 的情况，因此 `Segment::Index` 分支永远进不去",
    },
];

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

/// 主用例：40 处可达站点逐个经生产函数触发，钉住 `code` / `field` / `reason` /
/// **extra 的键与值**。M2（`limit` → `expected`）与 M4（`too_long` → `duplicate`）
/// 都在 #2 那一行变红。
#[test]
fn every_reachable_site_maps_to_its_pinned_code_field_reason_and_extra() {
    assert!(!SITES.is_empty());
    for site in SITES {
        let where_ = format!("#{} {}", site.no, site.at);
        let error = (site.trigger)();
        assert_eq!(error.code(), site.code, "{where_} → {error}");

        let params = error.params();
        match site.field {
            Some(field) => assert_eq!(
                params.get("field").map(String::as_str),
                Some(field),
                "{where_} 的 field → {error}"
            ),
            None => assert!(
                !params.contains_key("field"),
                "{where_}：`Conflict` 不该带 field → {error}"
            ),
        }
        assert_eq!(
            params.get("reason").map(String::as_str),
            Some(site.reason),
            "{where_} 的 reason key → {error}"
        );

        let extra = extra_of(&error);
        let actual_keys: Vec<&str> = extra.keys().map(String::as_str).collect();
        let expected_keys: Vec<&str> = site.extra.iter().map(|(key, _)| *key).collect();
        assert_eq!(
            actual_keys, expected_keys,
            "{where_} 的 extra 键集 → {error}"
        );
        for (key, want) in site.extra {
            let got = extra[*key].as_str();
            assert!(
                want.matches(got),
                "{where_} 的 extra[{key:?}]：期望 {}，实际 {got:?}（{error}）",
                want.describe()
            );
        }
    }
}

/// reason key → 配套参数的可执行不变式（复审者建议 2）。
///
/// **与 `crates/geo-domain/src/error.rs` 模块注释里那张 `| key | 语义 | 配套参数 |`
/// 目录表同源（19 个 key），改一处必须改另一处。**
/// 目录里那张表的「配套参数」列就是这里的 `match`：`limit` 只配字符数、`expected` 只配区间、
/// `value` 装出错的原始值、无参数的 key 一个都不许带。键名撞车（如 `too_long` 配 `expected`）
/// 在这里红，不用等到 Task 7 的词典模板渲出空占位符。
///
/// 覆盖全部 50 处：40 处用 `trigger` 产出的真实实例，10 处不可达站点用表里声明的
/// reason + extra 键（这两个字段本身由 [`unreachable_sites_keep_their_literal_mapping`]
/// 对照源码字面量核过，不是凭空声明的）。
#[test]
fn reason_key_pins_its_companion_params() {
    /// 与 `error.rs` 模块注释里那张 `| key | 语义 | 配套参数 |` 表同源。
    /// 返回该 key **必须**带的参数键。
    fn companion(reason: &str) -> Companion {
        match reason {
            // 语义规则 2：`too_long` / `too_short` 只表字符数，恰配 `limit`
            "too_long" | "too_short" => Companion::Exactly(&["limit"]),
            // 数量与数值区间一律 `out_of_range` + `expected`（可另带 `value`）
            "out_of_range" => Companion::Contains(&["expected"]),
            // 这些 key 自身就说完了，带任何参数都是噪声
            "required" | "empty" | "duplicate" | "missing_base_url" | "missing_model" => {
                Companion::Exactly(&[])
            }
            // 这些 key 必须给出「出错的原始值」，否则前端只能干说「格式不对」。
            // `row_invalid` / `unknown_provider` 在目录里同样登记了 `value`（复审 N-1：
            // 此前被错归进 `Exactly(&[])`）；`secret_unavailable` 是 Task 4 新增的第 19 个 key，
            // 它的 `value` = 钥匙串/内存实现的底层原文。
            "invalid_format" | "parse_failed" | "invalid_url" | "invalid_id" | "not_allowed"
            | "missing_header" | "write_failed" | "unknown_field" | "row_invalid"
            | "unknown_provider" | "secret_unavailable" => Companion::Contains(&["value"]),
            other => panic!(
                "{other:?} 不在 error.rs 模块注释那张 `| key | 语义 | 配套参数 |` 表的 19 key 目录里"
            ),
        }
    }

    enum Companion {
        Exactly(&'static [&'static str]),
        Contains(&'static [&'static str]),
    }

    fn check(where_: String, reason: &str, extra_keys: &[&str]) {
        match companion(reason) {
            Companion::Exactly(want) => assert_eq!(
                extra_keys, want,
                "{where_}：reason `{reason}` 的配套参数必须恰好是 {want:?}"
            ),
            Companion::Contains(want) => {
                for key in want {
                    assert!(
                        extra_keys.contains(key),
                        "{where_}：reason `{reason}` 必须带 {key:?}，实际 {extra_keys:?}"
                    );
                }
            }
        }
    }

    for site in SITES {
        let error = (site.trigger)();
        let extra = extra_of(&error);
        let keys: Vec<&str> = extra.keys().map(String::as_str).collect();
        // 表里声明的 extra 键集必须与真实实例一致，否则下面的核对是在核对空气
        let declared: Vec<&str> = site.extra.iter().map(|(key, _)| *key).collect();
        assert_eq!(
            keys, declared,
            "#{} {} 的 extra 键集与表不符",
            site.no, site.at
        );
        // 用**生产实例真实的** reason（不是表里声明的那个）核对目录规则：
        // 站点把 reason key 写错时这条不变式也要红，不能只靠主用例兜。
        let actual_reason = error
            .params()
            .remove("reason")
            .unwrap_or_else(|| panic!("#{} {} 没有 reason", site.no, site.at));
        check(format!("#{} {}", site.no, site.at), &actual_reason, &keys);
    }
    for site in UNREACHABLE {
        check(
            format!("#{} {}（不可达）", site.no, site.at),
            site.reason,
            site.extra_keys,
        );
    }
}

/// 不可达站点用源码字面量钉住：reason key 与配套参数名都必须逐字还在。
/// `cargo fmt --check` 是门禁，因此字面量的格式是稳定的。
#[test]
fn unreachable_sites_keep_their_literal_mapping() {
    assert!(!UNREACHABLE.is_empty());
    for site in UNREACHABLE {
        let source = site.file.source();
        let where_ = format!("#{} {}（{}）", site.no, site.at, site.file.path());
        assert!(
            source.contains(site.literal),
            "{where_} 的映射被改动了：源码里找不到 {:#?}",
            site.literal
        );
        // 字面量必须真的带着表里声明的 reason 与 extra 键，否则上面那条 `contains`
        // 只是钉住了一个与声明无关的串
        assert!(
            site.literal.contains(&format!("\"{}\"", site.reason)),
            "{where_}：字面量里没有 reason {:?}",
            site.reason
        );
        for key in site.extra_keys {
            assert!(
                site.literal.contains(&format!(".with_param(\"{key}\"")),
                "{where_}：字面量里没有参数 {key:?}"
            );
        }
    }

    // 每一行都必须写清「为什么不可达」——否则这张表会变成静默跳过站点的垃圾桶。
    for site in UNREACHABLE {
        assert!(
            site.why.trim().len() > 20,
            "#{} {} 缺「为什么不可达」的说明",
            site.no,
            site.at
        );
    }

    // 同一字面量的出现次数也要钉住：少一次就说明某处站点被换掉了。
    let csv_io = File::CsvIo.source();
    let entity_card = File::EntityCard.source();
    assert_eq!(
        csv_io.matches(WRITE_FAILED).count(),
        8,
        "csv_io 的写失败站点数"
    );
    assert_eq!(
        csv_io.matches(PARSE_FAILED).count(),
        1,
        "csv_io 的解析失败站点数"
    );
    assert_eq!(
        entity_card.matches(INVALID_FORMAT_INDEX).count(),
        2,
        "entity_card 里 `invalid_format` + `value=index` 应有 2 处（#46 死代码 + #49）"
    );
}

/// 「怎么数出 50」的可复核方式：反向数源码里的生产站点。
///
/// 各文件的 `#[cfg(test)] mod tests` 都在文件末尾，因此切出 `#[cfg(test)]` 之前的部分
/// 就是生产代码；`error.rs` 的测试模块里有 8 处 `GeoError::validation(` 合成实例
/// （复审者指出的盲区），正好被这条切分排除在外。
fn production_sites(source: &str) -> usize {
    let head = source.split("#[cfg(test)]").next().unwrap_or(source);
    head.matches("GeoError::validation(").count()
        + head.matches("GeoError::conflict(").count()
        + head.matches("GeoError::config(").count()
}

#[test]
fn the_table_covers_every_production_site() {
    // 逐文件点数，与复审者的独立盘点一致：asset 4 / compliance 1 / csv_io 10 /
    // dedupe 0 / entity_card 19 / error 0 / ids 1 / lib 0 / project 11 / prompt 4 = 50。
    // `crates/geo-domain/src/` 下**每个**文件都要列进来：漏掉一个就等于给未来的
    // 生产站点留了一个静默缺口（复审 N-2：此前只列了 7 个，实有 10 个）。
    let per_file: [(&str, &str, usize); 10] = [
        ("asset.rs", include_str!("../src/asset.rs"), 4),
        ("compliance.rs", include_str!("../src/compliance.rs"), 1),
        ("csv_io.rs", include_str!("../src/csv_io.rs"), 10),
        ("dedupe.rs", include_str!("../src/dedupe.rs"), 0),
        ("entity_card.rs", include_str!("../src/entity_card.rs"), 19),
        ("error.rs", include_str!("../src/error.rs"), 0),
        ("ids.rs", include_str!("../src/ids.rs"), 1),
        ("lib.rs", include_str!("../src/lib.rs"), 0),
        ("project.rs", include_str!("../src/project.rs"), 11),
        ("prompt.rs", include_str!("../src/prompt.rs"), 4),
    ];
    let mut total = 0;
    for (name, source, expected) in per_file {
        let actual = production_sites(source);
        assert_eq!(actual, expected, "{name} 的生产站点数变了，表必须同步");
        total += actual;
    }
    assert_eq!(total, 50, "geo-domain 的生产站点总数变了");
    assert_eq!(
        SITES.len() + UNREACHABLE.len(),
        50,
        "两张表合起来必须恰好覆盖 50 处站点（可达 {} + 不可达 {}）",
        SITES.len(),
        UNREACHABLE.len()
    );

    // 表的编号不得重复、不得越界，且必须与 report §1 的 1..=50 一一对应
    let mut numbers: Vec<u8> = SITES
        .iter()
        .map(|site| site.no)
        .chain(UNREACHABLE.iter().map(|site| site.no))
        .collect();
    numbers.sort_unstable();
    numbers.dedup();
    assert_eq!(
        numbers,
        (1..=50).collect::<Vec<u8>>(),
        "站点编号必须是 1..=50 全覆盖"
    );
}
