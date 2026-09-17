//! `geo-crawler` 的 crate 级错误：稳定错误码 + 中文可读原因。
//!
//! 跨 crate 边界统一转成 `geo_domain::GeoError`：抓取失败属于「站点上游」问题，
//! 因此全部归入 `GeoError::Upstream`，并保留 `crawler/` 前缀，
//! 转换后的 `GeoError::code()` 形如 `upstream/crawler/blocked`。
//! 错误信息中不得出现 API Key、Cookie 等敏感内容（本 crate 也不接触密钥）。

use geo_domain::GeoError;

/// 抓取与解析过程中的错误。`Display` 文案全部为中文，可直接展示给用户。
#[derive(Debug, thiserror::Error)]
pub enum CrawlerError {
    /// 被 robots.txt 或内容类型策略拒绝抓取。
    #[error("抓取被拒绝：{url}（{reason}）")]
    Blocked { url: String, reason: String },
    /// 单页抓取超时。
    #[error("抓取超时：{url}")]
    Timeout { url: String },
    /// 网络连接失败或 HTTP 状态非 2xx。
    #[error("网络错误：{0}")]
    Network(String),
    /// 响应体超过 `FetchLimits::max_bytes`。
    #[error("页面体积超过上限：{url}")]
    TooLarge { url: String },
    /// 链接地址非法（无法解析或非 http/https）。
    #[error("链接地址无效：{0}")]
    InvalidUrl(String),
    /// 页面解码或 HTML 转文本失败。
    #[error("页面解码失败：{0}")]
    Decode(String),
}

impl CrawlerError {
    /// 稳定错误码，供前端分支处理。
    pub fn code(&self) -> &'static str {
        match self {
            Self::Blocked { .. } => "crawler/blocked",
            Self::Timeout { .. } => "crawler/timeout",
            Self::Network(_) => "crawler/network",
            Self::TooLarge { .. } => "crawler/too_large",
            Self::InvalidUrl(_) => "crawler/invalid_url",
            Self::Decode(_) => "crawler/decode",
        }
    }

    /// 面向用户的中文原因。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

impl From<CrawlerError> for GeoError {
    fn from(error: CrawlerError) -> Self {
        let code = error.code();
        GeoError::upstream(code, error.user_message())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_a_stable_code() {
        let cases = [
            (
                CrawlerError::Blocked {
                    url: "https://a.example/x".to_string(),
                    reason: "robots 禁止".to_string(),
                },
                "crawler/blocked",
            ),
            (
                CrawlerError::Timeout {
                    url: "https://a.example/x".to_string(),
                },
                "crawler/timeout",
            ),
            (
                CrawlerError::Network("HTTP 500".to_string()),
                "crawler/network",
            ),
            (
                CrawlerError::TooLarge {
                    url: "https://a.example/x".to_string(),
                },
                "crawler/too_large",
            ),
            (
                CrawlerError::InvalidUrl("abc".to_string()),
                "crawler/invalid_url",
            ),
            (
                CrawlerError::Decode("非法字节".to_string()),
                "crawler/decode",
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(error.code(), expected);
        }
    }

    #[test]
    fn display_is_chinese_and_carries_context() {
        let error = CrawlerError::Blocked {
            url: "https://a.example/admin".to_string(),
            reason: "robots.txt 禁止抓取".to_string(),
        };
        let message = error.user_message();
        assert!(message.contains("抓取被拒绝"));
        assert!(message.contains("https://a.example/admin"));
        assert!(message.contains("robots.txt 禁止抓取"));
    }

    #[test]
    fn converts_to_geo_error_keeping_code_namespace() {
        let error = CrawlerError::Timeout {
            url: "https://a.example/slow".to_string(),
        };
        let message = error.user_message();
        let geo = GeoError::from(error);
        assert_eq!(geo.code(), "upstream/crawler/timeout");
        assert!(geo.code().ends_with("crawler/timeout"));
        assert!(
            geo.user_message().contains(&message),
            "转换后应保留原始中文原因：{}",
            geo.user_message()
        );
        assert!(matches!(geo, GeoError::Upstream { .. }));
    }
}
