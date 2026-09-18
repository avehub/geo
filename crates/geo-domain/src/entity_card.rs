//! 品牌实体卡：AI 眼中的品牌 vs 真实的品牌，是事实核查与内容生成的真值源。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::GeoError;
use crate::ids::{ProjectId, RevisionId};

/// 参与完整率计算的必填字段（10 项，见 spec FR-M1-3）。
pub const REQUIRED_FIELDS: [&str; 10] = [
    "standard_name",
    "aliases",
    "founded_year",
    "qualifications",
    "products",
    "price_range",
    "service_regions",
    "cases",
    "differentiators",
    "contact",
];

/// `EntityFields` 的全部字段（含非必填的 `official_tone`）。
pub const ALL_FIELDS: [&str; 11] = [
    "standard_name",
    "aliases",
    "founded_year",
    "qualifications",
    "products",
    "price_range",
    "service_regions",
    "cases",
    "differentiators",
    "official_tone",
    "contact",
];

pub const MIN_FOUNDING_YEAR: i32 = 1800;
pub const MAX_FOUNDING_YEAR: i32 = 2100;
pub const MAX_NAME_CHARS: usize = 100;

/// 字段可信状态：官方口径 / 待确认 / 存疑。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum FieldStatus {
    Official,
    #[default]
    Pending,
    Disputed,
}

impl FieldStatus {
    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::Official => "官方口径",
            Self::Pending => "待确认",
            Self::Disputed => "存疑",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "official" => Some(Self::Official),
            "pending" => Some(Self::Pending),
            "disputed" => Some(Self::Disputed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ProductSpec {
    pub name: String,
    #[serde(default)]
    pub params: Vec<String>,
    pub note: Option<String>,
}

impl ProductSpec {
    pub fn validate(&self) -> Result<(), GeoError> {
        if self.name.trim().is_empty() {
            return Err(GeoError::validation("products.name", "required"));
        }
        if self.name.trim().chars().count() > MAX_NAME_CHARS {
            return Err(GeoError::validation("products.name", "too_long")
                .with_param("limit", MAX_NAME_CHARS));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Contact {
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
}

impl Contact {
    pub fn is_meaningful(&self) -> bool {
        [&self.phone, &self.email, &self.address]
            .iter()
            .any(|item| item.as_ref().is_some_and(|v| !v.trim().is_empty()))
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntityFields {
    pub standard_name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub founded_year: Option<i32>,
    #[serde(default)]
    pub qualifications: Vec<String>,
    #[serde(default)]
    pub products: Vec<ProductSpec>,
    pub price_range: Option<String>,
    #[serde(default)]
    pub service_regions: Vec<String>,
    #[serde(default)]
    pub cases: Vec<String>,
    #[serde(default)]
    pub differentiators: Vec<String>,
    pub official_tone: Option<String>,
    pub contact: Option<Contact>,
}

impl EntityFields {
    /// LLM 抽取结果的合法性校验（结构之外的语义约束）。
    pub fn validate(&self) -> Result<(), GeoError> {
        if self.standard_name.trim().is_empty() {
            return Err(GeoError::validation("standard_name", "required"));
        }
        if self.standard_name.trim().chars().count() > MAX_NAME_CHARS {
            return Err(GeoError::validation("standard_name", "too_long")
                .with_param("limit", MAX_NAME_CHARS));
        }
        if let Some(year) = self.founded_year {
            if !(MIN_FOUNDING_YEAR..=MAX_FOUNDING_YEAR).contains(&year) {
                return Err(
                    GeoError::validation("founded_year", "out_of_range").with_param(
                        "expected",
                        format!("{MIN_FOUNDING_YEAR}~{MAX_FOUNDING_YEAR}"),
                    ),
                );
            }
        }
        for product in &self.products {
            product.validate()?;
        }
        Ok(())
    }

    /// 已填写的必填字段名。
    pub fn filled_fields(&self) -> Vec<&'static str> {
        REQUIRED_FIELDS
            .into_iter()
            .filter(|field| self.is_filled(field))
            .collect()
    }

    pub fn missing_fields(&self) -> Vec<&'static str> {
        REQUIRED_FIELDS
            .into_iter()
            .filter(|field| !self.is_filled(field))
            .collect()
    }

    pub fn is_filled(&self, field: &str) -> bool {
        match field {
            "standard_name" => !self.standard_name.trim().is_empty(),
            "aliases" => !self.aliases.is_empty(),
            "founded_year" => self.founded_year.is_some(),
            "qualifications" => !self.qualifications.is_empty(),
            "products" => !self.products.is_empty(),
            "price_range" => self
                .price_range
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty()),
            "service_regions" => !self.service_regions.is_empty(),
            "cases" => !self.cases.is_empty(),
            "differentiators" => !self.differentiators.is_empty(),
            "contact" => self.contact.as_ref().is_some_and(Contact::is_meaningful),
            "official_tone" => self
                .official_tone
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty()),
            _ => false,
        }
    }

    /// 完整率 = 已填必填字段数 / 10。
    pub fn completeness(&self) -> f64 {
        self.filled_fields().len() as f64 / REQUIRED_FIELDS.len() as f64
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct EntityCardSource {
    #[serde(default)]
    pub crawled_pages: Vec<String>,
    pub llm_provider: Option<String>,
    pub llm_model: Option<String>,
    pub generated_at: Option<DateTime<Utc>>,
}

impl EntityCardSource {
    pub fn is_ai_generated(&self) -> bool {
        self.llm_provider.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityCard {
    pub project_id: ProjectId,
    pub fields: EntityFields,
    /// key 为顶层字段名（如 `products`），值为可信状态。
    pub field_status: HashMap<String, FieldStatus>,
    pub source: EntityCardSource,
    pub completeness: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl EntityCard {
    /// 人工录入（建项向导）来源：已填字段视为官方口径。
    pub fn from_manual(project_id: ProjectId, fields: EntityFields, now: DateTime<Utc>) -> Self {
        Self::build(
            project_id,
            fields,
            EntityCardSource::default(),
            now,
            FieldStatus::Official,
        )
    }

    /// AI 抽取来源：全部字段待人工确认。
    pub fn from_extraction(
        project_id: ProjectId,
        fields: EntityFields,
        source: EntityCardSource,
        now: DateTime<Utc>,
    ) -> Self {
        Self::build(project_id, fields, source, now, FieldStatus::Pending)
    }

    fn build(
        project_id: ProjectId,
        fields: EntityFields,
        source: EntityCardSource,
        now: DateTime<Utc>,
        filled_status: FieldStatus,
    ) -> Self {
        let completeness = fields.completeness();
        let field_status = ALL_FIELDS
            .into_iter()
            .map(|field| {
                let status = if fields.is_filled(field) {
                    filled_status
                } else {
                    FieldStatus::Pending
                };
                (field.to_string(), status)
            })
            .collect();
        Self {
            project_id,
            fields,
            field_status,
            source,
            completeness,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn status_of(&self, field: &str) -> FieldStatus {
        self.field_status
            .get(field)
            .copied()
            .unwrap_or(FieldStatus::Pending)
    }

    /// 需要人工确认的字段（状态为 Pending，或缺失）。
    pub fn pending_fields(&self) -> Vec<&'static str> {
        ALL_FIELDS
            .into_iter()
            .filter(|field| {
                !self.fields.is_filled(field) || self.status_of(field) == FieldStatus::Pending
            })
            .collect()
    }

    pub fn disputed_fields(&self) -> Vec<&'static str> {
        ALL_FIELDS
            .into_iter()
            .filter(|field| self.status_of(field) == FieldStatus::Disputed)
            .collect()
    }

    /// 字段级编辑，返回修订记录用于留痕。
    ///
    /// `path` 支持 `field`、`field.subfield`、`field[0].subfield` 三种形式。
    pub fn set_field(
        &mut self,
        path: &str,
        value: Value,
        status: FieldStatus,
        now: DateTime<Utc>,
        note: Option<String>,
    ) -> Result<EntityCardRevision, GeoError> {
        let segments = parse_path(path)?;
        let root = root_field(&segments)?;
        let mut tree = serde_json::to_value(&self.fields)?;
        let old_value = get_at(&tree, &segments).cloned();
        set_at(&mut tree, &segments, value.clone())?;
        let fields: EntityFields = serde_json::from_value(tree)
            .map_err(|err| GeoError::validation(path, "invalid_format").with_param("value", err))?;
        validate_field(root, &fields)?;

        self.fields = fields;
        self.field_status.insert(root.to_string(), status);
        self.completeness = self.fields.completeness();
        self.updated_at = now;

        Ok(EntityCardRevision {
            id: RevisionId::new(),
            project_id: self.project_id,
            field_path: path.to_string(),
            old_value: old_value.filter(|value| !value.is_null()),
            new_value: Some(value),
            status,
            note: note
                .map(|raw| raw.trim().to_string())
                .filter(|n| !n.is_empty()),
            edited_at: now,
        })
    }
}

/// 仅校验被修改字段自身的约束。整卡校验（`EntityFields::validate`）会在
/// 生成/导入等"完整提交"路径上执行，避免编辑单个字段时被其他未填字段卡住。
fn validate_field(field: &str, fields: &EntityFields) -> Result<(), GeoError> {
    match field {
        "standard_name" => {
            if fields.standard_name.trim().is_empty() {
                return Err(GeoError::validation("standard_name", "required"));
            }
            if fields.standard_name.trim().chars().count() > MAX_NAME_CHARS {
                return Err(GeoError::validation("standard_name", "too_long")
                    .with_param("limit", MAX_NAME_CHARS));
            }
        }
        "founded_year" => {
            if let Some(year) = fields.founded_year {
                if !(MIN_FOUNDING_YEAR..=MAX_FOUNDING_YEAR).contains(&year) {
                    return Err(
                        GeoError::validation("founded_year", "out_of_range").with_param(
                            "expected",
                            format!("{MIN_FOUNDING_YEAR}~{MAX_FOUNDING_YEAR}"),
                        ),
                    );
                }
            }
        }
        "products" => {
            for product in &fields.products {
                product.validate()?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityCardRevision {
    pub id: RevisionId,
    pub project_id: ProjectId,
    pub field_path: String,
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
    pub status: FieldStatus,
    pub note: Option<String>,
    pub edited_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Segment {
    Key(String),
    Index(usize),
}

fn parse_path(path: &str) -> Result<Vec<Segment>, GeoError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(GeoError::validation("field_path", "required"));
    }
    let mut segments = Vec::new();
    for part in trimmed.split('.') {
        let (key, rest) = match part.find('[') {
            Some(index) => (&part[..index], Some(&part[index..])),
            None => (part, None),
        };
        if !key.is_empty() {
            segments.push(Segment::Key(key.to_string()));
        }
        if let Some(rest) = rest {
            for chunk in rest.split('[') {
                let chunk = chunk.trim_end_matches(']');
                if chunk.is_empty() {
                    continue;
                }
                let index: usize = chunk.parse().map_err(|_| {
                    GeoError::validation("field_path", "invalid_format").with_param("value", chunk)
                })?;
                segments.push(Segment::Index(index));
            }
        }
    }
    if segments.is_empty() {
        return Err(GeoError::validation("field_path", "required"));
    }
    if !matches!(segments[0], Segment::Key(_)) {
        return Err(GeoError::validation("field_path", "invalid_format").with_param("value", path));
    }
    Ok(segments)
}

fn root_field(segments: &[Segment]) -> Result<&'static str, GeoError> {
    match &segments[0] {
        Segment::Key(key) => ALL_FIELDS
            .into_iter()
            .find(|field| *field == key.as_str())
            .ok_or_else(|| {
                GeoError::validation("field_path", "unknown_field").with_param("value", key)
            }),
        Segment::Index(index) => {
            Err(GeoError::validation("field_path", "invalid_format").with_param("value", index))
        }
    }
}

fn get_at<'a>(root: &'a Value, segments: &[Segment]) -> Option<&'a Value> {
    let mut current = root;
    for segment in segments {
        current = match segment {
            Segment::Key(key) => current.get(key)?,
            Segment::Index(index) => current.get(*index)?,
        };
    }
    Some(current)
}

fn set_at(root: &mut Value, segments: &[Segment], value: Value) -> Result<(), GeoError> {
    let mut current = root;
    let last = segments.len() - 1;
    for (depth, segment) in segments.iter().enumerate() {
        let is_last = depth == last;
        match segment {
            Segment::Key(key) => {
                if !current.is_object() {
                    return Err(GeoError::validation("field_path", "invalid_format")
                        .with_param("value", key));
                }
                if is_last {
                    current[key] = value;
                    return Ok(());
                }
                let entry = current.get_mut(key).ok_or_else(|| {
                    GeoError::validation("field_path", "unknown_field").with_param("value", key)
                })?;
                current = entry;
            }
            Segment::Index(index) => {
                let array = current.as_array_mut().ok_or_else(|| {
                    GeoError::validation("field_path", "invalid_format").with_param("value", index)
                })?;
                if *index >= array.len() {
                    // 空数组的合法区间本身就是空的，`len - 1` 会下溢成谎话（"0~0"），
                    // 因此退化成 `<0`：同样是语言中立表达式，词典模板照渲染。
                    let expected = if array.is_empty() {
                        "<0".to_string()
                    } else {
                        format!("0~{}", array.len() - 1)
                    };
                    return Err(GeoError::validation("field_path", "out_of_range")
                        .with_param("expected", expected)
                        .with_param("value", index));
                }
                if is_last {
                    array[*index] = value;
                    return Ok(());
                }
                current = &mut array[*index];
            }
        }
    }
    Ok(())
}

/// 从建项向导数据构造初始实体卡字段（产品与地域直接复用用户输入）。
pub fn fields_from_draft(
    brand_name: &str,
    aliases: &[String],
    region: Option<&str>,
    products: Vec<ProductSpec>,
    service_scope: Option<&str>,
    website: Option<&str>,
) -> EntityFields {
    let mut fields = EntityFields {
        standard_name: brand_name.trim().to_string(),
        aliases: aliases.to_vec(),
        products,
        ..Default::default()
    };
    if let Some(region) = region.map(str::trim).filter(|value| !value.is_empty()) {
        fields.service_regions.push(region.to_string());
    }
    if let Some(scope) = service_scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !fields.service_regions.contains(&scope.to_string()) {
            fields.service_regions.push(scope.to_string());
        }
    }
    if let Some(website) = website {
        fields.contact = Some(Contact {
            address: None,
            email: None,
            phone: None,
        });
        fields.official_tone = Some(format!("官方网址：{website}"));
    }
    fields
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
    }

    fn full_fields() -> EntityFields {
        EntityFields {
            standard_name: "稿得快".to_string(),
            aliases: vec!["GDK".to_string()],
            founded_year: Some(2016),
            qualifications: vec!["ISO9001".to_string()],
            products: vec![ProductSpec {
                name: "GEO 客户端".to_string(),
                params: vec!["7 引擎".to_string()],
                note: None,
            }],
            price_range: Some("¥399/月".to_string()),
            service_regions: vec!["全国".to_string()],
            cases: vec!["某制造企业".to_string()],
            differentiators: vec!["证据可回溯".to_string()],
            official_tone: Some("专业、克制".to_string()),
            contact: Some(Contact {
                phone: Some("400-000-0000".to_string()),
                email: None,
                address: None,
            }),
        }
    }

    #[test]
    fn empty_card_has_zero_completeness_and_ten_missing_fields() {
        let fields = EntityFields::default();
        assert_eq!(fields.completeness(), 0.0);
        assert_eq!(fields.missing_fields().len(), REQUIRED_FIELDS.len());
    }

    #[test]
    fn full_card_has_full_completeness() {
        assert_eq!(full_fields().completeness(), 1.0);
        assert!(full_fields().missing_fields().is_empty());
    }

    #[test]
    fn eight_filled_fields_give_zero_point_eight() {
        let mut fields = full_fields();
        fields.cases.clear();
        fields.contact = None;
        let completeness = fields.completeness();
        assert!((completeness - 0.8).abs() < 1e-9, "实际 {completeness}");
        assert_eq!(fields.missing_fields(), vec!["cases", "contact"]);
    }

    #[test]
    fn contact_with_all_empty_values_counts_as_missing() {
        let mut fields = full_fields();
        fields.contact = Some(Contact::default());
        assert!(fields.missing_fields().contains(&"contact"));
    }

    #[test]
    fn validate_rejects_empty_name_and_bad_year() {
        let mut fields = full_fields();
        fields.standard_name = "  ".into();
        let err = fields.validate().unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert_eq!(err.params()["field"], "standard_name");
        assert_eq!(err.params()["reason"], "required");
        assert_eq!(
            err.user_message(),
            "validation/failed field=standard_name reason=required"
        );
        let mut fields = full_fields();
        fields.founded_year = Some(1700);
        assert!(fields.validate().is_err());
    }

    #[test]
    fn manual_card_marks_filled_fields_official() {
        let card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        assert_eq!(card.status_of("standard_name"), FieldStatus::Official);
        assert_eq!(card.completeness, 1.0);
        assert!(card.pending_fields().is_empty());
    }

    #[test]
    fn extracted_card_marks_everything_pending() {
        let source = EntityCardSource {
            crawled_pages: vec!["https://example.com".into()],
            llm_provider: Some("deepseek".into()),
            llm_model: Some("deepseek-chat".into()),
            generated_at: Some(now()),
        };
        let card = EntityCard::from_extraction(ProjectId::new(), full_fields(), source, now());
        assert_eq!(card.status_of("standard_name"), FieldStatus::Pending);
        assert_eq!(card.pending_fields().len(), ALL_FIELDS.len());
        assert!(card.source.is_ai_generated());
    }

    #[test]
    fn set_field_updates_value_status_and_returns_revision() {
        let mut card = EntityCard::from_extraction(
            ProjectId::new(),
            EntityFields::default(),
            EntityCardSource::default(),
            now(),
        );
        assert_eq!(card.completeness, 0.0);
        let later = now() + chrono::Duration::hours(1);
        let revision = card
            .set_field(
                "founded_year",
                json!(2016),
                FieldStatus::Official,
                later,
                Some("官网 About".into()),
            )
            .unwrap();
        assert_eq!(revision.field_path, "founded_year");
        assert!(revision.old_value.is_none(), "原值为 null 时不记录");
        assert_eq!(revision.new_value, Some(json!(2016)));
        assert_eq!(revision.status, FieldStatus::Official);
        assert_eq!(revision.note.as_deref(), Some("官网 About"));
        assert_eq!(revision.edited_at, later);
        assert_eq!(card.fields.founded_year, Some(2016));
        assert_eq!(card.status_of("founded_year"), FieldStatus::Official);
        assert_eq!(card.updated_at, later);
        assert!((card.completeness - 0.1).abs() < 1e-9);
    }

    #[test]
    fn set_field_records_previous_value() {
        let mut card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        let revision = card
            .set_field(
                "price_range",
                json!("¥599/月"),
                FieldStatus::Official,
                now(),
                None,
            )
            .unwrap();
        assert_eq!(revision.old_value, Some(json!("¥399/月")));
        assert_eq!(card.fields.price_range.as_deref(), Some("¥599/月"));
    }

    #[test]
    fn set_field_supports_nested_paths() {
        let mut card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        let revision = card
            .set_field(
                "products[0].name",
                json!("GEO 客户端 Pro"),
                FieldStatus::Official,
                now(),
                None,
            )
            .unwrap();
        assert_eq!(revision.field_path, "products[0].name");
        assert_eq!(card.fields.products[0].name, "GEO 客户端 Pro");
        // 嵌套路径的状态归属到顶层字段
        assert_eq!(card.status_of("products"), FieldStatus::Official);
    }

    #[test]
    fn set_field_rejects_unknown_field_and_bad_index() {
        let mut card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        let err = card
            .set_field(
                "unknown_field",
                json!("x"),
                FieldStatus::Official,
                now(),
                None,
            )
            .unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert!(card
            .set_field(
                "products[9].name",
                json!("x"),
                FieldStatus::Official,
                now(),
                None
            )
            .is_err());
        assert!(card
            .set_field("", json!("x"), FieldStatus::Official, now(), None)
            .is_err());
    }

    /// 下标越界要给出语言中立的合法区间：非空数组是 `0~{len-1}`，
    /// 空数组退化成 `<0`（`len - 1` 会下溢，写出「0~0」就是谎话）。
    #[test]
    fn out_of_range_index_reports_a_language_neutral_expected_range() {
        let mut card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        let err = card
            .set_field(
                "products[9].name",
                json!("x"),
                FieldStatus::Official,
                now(),
                None,
            )
            .unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert_eq!(err.params()["field"], "field_path");
        assert_eq!(err.params()["reason"], "out_of_range");
        assert_eq!(err.params()["expected"], "0~0", "只有 1 个产品");
        assert_eq!(err.params()["value"], "9");

        let mut empty = EntityCard::from_manual(
            ProjectId::new(),
            EntityFields {
                products: Vec::new(),
                ..full_fields()
            },
            now(),
        );
        let err = empty
            .set_field(
                "products[0].name",
                json!("x"),
                FieldStatus::Official,
                now(),
                None,
            )
            .unwrap_err();
        assert_eq!(err.params()["reason"], "out_of_range");
        assert_eq!(err.params()["expected"], "<0", "空数组没有合法下标");
        assert_eq!(err.params()["value"], "0");
    }

    #[test]
    fn set_field_rejects_wrong_type() {
        let mut card = EntityCard::from_manual(ProjectId::new(), full_fields(), now());
        assert!(card
            .set_field(
                "founded_year",
                json!("二〇一六"),
                FieldStatus::Official,
                now(),
                None
            )
            .is_err());
    }

    #[test]
    fn fields_from_draft_maps_wizard_input() {
        let fields = fields_from_draft(
            "稿得快",
            &["GDK".to_string()],
            Some("华东"),
            vec![ProductSpec {
                name: "GEO 客户端".into(),
                params: vec![],
                note: None,
            }],
            Some("全国"),
            Some("https://www.gaodekuai.com"),
        );
        assert_eq!(fields.standard_name, "稿得快");
        assert_eq!(fields.service_regions, vec!["华东", "全国"]);
        assert_eq!(fields.products.len(), 1);
        assert!(fields.contact.is_some());
        assert!(fields.official_tone.unwrap().contains("gaodekuai.com"));
    }

    #[test]
    fn field_status_serializes_to_snake_case() {
        assert_eq!(
            serde_json::to_string(&FieldStatus::Official).unwrap(),
            "\"official\""
        );
        assert_eq!(FieldStatus::parse("disputed"), Some(FieldStatus::Disputed));
        assert_eq!(FieldStatus::Official.label_zh(), "官方口径");
    }
}
