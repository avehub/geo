//! 站点接入模型（M6.5，Plan C 第四个纵向切片的档案 / 通道部分）。
//!
//! 设计规格：`docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`
//! （DR-45 … DR-49 / DR-56）。
//!
//! 🔴 本模块只做**纯模型与纯映射**：平台 / 归属 / 通道枚举、页面角色推断、凭据状态推导。
//! 真正的自检（`site_channel_test`）与补丁台账不在本切片；自检结论的 `check_detail`
//! 目前是演示中文数据，真后端要改成稳定码 + params 后才能落（差异台账 E-57）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::asset::{AssetKind, ProjectAsset};
use crate::check::CheckDetail;
use crate::ids::{ProjectId, SiteChannelId, SiteProfileId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePlatform {
    Wordpress,
    Static,
    Custom,
    SaasBuilder,
    Ecommerce,
    Unknown,
}

impl SitePlatform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Wordpress => "wordpress",
            Self::Static => "static",
            Self::Custom => "custom",
            Self::SaasBuilder => "saas_builder",
            Self::Ecommerce => "ecommerce",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteOwnership {
    #[serde(rename = "self")]
    Self_,
    Agency,
    NoAccess,
    Unknown,
}

/// ⚠ `Self` 是 Rust 关键字，serde 名仍要是 `self`。
impl SiteOwnership {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Self_ => "self",
            Self::Agency => "agency",
            Self::NoAccess => "no_access",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteChannelKind {
    Bundle,
    Cms,
    Edge,
    Repo,
}

impl SiteChannelKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Bundle => "bundle",
            Self::Cms => "cms",
            Self::Edge => "edge",
            Self::Repo => "repo",
        }
    }

    /// 凭据面：落地包 / 仓库不需要凭据；CMS / 边缘函数需要。
    pub fn credentials_state(&self) -> SiteCredentialsState {
        match self {
            Self::Bundle | Self::Repo => SiteCredentialsState::NotRequired,
            Self::Cms | Self::Edge => SiteCredentialsState::Missing,
        }
    }

    /// 零配置即可用：只有落地包。
    pub fn ready_without_config(&self) -> bool {
        matches!(self, Self::Bundle)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteChannelStatus {
    NotConfigured,
    PendingVerify,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteCredentialsState {
    NotRequired,
    Missing,
    Stored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePageRole {
    Home,
    Product,
    About,
    Qualification,
    Service,
    News,
    Faq,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteProfile {
    pub id: SiteProfileId,
    pub project_id: ProjectId,
    /// 站点根域名，逐字来自 `Project.website`（不在档案里另存一份可编辑值）。
    pub domain: String,
    pub platform: SitePlatform,
    pub ownership: SiteOwnership,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 受管页面。真后端由爬虫发现；本切片先由项目的自有页面资产投影。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SitePage {
    pub id: String,
    pub project_id: ProjectId,
    pub url: String,
    pub role: SitePageRole,
    pub title: Option<String>,
    pub last_checked_at: Option<DateTime<Utc>>,
    /// ⚠ 本切片恒 `true`（资产是客户自己的页面）；真正的 robots 判定由爬虫落地时补。
    pub crawlable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteChannel {
    pub id: SiteChannelId,
    pub project_id: ProjectId,
    pub kind: SiteChannelKind,
    pub status: SiteChannelStatus,
    pub endpoint: Option<String>,
    pub username: Option<String>,
    pub note: Option<String>,
    pub credentials_state: SiteCredentialsState,
    /// 规则 3：只存 `keyring://site/<kind>/<project_id>` 引用串，不存凭据值。
    pub secret_ref: Option<String>,
    pub checked_at: Option<DateTime<Utc>>,
    pub check_detail: Option<CheckDetail>,
    pub updated_at: DateTime<Utc>,
}

/// 页面角色推断：只看 URL 路径，不做抓取。
pub fn page_role_for_url(raw: &str) -> SitePageRole {
    let path = Url::parse(raw)
        .map(|url| url.path().to_lowercase())
        .unwrap_or_else(|_| raw.to_lowercase());
    let path = path.trim_end_matches('/');
    if path.is_empty() {
        return SitePageRole::Home;
    }
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    let mut role = SitePageRole::Other;
    for segment in segments {
        let matched = if segment.contains("product") || segment.contains("chanpin") {
            Some(SitePageRole::Product)
        } else if segment.contains("about") || segment.contains("guanyu") {
            Some(SitePageRole::About)
        } else if segment.contains("qualification")
            || segment.contains("cert")
            || segment.contains("zizhi")
        {
            Some(SitePageRole::Qualification)
        } else if segment.contains("service") || segment.contains("fuwu") {
            Some(SitePageRole::Service)
        } else if segment.contains("news") || segment.contains("blog") || segment.contains("zixun")
        {
            Some(SitePageRole::News)
        } else if segment.contains("faq") || segment.contains("question") {
            Some(SitePageRole::Faq)
        } else {
            None
        };
        if let Some(matched) = matched {
            role = matched;
            break;
        }
    }
    role
}

/// 只把「自有页面」资产投影成受管页面；站外资产不是补丁落点。
pub fn page_from_asset(asset: &ProjectAsset) -> Option<SitePage> {
    if asset.kind != AssetKind::OwnedPage {
        return None;
    }
    Some(SitePage {
        id: asset.id.to_string(),
        project_id: asset.project_id,
        url: asset.url.clone(),
        role: page_role_for_url(&asset.url),
        title: asset.title.clone(),
        last_checked_at: None,
        crawlable: true,
    })
}

/// 通道自检引用串（规则 3：库里只有引用串）。
pub fn channel_secret_ref(kind: SiteChannelKind, project_id: ProjectId) -> Option<String> {
    if kind.credentials_state() == SiteCredentialsState::NotRequired {
        None
    } else {
        Some(format!("keyring://site/{}/{project_id}", kind.as_str()))
    }
}

/// 通道状态：落地包恒可用；其余有落点就待自检，没有就未配置。
pub fn channel_status(kind: SiteChannelKind, endpoint: Option<&str>) -> SiteChannelStatus {
    if kind.ready_without_config() {
        SiteChannelStatus::Ready
    } else if endpoint.is_none_or(|value| value.trim().is_empty()) {
        SiteChannelStatus::NotConfigured
    } else {
        SiteChannelStatus::PendingVerify
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::AssetId;

    fn asset(kind: AssetKind, url: &str) -> ProjectAsset {
        ProjectAsset {
            id: AssetId::new(),
            project_id: ProjectId::new(),
            kind,
            url: url.to_string(),
            title: Some("页面".to_string()),
            note: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn ownership_self_serializes_as_self() {
        assert_eq!(
            serde_json::to_string(&SiteOwnership::Self_).unwrap(),
            "\"self\""
        );
    }

    #[test]
    fn page_roles_are_inferred_from_path() {
        assert_eq!(
            page_role_for_url("https://example.com/"),
            SitePageRole::Home
        );
        assert_eq!(
            page_role_for_url("https://example.com/products/a/"),
            SitePageRole::Product
        );
        assert_eq!(
            page_role_for_url("https://example.com/about"),
            SitePageRole::About
        );
        assert_eq!(
            page_role_for_url("https://example.com/faq"),
            SitePageRole::Faq
        );
        assert_eq!(
            page_role_for_url("https://example.com/x"),
            SitePageRole::Other
        );
    }

    #[test]
    fn only_owned_pages_become_site_pages() {
        assert!(page_from_asset(&asset(AssetKind::OwnedPage, "https://example.com/")).is_some());
        assert!(page_from_asset(&asset(AssetKind::Zhihu, "https://zhihu.com/x")).is_none());
    }

    #[test]
    fn credentials_and_status_follow_kind() {
        assert_eq!(
            SiteChannelKind::Bundle.credentials_state(),
            SiteCredentialsState::NotRequired
        );
        assert_eq!(
            SiteChannelKind::Cms.credentials_state(),
            SiteCredentialsState::Missing
        );
        assert_eq!(
            channel_status(SiteChannelKind::Bundle, None),
            SiteChannelStatus::Ready
        );
        assert_eq!(
            channel_status(SiteChannelKind::Cms, None),
            SiteChannelStatus::NotConfigured
        );
        assert_eq!(
            channel_status(SiteChannelKind::Cms, Some("https://wp.example")),
            SiteChannelStatus::PendingVerify
        );
    }

    #[test]
    fn secret_ref_is_present_only_when_credentials_are_needed() {
        let project_id = ProjectId::new();
        assert!(channel_secret_ref(SiteChannelKind::Bundle, project_id).is_none());
        assert_eq!(
            channel_secret_ref(SiteChannelKind::Cms, project_id),
            Some(format!("keyring://site/cms/{project_id}"))
        );
    }
}
