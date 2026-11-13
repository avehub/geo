//! 站长数据源模型与目录表（M5.5，Plan C 第五切片的第一段）。
//!
//! 设计规格：`docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`
//! （DR-90 … DR-113）。
//!
//! 🔴 本模块只做**目录 / 枚举 / 绑定推导**：不联网、不导入、不算汇总、不生成机会。
//! `search_metric_import_csv` 与 `search_source_test` 仍留在 demo-only 清单。

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::check::CheckDetail;
use crate::ids::{ProjectId, SearchSourceId};
use crate::site::{SiteChannelStatus, SiteCredentialsState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchSourceKind {
    BaiduZiyuanAi,
    BaiduZiyuan,
    Toutiao,
    Gsc,
    BingWmt,
    Sogou,
    So360,
    BaiduTongji,
    Manual,
}

impl SearchSourceKind {
    pub fn all() -> [Self; 9] {
        [
            Self::BaiduZiyuanAi,
            Self::BaiduZiyuan,
            Self::Toutiao,
            Self::Gsc,
            Self::BingWmt,
            Self::Sogou,
            Self::So360,
            Self::BaiduTongji,
            Self::Manual,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BaiduZiyuanAi => "baidu_ziyuan_ai",
            Self::BaiduZiyuan => "baidu_ziyuan",
            Self::Toutiao => "toutiao",
            Self::Gsc => "gsc",
            Self::BingWmt => "bing_wmt",
            Self::Sogou => "sogou",
            Self::So360 => "so_360",
            Self::BaiduTongji => "baidu_tongji",
            Self::Manual => "manual",
        }
    }

    pub fn catalog(&self) -> &'static SearchSourceCatalog {
        SEARCH_CATALOG
            .iter()
            .find(|entry| entry.kind == *self)
            .expect("目录表覆盖全部 9 个源")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchGroup {
    WebmasterCn,
    WebmasterGlobal,
    Analytics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchRegion {
    Cn,
    Global,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchAuthMode {
    None,
    Oauth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchIngestMode {
    Api,
    FileImport,
    PasteParse,
    ManualEntry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchBindingField {
    SiteUrl,
    SiteId,
    /// GSC / Bing 的 OAuth 客户端 ID。它是**非敏感**的应用标识（不是 secret），
    /// 与 `siteUrl` 一样属于项目级绑定；client secret 才进钥匙串。
    ClientId,
}

impl SearchBindingField {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SiteUrl => "siteUrl",
            Self::SiteId => "siteId",
            Self::ClientId => "client_id",
        }
    }
}

/// 目录行：加一个源只加一行数据，不改服务与页面（DR-108）。
#[derive(Debug, Clone, Copy)]
pub struct SearchSourceCatalog {
    pub kind: SearchSourceKind,
    pub group: SearchGroup,
    pub region: SearchRegion,
    /// 一期 / 二期。二期源（搜狗 / 360）目录里建齐，但 upsert 拒绝。
    pub phase: u8,
    pub auth_mode: SearchAuthMode,
    pub ingest_modes: &'static [SearchIngestMode],
    pub binding_fields: &'static [SearchBindingField],
}

const CN_WEBMASTER_MODES: &[SearchIngestMode] = &[
    SearchIngestMode::PasteParse,
    SearchIngestMode::FileImport,
    SearchIngestMode::ManualEntry,
];
const GLOBAL_MODES: &[SearchIngestMode] = &[
    SearchIngestMode::Api,
    SearchIngestMode::FileImport,
    SearchIngestMode::PasteParse,
];
const TONGJI_MODES: &[SearchIngestMode] = &[
    SearchIngestMode::Api,
    SearchIngestMode::PasteParse,
    SearchIngestMode::FileImport,
    SearchIngestMode::ManualEntry,
];
const MANUAL_MODES: &[SearchIngestMode] = &[SearchIngestMode::ManualEntry];
const SITE_URL: &[SearchBindingField] = &[SearchBindingField::SiteUrl];
const SITE_ID: &[SearchBindingField] = &[SearchBindingField::SiteId];
const OAUTH_BINDING: &[SearchBindingField] =
    &[SearchBindingField::SiteUrl, SearchBindingField::ClientId];
const NO_BINDING: &[SearchBindingField] = &[];

pub static SEARCH_CATALOG: &[SearchSourceCatalog] = &[
    SearchSourceCatalog {
        kind: SearchSourceKind::BaiduZiyuanAi,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Cn,
        phase: 1,
        auth_mode: SearchAuthMode::None,
        ingest_modes: CN_WEBMASTER_MODES,
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::BaiduZiyuan,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Cn,
        phase: 1,
        auth_mode: SearchAuthMode::None,
        ingest_modes: CN_WEBMASTER_MODES,
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::Toutiao,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Cn,
        phase: 1,
        auth_mode: SearchAuthMode::None,
        ingest_modes: CN_WEBMASTER_MODES,
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::Gsc,
        group: SearchGroup::WebmasterGlobal,
        region: SearchRegion::Global,
        phase: 1,
        auth_mode: SearchAuthMode::Oauth,
        ingest_modes: GLOBAL_MODES,
        binding_fields: OAUTH_BINDING,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::BingWmt,
        group: SearchGroup::WebmasterGlobal,
        region: SearchRegion::Global,
        phase: 1,
        auth_mode: SearchAuthMode::Oauth,
        ingest_modes: GLOBAL_MODES,
        // Bing 用官方 API Key（钥匙串里的 `keyring://llm/bing_wmt`），
        // 只需要站点地址；不再要求 OAuth 的 client_id。
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::Sogou,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Cn,
        phase: 2,
        auth_mode: SearchAuthMode::None,
        ingest_modes: CN_WEBMASTER_MODES,
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::So360,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Cn,
        phase: 2,
        auth_mode: SearchAuthMode::None,
        ingest_modes: CN_WEBMASTER_MODES,
        binding_fields: SITE_URL,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::BaiduTongji,
        group: SearchGroup::Analytics,
        region: SearchRegion::Cn,
        phase: 1,
        auth_mode: SearchAuthMode::Oauth,
        ingest_modes: TONGJI_MODES,
        binding_fields: SITE_ID,
    },
    SearchSourceCatalog {
        kind: SearchSourceKind::Manual,
        group: SearchGroup::WebmasterCn,
        region: SearchRegion::Both,
        phase: 1,
        auth_mode: SearchAuthMode::None,
        ingest_modes: MANUAL_MODES,
        binding_fields: NO_BINDING,
    },
];

/// 一个已接入（或待接入）的数据源。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchSource {
    pub id: SearchSourceId,
    pub project_id: ProjectId,
    pub kind: SearchSourceKind,
    pub auth_mode: SearchAuthMode,
    pub ingest_modes: Vec<SearchIngestMode>,
    pub status: SiteChannelStatus,
    pub region: SearchRegion,
    pub group: SearchGroup,
    pub binding: BTreeMap<String, String>,
    pub credentials_state: SiteCredentialsState,
    pub secret_ref: Option<String>,
    pub data_through: Option<String>,
    pub checked_at: Option<DateTime<Utc>>,
    pub check_detail: Option<CheckDetail>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// upsert 入参的绑定：只保留目录表点名的字段，其余（包括任何凭据形状的键）一律丢掉。
pub fn clean_binding(
    kind: SearchSourceKind,
    raw: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let entry = kind.catalog();
    entry
        .binding_fields
        .iter()
        .filter_map(|field| {
            raw.get(field.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(|value| (field.as_str().to_string(), value))
        })
        .collect()
}

/// 建档状态：无需绑定 ⇒ `ready`；绑定齐全 ⇒ `pending_verify`；缺一个 ⇒ `not_configured`。
pub fn source_status(
    kind: SearchSourceKind,
    binding: &BTreeMap<String, String>,
) -> SiteChannelStatus {
    let required = kind.catalog().binding_fields;
    if required.is_empty() {
        SiteChannelStatus::Ready
    } else if required
        .iter()
        .all(|field| binding.contains_key(field.as_str()))
    {
        SiteChannelStatus::PendingVerify
    } else {
        SiteChannelStatus::NotConfigured
    }
}

pub fn credentials_state(kind: SearchSourceKind) -> SiteCredentialsState {
    if kind.catalog().auth_mode == SearchAuthMode::None {
        SiteCredentialsState::NotRequired
    } else {
        SiteCredentialsState::Missing
    }
}

/// 账号级两段引用串（规则 3）；不需要凭据的源连引用串都没有。
pub fn secret_ref(kind: SearchSourceKind) -> Option<String> {
    if kind.catalog().auth_mode == SearchAuthMode::None {
        None
    } else {
        Some(format!("keyring://search/{}", kind.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_all_kinds_and_two_phase_two_sources() {
        assert_eq!(SEARCH_CATALOG.len(), 9);
        for kind in SearchSourceKind::all() {
            assert_eq!(kind.catalog().kind, kind);
        }
        assert_eq!(SearchSourceKind::Sogou.catalog().phase, 2);
        assert_eq!(SearchSourceKind::So360.catalog().phase, 2);
    }

    #[test]
    fn only_gsc_requires_an_oauth_client_id() {
        // Bing 改走官方 API Key（它的 OAuth 控制台不接受 loopback 回调地址），
        // 所以只剩 GSC 需要非敏感的 client_id 绑定。
        assert_eq!(
            SearchSourceKind::Gsc.catalog().binding_fields,
            &[SearchBindingField::SiteUrl, SearchBindingField::ClientId],
            "GSC 的 OAuth 需要非敏感的 client_id 绑定"
        );
        assert_eq!(
            SearchSourceKind::BingWmt.catalog().binding_fields,
            &[SearchBindingField::SiteUrl],
            "Bing 只需要站点地址，凭据是钥匙串里的 API Key"
        );
        assert_eq!(
            SearchBindingField::ClientId.as_str(),
            "client_id",
            "OAuth 的 client_id 是非敏感绑定键，与目录表 / 抽屉字段名逐字一致"
        );
        for kind in SearchSourceKind::all() {
            if kind != SearchSourceKind::Gsc {
                assert!(
                    !kind
                        .catalog()
                        .binding_fields
                        .contains(&SearchBindingField::ClientId),
                    "{} 不应要求 client_id",
                    kind.as_str()
                );
            }
        }
    }

    #[test]
    fn binding_only_keeps_catalog_fields_and_drops_credentials() {
        let mut raw = BTreeMap::new();
        raw.insert("siteUrl".to_string(), " https://example.com ".to_string());
        raw.insert("password".to_string(), "hunter2".to_string());
        let binding = clean_binding(SearchSourceKind::BaiduZiyuan, &raw);
        assert_eq!(
            binding.get("siteUrl").map(String::as_str),
            Some("https://example.com")
        );
        assert!(!binding.contains_key("password"));
    }

    #[test]
    fn status_follows_required_binding() {
        let mut binding = BTreeMap::new();
        assert_eq!(
            source_status(SearchSourceKind::Manual, &binding),
            SiteChannelStatus::Ready
        );
        assert_eq!(
            source_status(SearchSourceKind::BaiduZiyuan, &binding),
            SiteChannelStatus::NotConfigured
        );
        binding.insert("siteUrl".to_string(), "https://example.com".to_string());
        assert_eq!(
            source_status(SearchSourceKind::BaiduZiyuan, &binding),
            SiteChannelStatus::PendingVerify
        );
        assert_eq!(
            source_status(SearchSourceKind::BaiduTongji, &binding),
            SiteChannelStatus::NotConfigured,
            "百度统计要 siteId 而不是 siteUrl"
        );
    }

    #[test]
    fn credentials_and_secret_ref_follow_auth_mode() {
        assert_eq!(
            credentials_state(SearchSourceKind::Gsc),
            SiteCredentialsState::Missing
        );
        assert_eq!(
            secret_ref(SearchSourceKind::Gsc).as_deref(),
            Some("keyring://search/gsc")
        );
        assert!(secret_ref(SearchSourceKind::Manual).is_none());
    }
}
