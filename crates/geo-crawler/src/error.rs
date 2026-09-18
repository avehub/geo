//! `geo-crawler` 的 crate 级错误：稳定 `code` + 语言中立 `params`。
//!
//! 跨 crate 边界统一转成 `geo_domain::GeoError`：抓取失败属于「站点上游」问题，
//! 因此全部归入 `GeoError::Upstream`，并保留 `crawler/` 前缀，
//! 转换后的 `GeoError::code()` 形如 `upstream/crawler/blocked`。
//! 错误信息中不得出现 API Key、Cookie 等敏感内容（本 crate 也不接触密钥）。
//!
//! `Display` 是**日志格式**（`"{code} {k}={v} …"`）而不是给人读的句子：文案由前端
//! 词典按当前语言渲染，键名由冻结的 `contracts/error-codes.json` 登记
//! （与 `GeoError::Display`、壳里 `IpcError::with_params` 的兜底文案逐字同构）。

use std::collections::BTreeMap;
use std::fmt;

use geo_domain::GeoError;

/// `crawler/blocked` 的固定 reason：目录里的 `not_allowed`
/// （「协议/取值/**内容**不被允许」——MIME 白名单拒收正属此类）。
///
/// 做成常量而不是让站点自由填 `reason` 字段：`Blocked` 的唯一生产站点
/// （`fetch.rs` 的 MIME 判定）只有一种语义，把 reason 变成变体不变量，
/// 「往 params 里塞一句中文散文」这件事在类型上就不可表达（裁定 A-1）。
const REASON_NOT_ALLOWED: &str = "not_allowed";

/// `Blocked` 拿不到 content-type（响应头缺失或不是合法 UTF-8）时 `value` 的取值。
const CONTENT_TYPE_UNKNOWN: &str = "unknown";

/// 抓取与解析过程中的错误。
#[derive(Debug)]
pub enum CrawlerError {
    /// 内容类型策略拒绝抓取（MIME 白名单外的响应体）。
    ///
    /// `params()` 的 `reason` 恒为 [`REASON_NOT_ALLOWED`]，`content_type` 落进
    /// `value`（拿不到时是 `"unknown"`）。robots.txt 的拒绝**不走这里**——那是
    /// `site.rs` 的 `SkippedPage`（不报错，只记跳过原因）。
    Blocked {
        url: String,
        content_type: Option<String>,
    },
    /// 单页抓取超时。
    Timeout { url: String },
    /// 网络连接失败或 HTTP 状态非 2xx。
    ///
    /// `url` / `status` 是 `Option`：构造 HTTP 客户端失败时两者都拿不到，
    /// 请求发出后失败时只有 `url`，拿到非 2xx 响应时两者都有。
    /// `reason` 是稳定记号（`http_status`）或 reqwest 的原文（raw passthrough）。
    Network {
        url: Option<String>,
        status: Option<u16>,
        reason: String,
    },
    /// 响应体超过 `FetchLimits::max_bytes`，`limit` 就是那个上限的字节数。
    TooLarge { url: String, limit: usize },
    /// 链接地址非法（无法解析或非 http/https）：`url` 是裸地址，`reason` 是解析器原文。
    InvalidUrl { url: String, reason: String },
    /// 页面解码或 HTML 转文本失败。
    Decode(String),
}

impl CrawlerError {
    /// 稳定错误码，供前端分支处理。
    pub fn code(&self) -> &'static str {
        match self {
            Self::Blocked { .. } => "crawler/blocked",
            Self::Timeout { .. } => "crawler/timeout",
            Self::Network { .. } => "crawler/network",
            Self::TooLarge { .. } => "crawler/too_large",
            Self::InvalidUrl { .. } => "crawler/invalid_url",
            Self::Decode(_) => "crawler/decode",
        }
    }

    /// 语言中立参数，键名由 `contracts/error-codes.json` 冻结：
    /// `blocked` → `{url, reason:"not_allowed", value:<content-type|unknown>}`、
    /// `invalid_url` → `{url, reason}`、`timeout` → `{url}`、
    /// `network` → `{reason}` ∪ 拿得到的 `url` / `status`、
    /// `too_large` → `{url, limit}`、`decode` → `{reason}`。
    ///
    /// 这是 `code` 之外唯一的真值源：`Display` 与壳里的
    /// `From<CrawlerError> for IpcError` 都复用它，不再各拼一份。
    ///
    /// `value` 一律 ASCII：content-type 是 HTTP 头，非 ASCII 的取值到不了这里
    /// （`HeaderValue::to_str()` 已经先过滤掉），拿不到就是 `"unknown"`。
    pub fn params(&self) -> BTreeMap<String, String> {
        let mut params = BTreeMap::new();
        match self {
            Self::Blocked { url, content_type } => {
                params.insert("url".to_string(), url.clone());
                params.insert("reason".to_string(), REASON_NOT_ALLOWED.to_string());
                params.insert(
                    "value".to_string(),
                    content_type
                        .clone()
                        .unwrap_or_else(|| CONTENT_TYPE_UNKNOWN.to_string()),
                );
            }
            Self::InvalidUrl { url, reason } => {
                params.insert("url".to_string(), url.clone());
                params.insert("reason".to_string(), reason.clone());
            }
            Self::Timeout { url } => {
                params.insert("url".to_string(), url.clone());
            }
            Self::Network {
                url,
                status,
                reason,
            } => {
                params.insert("reason".to_string(), reason.clone());
                if let Some(url) = url {
                    params.insert("url".to_string(), url.clone());
                }
                if let Some(status) = status {
                    params.insert("status".to_string(), status.to_string());
                }
            }
            Self::TooLarge { url, limit } => {
                params.insert("url".to_string(), url.clone());
                params.insert("limit".to_string(), limit.to_string());
            }
            Self::Decode(reason) => {
                params.insert("reason".to_string(), reason.clone());
            }
        }
        params
    }

    /// 日志/兜底文案：紧凑格式，不承诺任何语言的散文。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

/// 紧凑日志格式：`"{code} {k}={v} …"`，键序按 `BTreeMap`（字典序）。
///
/// 手写而不用派生宏的 `#[error("…")]` 模板：`params()` 必须保持单一真值源，
/// 而 `Network` 的 `url` / `status` 是 `Option`——「有值才输出」模板里表达不了。
impl fmt::Display for CrawlerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())?;
        for (key, value) in self.params() {
            write!(f, " {key}={value}")?;
        }
        Ok(())
    }
}

impl std::error::Error for CrawlerError {}

impl From<CrawlerError> for GeoError {
    fn from(error: CrawlerError) -> Self {
        let code = error.code();
        GeoError::upstream(code, error.user_message())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 期望的 params：逐键相等，避免「只发子集也算过」的假绿。
    fn expected(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    const URL: &str = "https://a.example/x";

    fn cases() -> Vec<(CrawlerError, &'static str)> {
        vec![
            (
                CrawlerError::Blocked {
                    url: URL.to_string(),
                    content_type: Some("application/pdf".to_string()),
                },
                "crawler/blocked",
            ),
            (
                CrawlerError::Blocked {
                    url: URL.to_string(),
                    content_type: None,
                },
                "crawler/blocked",
            ),
            (
                CrawlerError::Timeout {
                    url: URL.to_string(),
                },
                "crawler/timeout",
            ),
            (
                CrawlerError::Network {
                    url: Some(URL.to_string()),
                    status: Some(500),
                    reason: "http_status".to_string(),
                },
                "crawler/network",
            ),
            (
                CrawlerError::Network {
                    url: None,
                    status: None,
                    reason: "client_build".to_string(),
                },
                "crawler/network",
            ),
            (
                CrawlerError::TooLarge {
                    url: URL.to_string(),
                    limit: 512,
                },
                "crawler/too_large",
            ),
            (
                CrawlerError::InvalidUrl {
                    url: "abc".to_string(),
                    reason: "relative URL without a base".to_string(),
                },
                "crawler/invalid_url",
            ),
            (
                CrawlerError::Decode("invalid byte sequence".to_string()),
                "crawler/decode",
            ),
        ]
    }

    #[test]
    fn every_variant_has_a_stable_code() {
        for (error, code) in cases() {
            assert_eq!(error.code(), code, "{error:?} 的错误码不符");
        }
    }

    /// Task 4：`params()` 是 IPC 边界唯一的真值源（壳侧 `From<CrawlerError>` 直接委托），
    /// 键集必须逐字等于 `contracts/error-codes.json` 给该 code 登记的 params。
    ///
    /// 名字里的「frozen catalog」指的是**契约给该 code 登记的键集**，但本测试并不读
    /// `contracts/error-codes.json`（清单只在壳侧 `include_str!`，crate 层拿不到），
    /// 期望 map 是硬编码的。真正读契约文件的是壳侧的
    /// `catalog_params_equal_the_emitted_union` 与 `llm_and_crawler_params_follow_the_contract`
    /// ——契约改了而这里没跟上，红的是那两条（复审 M-6）。
    #[test]
    fn params_match_the_frozen_catalog() {
        assert_eq!(
            CrawlerError::Timeout {
                url: URL.to_string()
            }
            .params(),
            expected(&[("url", URL)])
        );
        assert_eq!(
            CrawlerError::Blocked {
                url: URL.to_string(),
                content_type: Some("application/pdf".to_string())
            }
            .params(),
            // A-1：reason 恒为目录里的 `not_allowed`（内容类型不被白名单接受 =
            // 「内容不被允许」），具体是什么 content-type 属**数据**，装 `value`
            expected(&[
                ("reason", "not_allowed"),
                ("url", URL),
                ("value", "application/pdf")
            ])
        );
        // 头缺失/不可解码时 `value` 发 `unknown`：**永远发 value**，
        // 不给前端留「有时有这个键」的条件渲染（裁定 A-1）
        assert_eq!(
            CrawlerError::Blocked {
                url: URL.to_string(),
                content_type: None
            }
            .params(),
            expected(&[
                ("reason", "not_allowed"),
                ("url", URL),
                ("value", "unknown")
            ])
        );
        // `Network` 富化后：有 HTTP 响应时三个键都发；构造客户端失败时只有 reason
        assert_eq!(
            CrawlerError::Network {
                url: Some(URL.to_string()),
                status: Some(500),
                reason: "http_status".to_string()
            }
            .params(),
            expected(&[("reason", "http_status"), ("status", "500"), ("url", URL)])
        );
        assert_eq!(
            CrawlerError::Network {
                url: None,
                status: None,
                reason: "client_build".to_string()
            }
            .params(),
            expected(&[("reason", "client_build")])
        );
        // `TooLarge` 带上限字节数，前端才能说清「超过多少」
        assert_eq!(
            CrawlerError::TooLarge {
                url: URL.to_string(),
                limit: 512
            }
            .params(),
            expected(&[("limit", "512"), ("url", URL)])
        );
        // `InvalidUrl` 富化后 url 与 reason 分开：url 是裸地址，reason 是解析器原文
        assert_eq!(
            CrawlerError::InvalidUrl {
                url: "abc".to_string(),
                reason: "relative URL without a base".to_string()
            }
            .params(),
            expected(&[("reason", "relative URL without a base"), ("url", "abc")])
        );
        assert_eq!(
            CrawlerError::Decode("invalid byte sequence".to_string()).params(),
            expected(&[("reason", "invalid byte sequence")])
        );
    }

    /// `Display` 是**日志格式**（`{code} k=v …`），与 `GeoError::Display` 同构；
    /// 不再是中文散文（文案归前端词典，AGENTS 规则 7）。
    #[test]
    fn display_is_compact_log_format() {
        for (error, code) in cases() {
            let message = error.user_message();
            assert_eq!(message, error.to_string());
            assert!(message.starts_with(code), "{message} 要以 code 开头");
        }
        assert_eq!(
            CrawlerError::Blocked {
                url: "https://a.example/admin".to_string(),
                content_type: Some("application/pdf".to_string())
            }
            .to_string(),
            "crawler/blocked reason=not_allowed url=https://a.example/admin value=application/pdf"
        );
        assert_eq!(
            CrawlerError::TooLarge {
                url: URL.to_string(),
                limit: 512
            }
            .to_string(),
            format!("crawler/too_large limit=512 url={URL}")
        );
    }

    #[test]
    fn converts_to_geo_error_keeping_code_namespace() {
        let error = CrawlerError::Timeout {
            url: "https://a.example/slow".to_string(),
        };
        let message = error.user_message();
        let geo = GeoError::from(error);
        assert_eq!(geo.code(), "upstream/crawler/timeout");
        assert!(matches!(geo, GeoError::Upstream { .. }));
        assert_eq!(geo.params()["upstream_code"], "crawler/timeout");
        assert_eq!(
            geo.params()["upstream"],
            message,
            "转换后应原样保留里层的紧凑文案"
        );
    }

    /// `Display` / `Error` 改成手写之后，`CrawlerError` 仍是标准错误类型（`Box<dyn Error>` 可用）。
    #[test]
    fn crawler_error_is_a_std_error() {
        fn as_std_error(error: &dyn std::error::Error) -> String {
            error.to_string()
        }
        let error = CrawlerError::Timeout {
            url: URL.to_string(),
        };
        assert_eq!(as_std_error(&error), format!("crawler/timeout url={URL}"));
    }
}
