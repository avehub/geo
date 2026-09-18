//! 项目资产登记：自有页面、第三方信源与社媒账号。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::error::GeoError;
use crate::ids::{AssetId, ProjectId};

/// 资产类型。序列化值同时是数据库存储值与前端契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AssetKind {
    #[default]
    OwnedPage,
    Baike,
    Zhihu,
    Xiaohongshu,
    Baijiahao,
    IndustryMedia,
    Ecommerce,
    SocialAccount,
    Other,
}

impl AssetKind {
    pub fn all() -> [Self; 9] {
        [
            Self::OwnedPage,
            Self::Baike,
            Self::Zhihu,
            Self::Xiaohongshu,
            Self::Baijiahao,
            Self::IndustryMedia,
            Self::Ecommerce,
            Self::SocialAccount,
            Self::Other,
        ]
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::OwnedPage => "自有页面",
            Self::Baike => "百科词条",
            Self::Zhihu => "知乎",
            Self::Xiaohongshu => "小红书",
            Self::Baijiahao => "百家号",
            Self::IndustryMedia => "行业媒体",
            Self::Ecommerce => "电商详情页",
            Self::SocialAccount => "社媒账号",
            Self::Other => "其他",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectAsset {
    pub id: AssetId,
    pub project_id: ProjectId,
    pub kind: AssetKind,
    pub url: String,
    pub title: Option<String>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl ProjectAsset {
    pub fn new(
        project_id: ProjectId,
        kind: AssetKind,
        url: impl Into<String>,
        title: Option<String>,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<Self, GeoError> {
        let url = normalize_url("asset.url", &url.into())?;
        Ok(Self {
            id: AssetId::new(),
            project_id,
            kind,
            url,
            title: clean_optional(title),
            note: clean_optional(note),
            created_at: now,
        })
    }
}

pub fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// 校验并归一化 URL：缺协议时补 `https://`，仅允许 http/https，且必须有 host。
pub fn normalize_url(field: &str, raw: &str) -> Result<String, GeoError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(GeoError::validation(field, "不能为空"));
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate)
        .map_err(|_| GeoError::validation(field, format!("不是合法网址：{trimmed}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(GeoError::validation(field, "只支持 http/https 网址"));
    }
    // `Url::parse` 会把「不是网址」「内网」这类串当 IDN 主机名收下，
    // 因此这里只放行 IP 与含点号的域名，避免用户的错字变成一次真实外网请求。
    match parsed.host() {
        Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)) => {}
        Some(Host::Domain(host)) if host.contains('.') => {}
        _ => {
            return Err(GeoError::validation(
                field,
                "缺少合法域名，请形如 www.example.com",
            ))
        }
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
    }

    #[test]
    fn asset_kinds_serialize_to_snake_case() {
        assert_eq!(
            serde_json::to_string(&AssetKind::OwnedPage).unwrap(),
            "\"owned_page\""
        );
        assert_eq!(
            serde_json::to_string(&AssetKind::SocialAccount).unwrap(),
            "\"social_account\""
        );
        assert_eq!(AssetKind::all().len(), 9);
        assert_eq!(AssetKind::Baike.label_zh(), "百科词条");
    }

    #[test]
    fn asset_normalizes_url_without_scheme() {
        let asset = ProjectAsset::new(
            ProjectId::new(),
            AssetKind::OwnedPage,
            "www.example.com/about",
            Some("  关于我们  ".to_string()),
            Some("   ".to_string()),
            now(),
        )
        .unwrap();
        assert_eq!(asset.url, "https://www.example.com/about");
        assert_eq!(asset.title.as_deref(), Some("关于我们"));
        assert_eq!(asset.note, None, "空白备注应归一化为 None");
    }

    #[test]
    fn asset_rejects_invalid_url() {
        let err = ProjectAsset::new(
            ProjectId::new(),
            AssetKind::OwnedPage,
            "ftp://example.com",
            None,
            None,
            now(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation/failed");
        assert!(err.user_message().contains("asset.url"));
    }

    #[test]
    fn normalize_url_rejects_empty() {
        assert!(normalize_url("website", "  ").is_err());
    }

    #[test]
    fn normalize_url_rejects_a_host_that_is_neither_domain_nor_ip() {
        // `Url::parse` 会把「不是网址」当 IDN 主机名收下来，必须在领域层拦住，
        // 否则错字会变成一次真实的外网请求。
        for raw in ["不是网址", "localhost", "https://内网", "http://a"] {
            let err = normalize_url("website", raw)
                .err()
                .unwrap_or_else(|| panic!("{raw} 应被拒绝"));
            assert_eq!(err.code(), "validation/failed");
            assert!(err.user_message().contains("website"));
        }
        // IP 与正常域名放行（本地调试与真实站点都要能用）
        assert!(normalize_url("website", "http://127.0.0.1:1420/x").is_ok());
        assert!(normalize_url("website", "http://[::1]:8080").is_ok());
        assert!(normalize_url("website", "www.example.com/about").is_ok());
    }
}
