//! 项目、品牌、竞品模型与建项向导校验规则（产品文档 M1）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::asset::{clean_optional, normalize_url, AssetKind, ProjectAsset};
use crate::entity_card::ProductSpec;
use crate::error::GeoError;
use crate::ids::{CompetitorId, ProjectId};

pub const MAX_BRAND_NAME_CHARS: usize = 50;
pub const MAX_PROJECT_NAME_CHARS: usize = 80;
pub const MAX_ALIAS_CHARS: usize = 50;
pub const MAX_ALIASES: usize = 20;
pub const MAX_COMPETITORS: usize = 5;
pub const MAX_REGION_CHARS: usize = 50;
pub const MAX_TAGS: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ProjectStatus {
    #[default]
    Active,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum Language {
    #[default]
    ZhCn,
    EnUs,
}

impl Language {
    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::ZhCn => "简体中文",
            Self::EnUs => "英文",
        }
    }
}

/// 行业模板维度。`Other` 的具体名称放在 `Project::industry_label`，
/// 避免枚举携带数据导致前端契约复杂化。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum Industry {
    #[default]
    B2bManufacturing,
    EnterpriseSaas,
    LocalService,
    CrossBorderEcommerce,
    Franchise,
    Other,
}

impl Industry {
    pub fn all() -> [Self; 6] {
        [
            Self::B2bManufacturing,
            Self::EnterpriseSaas,
            Self::LocalService,
            Self::CrossBorderEcommerce,
            Self::Franchise,
            Self::Other,
        ]
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::B2bManufacturing => "B2B 制造与工业品",
            Self::EnterpriseSaas => "企业服务/SaaS",
            Self::LocalService => "本地生活与专业服务",
            Self::CrossBorderEcommerce => "跨境电商",
            Self::Franchise => "招商加盟",
            Self::Other => "其他行业",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub brand_name: String,
    pub aliases: Vec<String>,
    pub website: Option<String>,
    pub region: String,
    pub language: Language,
    pub industry: Industry,
    pub industry_label: Option<String>,
    pub tags: Vec<String>,
    pub status: ProjectStatus,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Project {
    pub fn is_archived(&self) -> bool {
        self.status == ProjectStatus::Archived
    }

    pub fn archive(&mut self, now: DateTime<Utc>) {
        self.status = ProjectStatus::Archived;
        self.archived_at = Some(now);
        self.updated_at = now;
    }

    pub fn unarchive(&mut self, now: DateTime<Utc>) {
        self.status = ProjectStatus::Active;
        self.archived_at = None;
        self.updated_at = now;
    }

    pub fn touch(&mut self, now: DateTime<Utc>) {
        self.updated_at = now;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Competitor {
    pub id: CompetitorId,
    pub project_id: ProjectId,
    pub name: String,
    pub aliases: Vec<String>,
    pub website: Option<String>,
    pub note: Option<String>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CompetitorDraft {
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub website: Option<String>,
    pub note: Option<String>,
}

/// 建项向导（5 步）收集的输入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ProjectDraft {
    /// 步骤 1：品牌名与别名/常见错写
    pub brand_name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// 项目名，缺省取品牌名
    pub name: Option<String>,
    /// 步骤 2：官网与核心页面
    pub website: Option<String>,
    #[serde(default)]
    pub core_pages: Vec<String>,
    /// 步骤 3：产品线与服务范围
    #[serde(default)]
    pub products: Vec<ProductSpec>,
    pub service_scope: Option<String>,
    /// 步骤 4：目标地域与语言
    pub region: Option<String>,
    #[serde(default)]
    pub language: Language,
    #[serde(default)]
    pub industry: Industry,
    pub industry_label: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// 步骤 5：竞品 3~5 家
    #[serde(default)]
    pub competitors: Vec<CompetitorDraft>,
}

/// 建项产物：项目本体 + 竞品 + 由核心页面生成的自有资产。
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectBundle {
    pub project: Project,
    pub competitors: Vec<Competitor>,
    pub assets: Vec<ProjectAsset>,
}

impl ProjectDraft {
    pub fn validate(&self) -> Result<(), GeoError> {
        let brand = self.brand_name.trim();
        if brand.is_empty() {
            return Err(GeoError::validation("brand_name", "required"));
        }
        if brand.chars().count() > MAX_BRAND_NAME_CHARS {
            return Err(GeoError::validation("brand_name", "too_long")
                .with_param("limit", MAX_BRAND_NAME_CHARS));
        }
        if self.aliases.len() > MAX_ALIASES {
            return Err(GeoError::validation("aliases", "out_of_range")
                .with_param("expected", format!("<={MAX_ALIASES}")));
        }
        for alias in &self.aliases {
            let alias = alias.trim();
            if alias.is_empty() {
                return Err(GeoError::validation("aliases", "required"));
            }
            if alias.chars().count() > MAX_ALIAS_CHARS {
                return Err(GeoError::validation("aliases", "too_long")
                    .with_param("limit", MAX_ALIAS_CHARS));
            }
        }
        if let Some(name) = clean_optional(self.name.clone()) {
            if name.chars().count() > MAX_PROJECT_NAME_CHARS {
                return Err(GeoError::validation("name", "too_long")
                    .with_param("limit", MAX_PROJECT_NAME_CHARS));
            }
        }
        if let Some(website) = clean_optional(self.website.clone()) {
            normalize_url("website", &website)?;
        }
        for (index, page) in self.core_pages.iter().enumerate() {
            if page.trim().is_empty() {
                continue;
            }
            normalize_url(&format!("core_pages[{index}]"), page)?;
        }
        for product in &self.products {
            product.validate()?;
        }
        if let Some(region) = clean_optional(self.region.clone()) {
            if region.chars().count() > MAX_REGION_CHARS {
                return Err(GeoError::validation("region", "too_long")
                    .with_param("limit", MAX_REGION_CHARS));
            }
        }
        if self.tags.len() > MAX_TAGS {
            return Err(GeoError::validation("tags", "out_of_range")
                .with_param("expected", format!("<={MAX_TAGS}")));
        }
        if self.competitors.len() > MAX_COMPETITORS {
            return Err(GeoError::validation("competitors", "out_of_range")
                .with_param("expected", format!("<={MAX_COMPETITORS}")));
        }
        for (index, competitor) in self.competitors.iter().enumerate() {
            let name = competitor.name.trim();
            if name.is_empty() {
                return Err(GeoError::validation(
                    format!("competitors[{index}].name"),
                    "required",
                ));
            }
            if name.chars().count() > MAX_BRAND_NAME_CHARS {
                return Err(
                    GeoError::validation(format!("competitors[{index}].name"), "too_long")
                        .with_param("limit", MAX_BRAND_NAME_CHARS),
                );
            }
            if let Some(website) = clean_optional(competitor.website.clone()) {
                normalize_url(&format!("competitors[{index}].website"), &website)?;
            }
        }
        Ok(())
    }

    /// 校验通过后落库前的领域对象构造。`now` 由调用方注入以便测试。
    pub fn build(&self, now: DateTime<Utc>) -> Result<ProjectBundle, GeoError> {
        self.validate()?;
        let project_id = ProjectId::new();
        let brand = self.brand_name.trim().to_string();
        let project = Project {
            id: project_id,
            name: clean_optional(self.name.clone()).unwrap_or_else(|| brand.clone()),
            brand_name: brand.clone(),
            aliases: dedupe_trimmed(self.aliases.clone()),
            website: clean_optional(self.website.clone())
                .map(|raw| normalize_url("website", &raw))
                .transpose()?,
            region: clean_optional(self.region.clone()).unwrap_or_else(|| "全国".to_string()),
            language: self.language,
            industry: self.industry,
            industry_label: clean_optional(self.industry_label.clone()),
            tags: dedupe_trimmed(self.tags.clone()),
            status: ProjectStatus::Active,
            archived_at: None,
            created_at: now,
            updated_at: now,
        };
        let competitors = self
            .competitors
            .iter()
            .enumerate()
            .map(|(index, draft)| Competitor {
                id: CompetitorId::new(),
                project_id,
                name: draft.name.trim().to_string(),
                aliases: dedupe_trimmed(draft.aliases.clone()),
                website: clean_optional(draft.website.clone()),
                note: clean_optional(draft.note.clone()),
                position: index as i32,
                created_at: now,
            })
            .collect();
        let mut assets: Vec<ProjectAsset> = Vec::new();
        if let Some(website) = &project.website {
            assets.push(ProjectAsset::new(
                project_id,
                AssetKind::OwnedPage,
                website.clone(),
                Some("官网首页".to_string()),
                None,
                now,
            )?);
        }
        for page in &self.core_pages {
            if page.trim().is_empty() {
                continue;
            }
            assets.push(ProjectAsset::new(
                project_id,
                AssetKind::OwnedPage,
                page.clone(),
                None,
                None,
                now,
            )?);
        }
        Ok(ProjectBundle {
            project,
            competitors,
            assets,
        })
    }
}

fn dedupe_trimmed(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
    }

    fn valid_draft() -> ProjectDraft {
        ProjectDraft {
            brand_name: "稿得快".to_string(),
            aliases: vec!["GDK".to_string(), "稿得快AI".to_string()],
            name: None,
            website: Some("www.gaodekuai.com".to_string()),
            core_pages: vec!["https://www.gaodekuai.com/about".to_string()],
            products: vec![ProductSpec {
                name: "GEO 客户端".to_string(),
                params: vec!["7 引擎".to_string()],
                note: None,
            }],
            service_scope: Some("全国".to_string()),
            region: Some("华东".to_string()),
            language: Language::ZhCn,
            industry: Industry::EnterpriseSaas,
            industry_label: None,
            tags: vec!["SaaS".to_string()],
            competitors: vec![
                CompetitorDraft {
                    name: "SheepGeo".to_string(),
                    aliases: vec![],
                    website: Some("https://sheepgeo.example".to_string()),
                    note: None,
                },
                CompetitorDraft {
                    name: "GEOBase".to_string(),
                    aliases: vec![],
                    website: None,
                    note: None,
                },
            ],
        }
    }

    #[test]
    fn industry_serializes_to_snake_case_contract() {
        assert_eq!(
            serde_json::to_string(&Industry::B2bManufacturing).unwrap(),
            "\"b2b_manufacturing\""
        );
        assert_eq!(
            serde_json::to_string(&Industry::CrossBorderEcommerce).unwrap(),
            "\"cross_border_ecommerce\""
        );
        assert_eq!(serde_json::to_string(&Language::ZhCn).unwrap(), "\"zh_cn\"");
        assert_eq!(Industry::all().len(), 6);
    }

    #[test]
    fn rejects_empty_brand_name() {
        let mut draft = valid_draft();
        draft.brand_name = "   ".to_string();
        let err = draft.validate().unwrap_err();
        assert!(err.user_message().contains("brand_name"));
    }

    #[test]
    fn rejects_overlong_brand_name() {
        let mut draft = valid_draft();
        draft.brand_name = "字".repeat(MAX_BRAND_NAME_CHARS + 1);
        let err = draft.validate().unwrap_err();
        assert!(err.user_message().contains("brand_name"));
    }

    #[test]
    fn rejects_invalid_website() {
        let mut draft = valid_draft();
        draft.website = Some("not a url".to_string());
        assert!(draft.validate().is_err());
    }

    #[test]
    fn rejects_more_than_five_competitors() {
        let mut draft = valid_draft();
        draft.competitors = (0..6)
            .map(|index| CompetitorDraft {
                name: format!("竞品{index}"),
                ..Default::default()
            })
            .collect();
        let err = draft.validate().unwrap_err();
        assert!(err.user_message().contains("competitors"));
    }

    #[test]
    fn rejects_competitor_without_name() {
        let mut draft = valid_draft();
        draft.competitors = vec![CompetitorDraft::default()];
        assert!(draft.validate().is_err());
    }

    #[test]
    fn build_defaults_name_to_brand_and_normalizes_website() {
        let bundle = valid_draft().build(now()).unwrap();
        assert_eq!(bundle.project.name, "稿得快");
        assert_eq!(
            bundle.project.website.as_deref(),
            Some("https://www.gaodekuai.com")
        );
        assert_eq!(bundle.project.status, ProjectStatus::Active);
        assert_eq!(bundle.project.created_at, now());
        assert_eq!(bundle.project.updated_at, now());
        assert!(bundle.project.archived_at.is_none());
    }

    #[test]
    fn build_creates_competitors_with_positions_and_assets() {
        let bundle = valid_draft().build(now()).unwrap();
        assert_eq!(bundle.competitors.len(), 2);
        assert_eq!(
            bundle
                .competitors
                .iter()
                .map(|c| c.position)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(bundle.competitors[0].project_id, bundle.project.id);
        // 官网首页 + 1 个核心页面
        assert_eq!(bundle.assets.len(), 2);
        assert!(bundle.assets.iter().all(|a| a.kind == AssetKind::OwnedPage));
    }

    #[test]
    fn build_dedupes_aliases_and_tags() {
        let mut draft = valid_draft();
        draft.aliases = vec!["GDK".into(), " GDK ".into(), "GDK".into()];
        draft.tags = vec!["a".into(), "a".into(), " ".into()];
        let bundle = draft.build(now()).unwrap();
        assert_eq!(bundle.project.aliases, vec!["GDK"]);
        assert_eq!(bundle.project.tags, vec!["a"]);
    }

    #[test]
    fn archive_and_unarchive_update_status_and_timestamps() {
        let mut project = valid_draft().build(now()).unwrap().project;
        let later = now() + chrono::Duration::days(1);
        project.archive(later);
        assert!(project.is_archived());
        assert_eq!(project.archived_at, Some(later));
        assert_eq!(project.updated_at, later);
        project.unarchive(later + chrono::Duration::days(1));
        assert!(!project.is_archived());
        assert!(project.archived_at.is_none());
    }
}
