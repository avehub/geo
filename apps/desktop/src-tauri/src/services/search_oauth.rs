//! 站长平台取数：Google Search Console 走 OAuth（PKCE + loopback），
//! Bing Webmaster 走官方 API Key（`keyring://llm/bing_wmt`）。
//!
//! 设计规格：`docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（DR-93 / DR-96）。
//!
//! # 边界
//! - OAuth 只实现 GSC。Bing 的 OAuth 控制台不接受 loopback 重定向地址
//!   （`http://localhost:…` 被判“不是有效的 http 或 https url”，且不支持事后改回调），
//!   所以 Bing 走官方 API Key；百度站长没有读 API。`oauth_begin` 对其他 kind 一律
//!   `validation/failed { field: "kind", reason: "not_allowed" }`，不伪造授权流程。
//! - 凭据只进系统钥匙串（`keyring://search/gsc` / `keyring://llm/bing_wmt`），
//!   库里的 `search_sources` 只有 `credentials_state=stored` 这个事实；
//!   响应体 / 请求体 / 错误信息都不回显 token、client secret 或 API Key。
//! - 测试禁止联网：token 与平台响应都通过 `Transport` 替身回放；回调走真实的
//!   127.0.0.1 loopback，这是本机进程间通信，不是外网请求。

use std::collections::BTreeMap;
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Days, NaiveDate, Utc};
use geo_domain::{
    CheckDetail, ProjectId, SearchCompleteness, SearchMetricId, SearchQueryMetric,
    SearchSourceKind, SearchSurface, SiteChannelStatus, SiteCredentialsState, WindowSource,
    MAPPING_VERSION,
};
use geo_llm::transport::{HttpMethod, HttpRequest, Transport};
use geo_store::{SearchMetricRepo, SearchRepo, SecretStore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::form_urlencoded;

use crate::error::IpcError;

/// Google OAuth client secret（可空：desktop client + PKCE 不需要）。
pub const GOOGLE_OAUTH_SECRET_REF: &str = "keyring://llm/google_oauth";
/// GSC token JSON（access / refresh / expires_at / token_type）。
pub const GSC_TOKEN_REF: &str = "keyring://search/gsc";
/// GSC 的 OAuth 客户端 ID 是**非敏感**绑定字段，键名与目录表一致。
pub const GSC_CLIENT_ID_FIELD: &str = "client_id";

/// Bing Webmaster 的官方 API Key（Webmaster Tools → 设置 → API access → API key）。
///
/// 这是 Bing 的**主认证方式**：一次生成、长期有效，不需要登记任何回调地址。
/// Bing 的 OAuth 控制台不接受 loopback 重定向地址（`http://localhost:…` 会被判
/// “不是有效的 http 或 https url”），所以 Bing 不提供 OAuth 授权流程。
pub const BING_API_KEY_REF: &str = "keyring://llm/bing_wmt";

const GSC_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GSC_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GSC_SCOPE: &str = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_QUERY_BASE: &str = "https://www.googleapis.com/webmasters/v3/sites";

const BING_QUERY_STATS_URL: &str = "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats";

const CALLBACK_PATH: &str = "/oauth2callback";

const SUCCESS_HTML: &str =
    "<!doctype html><meta charset=\"utf-8\"><title>Authorization complete</title>\
<body style=\"font-family:system-ui,sans-serif;padding:40px\"><h1>授权完成，可关闭此页</h1>\
<p>Authorization complete. You can close this page.</p></body>";
const FAILURE_HTML: &str =
    "<!doctype html><meta charset=\"utf-8\"><title>Authorization failed</title>\
<body style=\"font-family:system-ui,sans-serif;padding:40px\"><h1>授权未完成，请回到应用重试</h1>\
<p>Authorization was not completed. Return to the app and try again.</p></body>";

/// 稳定的流程失败分类；只映射成 `check_detail.code`，不暴露上游响应体。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GscFlowError {
    OAuthFailed,
    FetchFailed,
    StateMismatch,
}

impl GscFlowError {
    pub fn check_code(self) -> &'static str {
        match self {
            Self::OAuthFailed | Self::StateMismatch => "search_oauth_failed",
            Self::FetchFailed => "search_fetch_failed",
        }
    }

    fn reason(self) -> &'static str {
        match self {
            Self::OAuthFailed => "oauth_exchange",
            Self::FetchFailed => "upstream",
            Self::StateMismatch => "state_mismatch",
        }
    }
}

/// token endpoint 的返回值（只在内存中流转）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GscToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredGscToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: DateTime<Utc>,
    token_type: String,
}

#[derive(Debug, Deserialize)]
struct TokenWire {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    token_type: Option<String>,
}

/// 两个平台 token 响应同形；统一解析，避免一处改了另一处漏掉。
fn parse_token_wire(body: &str, now: DateTime<Utc>) -> Result<GscToken, GscFlowError> {
    let wire: TokenWire = serde_json::from_str(body).map_err(|_| GscFlowError::OAuthFailed)?;
    if wire.access_token.trim().is_empty() {
        return Err(GscFlowError::OAuthFailed);
    }
    Ok(GscToken {
        access_token: wire.access_token,
        refresh_token: wire.refresh_token,
        expires_at: now + chrono::Duration::seconds(wire.expires_in.unwrap_or(3600).max(0)),
        token_type: wire
            .token_type
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Bearer".to_string()),
    })
}

#[derive(Debug, Deserialize)]
struct GscResponse {
    #[serde(default)]
    rows: Vec<GscRow>,
}

#[derive(Debug, Deserialize)]
struct GscRow {
    #[serde(default)]
    keys: Vec<String>,
    #[serde(default)]
    clicks: Option<f64>,
    #[serde(default)]
    impressions: Option<f64>,
    #[serde(default)]
    ctr: Option<f64>,
}

/// 一次授权流程需要的项目级上下文（client secret 已读入内存，不落库）。
pub(crate) struct OAuthFlowContext {
    pub project_id: ProjectId,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub site_url: String,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
}

/// 绑定 listener 后返回给前端的授权起点。
#[derive(Debug, Clone, Serialize)]
pub struct SearchOAuthStart {
    pub auth_url: String,
    pub state: String,
    pub redirect_uri: String,
}

/// 生成 PKCE verifier / challenge、state 与授权 URL。
pub(crate) fn build_authorization(client_id: &str, redirect_uri: &str) -> (String, String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = uuid::Uuid::new_v4().to_string();

    let mut url = url::Url::parse(GSC_AUTH_URL).expect("常量授权地址合法");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GSC_SCOPE)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    (url.into(), state, verifier)
}

/// 用授权码换 token。`client_secret` 可空（Google desktop client 走纯 PKCE）。
pub async fn oauth_exchange(
    transport: &dyn Transport,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    now: DateTime<Utc>,
) -> Result<GscToken, GscFlowError> {
    let body = {
        let mut form = form_urlencoded::Serializer::new(String::new());
        form.append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("client_id", client_id)
            .append_pair("code_verifier", code_verifier)
            .append_pair("redirect_uri", redirect_uri);
        if let Some(secret) = client_secret
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            form.append_pair("client_secret", secret);
        }
        form.finish()
    };

    let response = transport
        .send(HttpRequest {
            method: HttpMethod::Post,
            url: GSC_TOKEN_URL.to_string(),
            headers: vec![
                (
                    "Content-Type".to_string(),
                    "application/x-www-form-urlencoded".to_string(),
                ),
                ("Accept".to_string(), "application/json".to_string()),
            ],
            body,
        })
        .await
        .map_err(|_| GscFlowError::OAuthFailed)?;

    if !(200..300).contains(&response.status) {
        return Err(GscFlowError::OAuthFailed);
    }
    parse_token_wire(&response.body, now)
}

/// GSC 的可用窗口：`endDate = 今天 - 3 天`，`startDate = endDate - 27 天`。
fn gsc_window(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let end = today.checked_sub_days(Days::new(3)).unwrap_or(today);
    let start = end.checked_sub_days(Days::new(27)).unwrap_or(end);
    (start, end)
}

/// 拉取 query × page 维度的 Search Analytics 数据，并映射成统一指标行。
pub async fn fetch_gsc_metrics(
    transport: &dyn Transport,
    project_id: ProjectId,
    access_token: &str,
    site_url: &str,
    start_date: &str,
    end_date: &str,
    imported_at: DateTime<Utc>,
) -> Result<Vec<SearchQueryMetric>, GscFlowError> {
    let encoded_site: String = form_urlencoded::byte_serialize(site_url.as_bytes()).collect();
    let url = format!("{GSC_QUERY_BASE}/{encoded_site}/searchAnalytics/query");
    let body = serde_json::json!({
        "startDate": start_date,
        "endDate": end_date,
        "dimensions": ["query", "page"],
        "rowLimit": 25000,
    })
    .to_string();

    let response = transport
        .send(HttpRequest {
            method: HttpMethod::Post,
            url,
            headers: vec![
                (
                    "Authorization".to_string(),
                    format!("Bearer {access_token}"),
                ),
                ("Content-Type".to_string(), "application/json".to_string()),
                ("Accept".to_string(), "application/json".to_string()),
            ],
            body,
        })
        .await
        .map_err(|_| GscFlowError::FetchFailed)?;

    if !(200..300).contains(&response.status) {
        return Err(GscFlowError::FetchFailed);
    }
    let parsed: GscResponse =
        serde_json::from_str(&response.body).map_err(|_| GscFlowError::FetchFailed)?;

    Ok(parsed
        .rows
        .into_iter()
        .filter_map(|row| {
            let query = row.keys.first()?.trim().to_string();
            if query.is_empty() {
                return None;
            }
            Some(SearchQueryMetric {
                id: SearchMetricId::new(),
                project_id,
                source_kind: SearchSourceKind::Gsc,
                surface: SearchSurface::WebSearch,
                query,
                page_url: row
                    .keys
                    .get(1)
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                impressions: row.impressions.map(|value| value.round() as i64),
                clicks: row.clicks.map(|value| value.round() as i64),
                ctr: row.ctr,
                citations: None,
                ai_clicks: None,
                period_start: start_date.to_string(),
                period_end: end_date.to_string(),
                data_through: end_date.to_string(),
                imported_at,
                completeness: SearchCompleteness::Full,
                window_source: WindowSource::Platform,
                mapping_version: MAPPING_VERSION.to_string(),
            })
        })
        .collect())
}

/// Bing 的可用窗口：`end = 今天 - 1 天`（目录表 `lag_days: 1`），`start = end - 27 天`。
fn bing_window(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let end = today.checked_sub_days(Days::new(1)).unwrap_or(today);
    let start = end.checked_sub_days(Days::new(27)).unwrap_or(end);
    (start, end)
}

/// JSON 字段名大小写不敏感：`GetQueryStats` 的线上响应混用 `Query` / `query`。
fn case_value<'a>(
    row: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<&'a serde_json::Value> {
    row.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

fn case_string(row: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    match case_value(row, key)? {
        serde_json::Value::String(value) => {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

/// 数字或数字字符串；`"4%"` 按比例读成 `0.04`（Bing 的 Ctr 既可能是小数也可能是百分号串）。
fn case_number(row: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<f64> {
    match case_value(row, key)? {
        serde_json::Value::Number(value) => value.as_f64(),
        serde_json::Value::String(value) => {
            let trimmed = value.trim();
            if let Some(percent) = trimmed.strip_suffix('%') {
                percent
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .map(|value| value / 100.0)
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// 解析行级日期（ISO `YYYY-MM-DD` 或 Microsoft `/Date(ms)/`）。
///
/// 🔴 指标槽位按**请求窗口**存储（与 GSC 的 `replace_metrics_slot` 同口径），所以这里
/// 只读取、不把行级日期写进 `period_start/period_end`；显式解析保证两种字段写法都被识别。
fn bing_row_date(row: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    let raw = case_string(row, "date")?;
    if let Some(inner) = raw
        .strip_prefix("/Date(")
        .and_then(|value| value.strip_suffix(")/"))
    {
        let mut digits = String::new();
        for (index, ch) in inner.char_indices() {
            if ch.is_ascii_digit() || (index == 0 && ch == '-') {
                digits.push(ch);
            } else {
                break;
            }
        }
        let millis = digits.parse::<i64>().ok()?;
        return DateTime::<Utc>::from_timestamp_millis(millis)
            .map(|value| value.date_naive().to_string());
    }
    let head = raw.get(..10)?;
    NaiveDate::parse_from_str(head, "%Y-%m-%d")
        .ok()
        .map(|value| value.to_string())
}

/// Bing Webmaster JSON API 的两种认证方式。
///
/// - [`BingAuth::ApiKey`]：官方推荐，`?apikey=…` 查询参数，长期有效、无需回调地址；
/// - [`BingAuth::Bearer`]：OAuth access token（备选；Bing 控制台目前不接受 loopback
///   重定向地址，能否登记成功取决于平台策略）。
///
/// Key / token 都只从钥匙串读进内存，**不落库、不进日志、不进错误信息**。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BingAuth {
    ApiKey(String),
    Bearer(String),
}

/// 拉取 Bing Webmaster 的 query 级统计（官方 JSON 端点 `GetQueryStats`）。
///
/// 认证由 [`BingAuth`] 决定：API Key 走 `?apikey=` 查询参数（实测可用），
/// Bearer 走 `Authorization` 头。404 / 解析失败一律 `FetchFailed`，绝不伪造数据。
pub async fn fetch_bing_metrics(
    transport: &dyn Transport,
    project_id: ProjectId,
    auth: &BingAuth,
    site_url: &str,
    start_date: &str,
    end_date: &str,
    imported_at: DateTime<Utc>,
) -> Result<Vec<SearchQueryMetric>, GscFlowError> {
    let encoded_site: String = form_urlencoded::byte_serialize(site_url.as_bytes()).collect();
    let url = match auth {
        BingAuth::ApiKey(key) => {
            let encoded_key: String =
                form_urlencoded::byte_serialize(key.trim().as_bytes()).collect();
            format!("{BING_QUERY_STATS_URL}?siteUrl={encoded_site}&apikey={encoded_key}")
        }
        BingAuth::Bearer(_) => format!("{BING_QUERY_STATS_URL}?siteUrl={encoded_site}"),
    };

    let mut headers = vec![("Accept".to_string(), "application/json".to_string())];
    if let BingAuth::Bearer(token) = auth {
        headers.push((
            "Authorization".to_string(),
            format!("Bearer {}", token.trim()),
        ));
    }

    let response = transport
        .send(HttpRequest {
            method: HttpMethod::Get,
            url,
            headers,
            body: String::new(),
        })
        .await
        .map_err(|_| GscFlowError::FetchFailed)?;

    if !(200..300).contains(&response.status) {
        return Err(GscFlowError::FetchFailed);
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&response.body).map_err(|_| GscFlowError::FetchFailed)?;
    let object = parsed.as_object().ok_or(GscFlowError::FetchFailed)?;
    let rows = match case_value(object, "d") {
        Some(serde_json::Value::Array(rows)) => rows.as_slice(),
        None => &[],
        Some(_) => return Err(GscFlowError::FetchFailed),
    };

    Ok(rows
        .iter()
        .filter_map(|value| {
            let row = value.as_object()?;
            let query = case_string(row, "query")?;
            if query.is_empty() {
                return None;
            }
            // 行级日期显式读取（两种字段写法都认）；窗口仍按请求参数存储。
            let _row_date = bing_row_date(row);
            Some(SearchQueryMetric {
                id: SearchMetricId::new(),
                project_id,
                source_kind: SearchSourceKind::BingWmt,
                surface: SearchSurface::WebSearch,
                query,
                page_url: None,
                impressions: case_number(row, "impressions").map(|value| value.round() as i64),
                clicks: case_number(row, "clicks").map(|value| value.round() as i64),
                ctr: case_number(row, "ctr"),
                citations: None,
                ai_clicks: None,
                period_start: start_date.to_string(),
                period_end: end_date.to_string(),
                data_through: end_date.to_string(),
                imported_at,
                completeness: SearchCompleteness::Full,
                window_source: WindowSource::Platform,
                mapping_version: MAPPING_VERSION.to_string(),
            })
        })
        .collect())
}

/// 读 Bing API Key（UI 写在 `keyring://llm/bing_wmt`）。
///
/// 🔴 只读 `llm/*`：`keyring://search/bing_wmt` 是 **OAuth token JSON** 的位置，
/// 把那里当 Key 读会把 token 拼进查询串。Key 只在内存里流转，不落库、不进日志。
pub async fn load_bing_api_key(secrets: &dyn SecretStore) -> Option<String> {
    let value = secrets.get(BING_API_KEY_REF).await.ok().flatten()?;
    let trimmed = value.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// 读钥匙串里的 OAuth token；损坏/缺失都回 `None`。
async fn load_token_at(secrets: &dyn SecretStore, token_ref: &str) -> Option<StoredGscToken> {
    let raw = secrets.get(token_ref).await.ok().flatten()?;
    serde_json::from_str(&raw).ok()
}

/// 写 OAuth token 到钥匙串（refresh 轮转后复用）。token 不进数据库。
async fn save_token_at(
    secrets: &dyn SecretStore,
    token_ref: &str,
    token: &GscToken,
) -> Result<(), geo_store::StoreError> {
    let payload = serde_json::to_string(&StoredGscToken {
        access_token: token.access_token.clone(),
        refresh_token: token.refresh_token.clone(),
        expires_at: token.expires_at,
        token_type: token.token_type.clone(),
    })
    .map_err(geo_store::StoreError::Serde)?;
    secrets.set(token_ref, &payload).await
}

/// 读钥匙串里的 GSC token。
pub(crate) async fn load_stored_token(secrets: &dyn SecretStore) -> Option<StoredGscToken> {
    load_token_at(secrets, GSC_TOKEN_REF).await
}

/// 写 GSC token 到钥匙串。
pub(crate) async fn save_stored_token(
    secrets: &dyn SecretStore,
    token: &GscToken,
) -> Result<(), geo_store::StoreError> {
    save_token_at(secrets, GSC_TOKEN_REF, token).await
}

/// 用 refresh_token 换新 access_token。Google 可能轮转 refresh_token；没回就保留旧值。
pub(crate) async fn refresh_gsc_token(
    transport: &dyn Transport,
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
    now: DateTime<Utc>,
) -> Result<GscToken, GscFlowError> {
    let body = {
        let mut form = form_urlencoded::Serializer::new(String::new());
        form.append_pair("grant_type", "refresh_token")
            .append_pair("client_id", client_id)
            .append_pair("refresh_token", refresh_token);
        if let Some(secret) = client_secret
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            form.append_pair("client_secret", secret);
        }
        form.finish()
    };
    let response = transport
        .send(HttpRequest {
            method: HttpMethod::Post,
            url: GSC_TOKEN_URL.to_string(),
            headers: vec![
                (
                    "Content-Type".to_string(),
                    "application/x-www-form-urlencoded".to_string(),
                ),
                ("Accept".to_string(), "application/json".to_string()),
            ],
            body,
        })
        .await
        .map_err(|_| GscFlowError::OAuthFailed)?;
    if !(200..300).contains(&response.status) {
        return Err(GscFlowError::OAuthFailed);
    }
    let mut token = parse_token_wire(&response.body, now)?;
    if token.refresh_token.is_none() {
        token.refresh_token = Some(refresh_token.to_string());
    }
    Ok(token)
}

/// 每日拉取：遍历所有项目的 GSC 源，必要时刷新 token，再拉近 28 天数据。
/// 失败只写源状态与日志；不删除旧数据、不抛给 UI。
pub async fn refresh_all_gsc(
    pool: SqlitePool,
    secrets: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
) -> usize {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT project_id, binding FROM search_sources WHERE kind = 'gsc'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    let mut refreshed = 0;
    for (project_id_raw, binding_raw) in rows {
        let Ok(project_id) = project_id_raw.parse::<ProjectId>() else {
            continue;
        };
        let binding: BTreeMap<String, String> =
            serde_json::from_str(&binding_raw).unwrap_or_default();
        let Some(site_url) = binding
            .get("siteUrl")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(client_id) = binding
            .get(GSC_CLIENT_ID_FIELD)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(mut token) = load_stored_token(secrets.as_ref()).await else {
            continue;
        };
        let now = Utc::now();
        if token.expires_at <= now + chrono::Duration::seconds(60) {
            let Some(refresh_token) = token.refresh_token.clone() else {
                let _ = mark_source_failed(
                    &pool,
                    project_id,
                    SearchSourceKind::Gsc,
                    GscFlowError::OAuthFailed,
                    SiteCredentialsState::Stored,
                    now,
                )
                .await;
                continue;
            };
            let client_secret = secrets
                .get(GOOGLE_OAUTH_SECRET_REF)
                .await
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty());
            match refresh_gsc_token(
                transport.as_ref(),
                &client_id,
                client_secret.as_deref(),
                &refresh_token,
                now,
            )
            .await
            {
                Ok(next) => {
                    if save_stored_token(secrets.as_ref(), &next).await.is_err() {
                        continue;
                    }
                    token = StoredGscToken {
                        access_token: next.access_token,
                        refresh_token: next.refresh_token,
                        expires_at: next.expires_at,
                        token_type: next.token_type,
                    };
                }
                Err(error) => {
                    let _ = mark_source_failed(
                        &pool,
                        project_id,
                        SearchSourceKind::Gsc,
                        error,
                        SiteCredentialsState::Stored,
                        now,
                    )
                    .await;
                    continue;
                }
            }
        }

        let (start, end) = gsc_window(now.date_naive());
        let start = start.to_string();
        let end = end.to_string();
        let Ok(metrics) = fetch_gsc_metrics(
            transport.as_ref(),
            project_id,
            &token.access_token,
            &site_url,
            &start,
            &end,
            now,
        )
        .await
        else {
            let _ = mark_source_failed(
                &pool,
                project_id,
                SearchSourceKind::Gsc,
                GscFlowError::FetchFailed,
                SiteCredentialsState::Stored,
                now,
            )
            .await;
            continue;
        };
        if SearchMetricRepo::new(pool.clone())
            .replace_metrics_slot(
                project_id,
                SearchSourceKind::Gsc,
                &start,
                &end,
                &metrics,
                &[],
            )
            .await
            .is_err()
        {
            continue;
        }
        let _ = SearchRepo::new(pool.clone())
            .update_source_run(
                project_id,
                SearchSourceKind::Gsc,
                SiteChannelStatus::Ready,
                SiteCredentialsState::Stored,
                Some(&end),
                Some(now),
                None,
                now,
            )
            .await;
        refreshed += 1;
    }
    refreshed
}

/// 每日拉取 Bing：遍历所有项目的 `bing_wmt` 源，用钥匙串里的 API Key 取数。
///
/// Bing 的 OAuth 控制台不接受 loopback 重定向地址，所以没有 token 轮换这条路；
/// 失败只写源状态，旧数据不删、不抛给 UI。
pub async fn refresh_all_bing(
    pool: SqlitePool,
    secrets: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
) -> usize {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT project_id, binding FROM search_sources WHERE kind = 'bing_wmt'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    let mut refreshed = 0;
    for (project_id_raw, binding_raw) in rows {
        let Ok(project_id) = project_id_raw.parse::<ProjectId>() else {
            continue;
        };
        let binding: BTreeMap<String, String> =
            serde_json::from_str(&binding_raw).unwrap_or_default();
        let Some(site_url) = binding
            .get("siteUrl")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        // Bing 只有 API Key 一条路：没有 Key 就跳过（源状态保持原样，不伪造失败）。
        let Some(api_key) = load_bing_api_key(secrets.as_ref()).await else {
            continue;
        };
        if store_bing_metrics(
            &pool,
            transport.as_ref(),
            project_id,
            &BingAuth::ApiKey(api_key),
            &site_url,
            Utc::now(),
        )
        .await
        {
            refreshed += 1;
        }
    }
    refreshed
}

/// 拉一次 Bing 数据并落库；返回是否成功。失败只写源状态，旧数据保留。
async fn store_bing_metrics(
    pool: &SqlitePool,
    transport: &dyn Transport,
    project_id: ProjectId,
    auth: &BingAuth,
    site_url: &str,
    now: DateTime<Utc>,
) -> bool {
    let (start, end) = bing_window(now.date_naive());
    let start = start.to_string();
    let end = end.to_string();
    let metrics =
        match fetch_bing_metrics(transport, project_id, auth, site_url, &start, &end, now).await {
            Ok(metrics) => metrics,
            Err(_) => {
                let _ = mark_source_failed(
                    pool,
                    project_id,
                    SearchSourceKind::BingWmt,
                    GscFlowError::FetchFailed,
                    SiteCredentialsState::Stored,
                    now,
                )
                .await;
                return false;
            }
        };
    if SearchMetricRepo::new(pool.clone())
        .replace_metrics_slot(
            project_id,
            SearchSourceKind::BingWmt,
            &start,
            &end,
            &metrics,
            &[],
        )
        .await
        .is_err()
    {
        return false;
    }
    let _ = SearchRepo::new(pool.clone())
        .update_source_run(
            project_id,
            SearchSourceKind::BingWmt,
            SiteChannelStatus::Ready,
            SiteCredentialsState::Stored,
            Some(&end),
            Some(now),
            None,
            now,
        )
        .await;
    true
}

async fn mark_source_failed(
    pool: &SqlitePool,
    project_id: ProjectId,
    kind: SearchSourceKind,
    error: GscFlowError,
    credentials: SiteCredentialsState,
    now: DateTime<Utc>,
) -> Result<(), geo_store::StoreError> {
    let detail = CheckDetail::new(error.check_code()).with_param("reason", error.reason());
    SearchRepo::new(pool.clone())
        .update_source_run(
            project_id,
            kind,
            SiteChannelStatus::Failed,
            credentials,
            None,
            Some(now),
            Some(detail),
            now,
        )
        .await
}

/// 授权开始后由后台任务持有：完成一次回调，然后兑换 token、拉数、落库。
#[derive(Clone)]
pub(crate) struct GscOAuthFlow {
    pool: SqlitePool,
    secrets: Arc<dyn SecretStore>,
    transport: Arc<dyn Transport>,
}

impl GscOAuthFlow {
    pub(crate) fn new(
        pool: SqlitePool,
        secrets: Arc<dyn SecretStore>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        Self {
            pool,
            secrets,
            transport,
        }
    }

    pub(crate) async fn run(self, listener: TcpListener, context: OAuthFlowContext) {
        let Ok((mut stream, _)) = listener.accept().await else {
            self.mark_failed(&context.project_id, GscFlowError::OAuthFailed)
                .await;
            return;
        };

        let mut buffer = vec![0_u8; 8192];
        let read = stream.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let params = callback_params(&request);

        if params.contains_key("error") {
            respond(&mut stream, 400, FAILURE_HTML).await;
            self.mark_failed(&context.project_id, GscFlowError::OAuthFailed)
                .await;
            return;
        }
        let state_ok = params.get("state").map(String::as_str) == Some(context.state.as_str());
        let code = params
            .get("code")
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty());
        if !state_ok || code.is_none() {
            respond(&mut stream, 400, FAILURE_HTML).await;
            self.mark_failed(&context.project_id, GscFlowError::StateMismatch)
                .await;
            return;
        }

        // 先把浏览器侧的页面关掉，再走 token / 拉数；失败只回写在源状态里。
        respond(&mut stream, 200, SUCCESS_HTML).await;
        let code = code.expect("上面已判空");

        let token = match oauth_exchange(
            self.transport.as_ref(),
            &context.client_id,
            context.client_secret.as_deref(),
            code,
            &context.verifier,
            &context.redirect_uri,
            Utc::now(),
        )
        .await
        {
            Ok(token) => token,
            Err(error) => {
                self.mark_failed(&context.project_id, error).await;
                return;
            }
        };

        if self.store_token(&token).await.is_err() {
            self.mark_failed(&context.project_id, GscFlowError::OAuthFailed)
                .await;
            return;
        }

        let imported_at = Utc::now();
        let (start, end) = gsc_window(imported_at.date_naive());
        let start = start.to_string();
        let end = end.to_string();
        let metrics = match fetch_gsc_metrics(
            self.transport.as_ref(),
            context.project_id,
            &token.access_token,
            &context.site_url,
            &start,
            &end,
            imported_at,
        )
        .await
        {
            Ok(metrics) => metrics,
            Err(error) => {
                self.mark_failed(&context.project_id, error).await;
                return;
            }
        };

        if SearchMetricRepo::new(self.pool.clone())
            .replace_metrics_slot(
                context.project_id,
                SearchSourceKind::Gsc,
                &start,
                &end,
                &metrics,
                &[],
            )
            .await
            .is_err()
        {
            self.mark_failed(&context.project_id, GscFlowError::FetchFailed)
                .await;
            return;
        }

        let _ = SearchRepo::new(self.pool.clone())
            .update_source_run(
                context.project_id,
                SearchSourceKind::Gsc,
                SiteChannelStatus::Ready,
                SiteCredentialsState::Stored,
                Some(&end),
                Some(imported_at),
                None,
                imported_at,
            )
            .await;
    }

    async fn store_token(&self, token: &GscToken) -> Result<(), geo_store::StoreError> {
        save_stored_token(self.secrets.as_ref(), token).await
    }

    async fn mark_failed(&self, project_id: &ProjectId, error: GscFlowError) {
        let credentials = match self.secrets.exists(GSC_TOKEN_REF).await {
            Ok(true) => SiteCredentialsState::Stored,
            _ => SiteCredentialsState::Missing,
        };
        let now = Utc::now();
        let detail = CheckDetail::new(error.check_code()).with_param("reason", error.reason());
        let _ = SearchRepo::new(self.pool.clone())
            .update_source_run(
                *project_id,
                SearchSourceKind::Gsc,
                SiteChannelStatus::Failed,
                credentials,
                None,
                Some(now),
                Some(detail),
                now,
            )
            .await;
    }
}

fn callback_params(request: &str) -> BTreeMap<String, String> {
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default();
    let Some((path, query)) = target.split_once('?') else {
        return BTreeMap::new();
    };
    if path != CALLBACK_PATH {
        return BTreeMap::new();
    }
    form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect()
}

async fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        if status == 200 { "OK" } else { "Bad Request" },
        body.len(),
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// 供 `oauth_begin` 的 IPC 错误映射复用：绑定 loopback 失败时不泄露系统细节。
pub(crate) fn bind_failed() -> IpcError {
    IpcError::with_params(
        "validation/failed",
        [("field", "oauth"), ("reason", "not_allowed")],
    )
}
