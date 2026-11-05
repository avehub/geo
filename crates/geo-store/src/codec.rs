//! 领域值 ↔ SQLite 列文本的编解码（ID / 时间 / 枚举 / JSON 列）。
//!
//! 存储约定（见 spec 3.1 与 `AGENTS.md`）：
//! - ID：UUIDv4 文本（`ProjectId` 等 newtype 的 `Display` / `FromStr`）；
//! - 时间：RFC3339 UTC 文本，**固定纳秒精度**，因此文本序即时间序，可直接用 SQL 排序；
//! - 枚举：其 serde snake_case 序列化值（与前端契约、CSV 导入导出保持同一套字符串）；
//! - 集合与嵌套结构：`serde_json` 文本。
//!
//! 解码失败统一归入 [`StoreError::Serde`]（稳定码 `data/invalid`）：这类错误只可能来自
//! 库内数据被外部改坏或版本不兼容，不是调用方的输入问题。

use chrono::{DateTime, SecondsFormat, Utc};
use serde::de::{DeserializeOwned, Error as SerdeDeError};
use serde::Serialize;
use serde_json::Value;

use crate::error::StoreError;

/// 时间列文本，形如 `2026-09-16T08:00:00.000000000Z`。
pub(crate) fn encode_time(value: &DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Nanos, true)
}

/// 解析时间列。
pub(crate) fn decode_time(raw: &str) -> Result<DateTime<Utc>, StoreError> {
    DateTime::parse_from_rfc3339(raw)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|error| serde_error(error.to_string()))
}

/// 序列化为裸字符串的领域值（枚举 / ID）→ 列文本。
pub(crate) fn encode_scalar<T: Serialize>(value: &T) -> Result<String, StoreError> {
    match serde_json::to_value(value)? {
        Value::String(text) => Ok(text),
        // M-7：报 **ASCII 记号 + 值的类型名**，不是中文散文。`StoreError::Serde` 的
        // `reason` 走 raw passthrough（目录规则 4）直送前端，一句中文会被前端按
        // 「查不到就原样显示」渲进 en-US 界面。
        // 也**不许**把 `other` 本身插进消息：那是库内数据，可能含中文品牌名。
        other => Err(serde_error(format!(
            "expected_string_column:{}",
            json_kind(&other)
        ))),
    }
}

/// `serde_json::Value` 的类型名（ASCII 记号，供 [`encode_scalar`] 的报错用）。
fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// 列文本 → 序列化为裸字符串的领域值（枚举 / ID）。
pub(crate) fn decode_scalar<T: DeserializeOwned>(raw: &str) -> Result<T, StoreError> {
    serde_json::from_value(Value::String(raw.to_string())).map_err(StoreError::Serde)
}

/// 集合 / 嵌套结构 → JSON 文本列。
pub(crate) fn encode_json<T: Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(StoreError::Serde)
}

/// JSON 文本列 → 集合 / 嵌套结构。
pub(crate) fn decode_json<T: DeserializeOwned>(raw: &str) -> Result<T, StoreError> {
    serde_json::from_str(raw).map_err(StoreError::Serde)
}

/// `u8` 领域值 → INTEGER 列（SQLite 无无符号整型）。
pub(crate) fn encode_u8(value: u8) -> i32 {
    i32::from(value)
}

/// INTEGER 列 → `u8` 领域值；越界视为库内数据损坏。
pub(crate) fn decode_u8(value: i32) -> Result<u8, StoreError> {
    u8::try_from(value).map_err(|error| serde_error(error.to_string()))
}

/// 把"库内数据无法反序列化"统一表达成 `serde_json::Error`，从而复用 `StoreError::Serde`。
fn serde_error(reason: String) -> StoreError {
    StoreError::Serde(SerdeDeError::custom(reason))
}

/// 可空 JSON 列：`None` 存 NULL；`Some` 存 serde JSON 文本。
pub(crate) fn encode_optional_json<T: Serialize>(
    value: &Option<T>,
) -> Result<Option<String>, StoreError> {
    match value {
        Some(value) => Ok(Some(
            serde_json::to_string(value).map_err(StoreError::Serde)?,
        )),
        None => Ok(None),
    }
}

/// 可空 JSON 列 → `Option<T>`；NULL 回 `None`。
pub(crate) fn decode_optional_json<T: DeserializeOwned>(
    raw: Option<String>,
) -> Result<Option<T>, StoreError> {
    match raw {
        Some(text) => Ok(Some(
            serde_json::from_str(&text).map_err(StoreError::Serde)?,
        )),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use geo_domain::{FieldStatus, Industry, IntentCategory, Language, ProjectId, ProjectStatus};
    use serde_json::json;
    use std::collections::HashMap;

    fn time(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(1_780_000_000 + secs, 123_000_000)
            .unwrap()
    }

    #[test]
    fn time_column_is_fixed_width_rfc3339_utc() {
        let encoded = encode_time(&time(0));
        assert!(encoded.ends_with('Z'), "应使用 UTC 的 Z 后缀：{encoded}");
        assert_eq!(encoded, "2026-05-28T20:26:40.123000000Z");
        assert_eq!(decode_time(&encoded).unwrap(), time(0));
    }

    #[test]
    fn time_text_order_matches_chronological_order() {
        let earlier = encode_time(&time(0));
        let later = encode_time(&time(3600));
        assert!(earlier < later, "文本序必须等价于时间序");
        assert_eq!(encode_time(&time(0)).len(), later.len(), "定宽才能直接比较");
    }

    #[test]
    fn invalid_time_text_is_serde_error() {
        let error = decode_time("不是时间").unwrap_err();
        assert!(matches!(error, StoreError::Serde(_)));
        assert_eq!(error.code(), "data/invalid");
    }

    #[test]
    fn enums_roundtrip_through_snake_case_text() {
        assert_eq!(
            encode_scalar(&Industry::CrossBorderEcommerce).unwrap(),
            "cross_border_ecommerce"
        );
        assert_eq!(encode_scalar(&Industry::Other).unwrap(), "other");
        assert_eq!(encode_scalar(&ProjectStatus::Archived).unwrap(), "archived");
        assert_eq!(encode_scalar(&Language::ZhCn).unwrap(), "zh_cn");
        assert_eq!(encode_scalar(&FieldStatus::Disputed).unwrap(), "disputed");
        assert_eq!(
            encode_scalar(&IntentCategory::ProfessionalLongTail).unwrap(),
            "professional_long_tail"
        );
        assert_eq!(
            decode_scalar::<Industry>("cross_border_ecommerce").unwrap(),
            Industry::CrossBorderEcommerce
        );
        assert_eq!(
            decode_scalar::<FieldStatus>("official").unwrap(),
            FieldStatus::Official
        );
    }

    #[test]
    fn enum_text_matches_serde_representation() {
        // 列文本必须与 serde 输出一致，否则前端契约与库内值会分叉。
        for industry in Industry::all() {
            let column = encode_scalar(&industry).unwrap();
            let json = serde_json::to_string(&industry).unwrap();
            assert_eq!(format!("\"{column}\""), json);
            assert_eq!(decode_scalar::<Industry>(&column).unwrap(), industry);
        }
    }

    /// M-7：非字符串列的报错是 ASCII 记号 + 值的类型名，不是「期望字符串列，实际是 …」。
    #[test]
    fn non_string_scalar_reports_an_ascii_token_with_the_json_kind() {
        for (value, kind) in [
            (json!(123), "number"),
            (json!(["a"]), "array"),
            (json!({"a": 1}), "object"),
            (json!(true), "boolean"),
            (json!(null), "null"),
        ] {
            let error = encode_scalar(&value).expect_err("非字符串列必须报错");
            assert!(matches!(error, StoreError::Serde(_)), "{error:?}");
            assert_eq!(error.code(), "data/invalid");
            assert_eq!(
                error.params()["reason"],
                format!("expected_string_column:{kind}"),
                "{error}"
            );
            assert!(
                error.params()["reason"].is_ascii(),
                "reason 直送前端，不许出现非 ASCII：{error}"
            );
        }
        // 库内数据本身（可能含中文品牌名）不许被插进消息
        let error = encode_scalar(&json!({"standard_name": "宏宇泵业"})).unwrap_err();
        assert!(!error.to_string().contains("宏宇泵业"), "{error}");
    }

    #[test]
    fn unknown_enum_text_is_serde_error() {
        let error = decode_scalar::<Industry>("不存在的行业").unwrap_err();
        assert!(matches!(error, StoreError::Serde(_)));
    }

    #[test]
    fn ids_roundtrip_as_text() {
        let id = ProjectId::new();
        let column = encode_scalar(&id).unwrap();
        assert_eq!(column, id.to_string());
        assert_eq!(decode_scalar::<ProjectId>(&column).unwrap(), id);
        assert!(decode_scalar::<ProjectId>("not-a-uuid").is_err());
    }

    #[test]
    fn json_columns_roundtrip() {
        let aliases = vec!["别名一".to_string(), "别名二".to_string()];
        let column = encode_json(&aliases).unwrap();
        assert_eq!(column, r#"["别名一","别名二"]"#);
        assert_eq!(decode_json::<Vec<String>>(&column).unwrap(), aliases);

        let mut status = HashMap::new();
        status.insert("products".to_string(), FieldStatus::Official);
        status.insert("contact".to_string(), FieldStatus::Disputed);
        let column = encode_json(&status).unwrap();
        assert_eq!(
            decode_json::<HashMap<String, FieldStatus>>(&column).unwrap(),
            status
        );
    }

    #[test]
    fn broken_json_column_is_serde_error() {
        let error = decode_json::<Vec<String>>("not-json").unwrap_err();
        assert!(matches!(error, StoreError::Serde(_)));
        assert_eq!(error.code(), "data/invalid");
    }

    #[test]
    fn u8_columns_roundtrip_and_reject_overflow() {
        assert_eq!(encode_u8(5), 5);
        assert_eq!(decode_u8(5).unwrap(), 5);
        assert_eq!(decode_u8(0).unwrap(), 0);
        let error = decode_u8(300).unwrap_err();
        assert!(matches!(error, StoreError::Serde(_)));
        let error = decode_u8(-1).unwrap_err();
        assert!(matches!(error, StoreError::Serde(_)));
    }
}
