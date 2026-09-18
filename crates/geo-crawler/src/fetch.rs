//! 受限抓取器：单页超时、体积上限、MIME 白名单与重定向跟随。
//!
//! robots 判定不在本模块内做（由 `site::crawl_site` 统一调用 [`RobotsRules`]），
//! 本模块只负责「把一个 URL 安全地变成字节」。
//! 抓取器不接触任何密钥，错误信息里也只出现 URL 与状态码。

use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use url::Url;

use crate::error::CrawlerError;
use crate::extract::{decode, detect_charset, RawPage};

/// 最多跟随的重定向次数。
const MAX_REDIRECTS: usize = 5;

/// 抓取限额：页数、超时与体积。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FetchLimits {
    /// 单次整站抓取最多保留的页面数。
    pub max_pages: usize,
    /// 单页超时，覆盖建连、响应头与整个响应体。
    pub per_page_timeout: Duration,
    /// 整站抓取总超时。
    pub total_timeout: Duration,
    /// 单页响应体上限（字节），超过即放弃该页。
    pub max_bytes: usize,
}

impl Default for FetchLimits {
    fn default() -> Self {
        Self {
            max_pages: 8,
            per_page_timeout: Duration::from_secs(10),
            total_timeout: Duration::from_secs(60),
            max_bytes: 2 * 1024 * 1024,
        }
    }
}

/// 站点抓取器：可复用的 HTTP 客户端 + 限额 + UA。
#[derive(Debug)]
pub struct SiteFetcher {
    http: reqwest::Client,
    /// 生效的抓取限额。
    pub limits: FetchLimits,
    /// 发送给站点的 User-Agent，robots 分组匹配也用这个值。
    pub user_agent: String,
}

impl SiteFetcher {
    /// 构造抓取器。`proxy` 为 `None` 或空白时不走代理。
    ///
    /// 本仓的 reqwest 用 `rustls-no-provider`（避免 aws-lc-sys 依赖 cmake），
    /// 因此建客户端前必须安装 crypto provider；重复安装返回 `Err`，忽略即可
    /// （进程级只需成功一次，多次构造抓取器不会 panic）。
    pub fn new(
        limits: FetchLimits,
        user_agent: impl Into<String>,
        proxy: Option<String>,
    ) -> Result<Self, CrawlerError> {
        let _ = rustls::crypto::ring::default_provider().install_default();

        let user_agent = user_agent.into();
        let mut builder = reqwest::Client::builder()
            .user_agent(&user_agent)
            .connect_timeout(limits.per_page_timeout)
            .timeout(limits.per_page_timeout)
            .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS));
        if let Some(proxy_url) = normalize_proxy(proxy) {
            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|error| {
                CrawlerError::InvalidUrl(format!("代理地址无效：{proxy_url}（{error}）"))
            })?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|error| CrawlerError::Network(format!("构造 HTTP 客户端失败：{error}")))?;
        Ok(Self {
            http,
            limits,
            user_agent,
        })
    }

    /// 抓取单个页面，返回未解码的原始字节。
    ///
    /// `per_page_timeout` 在此收口：即使响应体是慢速分块传输，也不会拖过限额。
    pub async fn fetch(&self, url: &Url) -> Result<RawPage, CrawlerError> {
        match tokio::time::timeout(self.limits.per_page_timeout, self.fetch_body(url)).await {
            Ok(result) => result,
            Err(_elapsed) => {
                tracing::warn!(url = %url, "单页抓取超时");
                Err(CrawlerError::Timeout {
                    url: url.to_string(),
                })
            }
        }
    }

    /// 抓取并解码为文本，供 robots.txt 等纯文本资源使用。
    pub async fn fetch_text(&self, url: &Url) -> Result<String, CrawlerError> {
        let raw = self.fetch(url).await?;
        let encoding = detect_charset(raw.content_type.as_deref(), &raw.bytes);
        Ok(decode(&raw.bytes, encoding))
    }

    /// 实际的请求-读体流程。
    async fn fetch_body(&self, url: &Url) -> Result<RawPage, CrawlerError> {
        let mut response = self
            .http
            .get(url.clone())
            .send()
            .await
            .map_err(|error| transport_error(error, url))?;

        let status = response.status();
        if !status.is_success() {
            return Err(CrawlerError::Network(format!("HTTP {status} {url}")));
        }
        // 跟随重定向后以最终地址为准：后续 robots 判定与去重都要用它。
        let final_url = response.url().clone();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        if !is_accepted_mime(content_type.as_deref()) {
            return Err(CrawlerError::Blocked {
                url: final_url.to_string(),
                reason: "非 HTML 内容".to_string(),
            });
        }
        // 先看 Content-Length 提前止损，再边读边校验，防住没有长度声明的分块响应。
        if let Some(length) = response.content_length() {
            if usize::try_from(length).unwrap_or(usize::MAX) > self.limits.max_bytes {
                return Err(CrawlerError::TooLarge {
                    url: final_url.to_string(),
                });
            }
        }
        let mut bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transport_error(error, &final_url))?
        {
            bytes.extend_from_slice(&chunk);
            if bytes.len() > self.limits.max_bytes {
                return Err(CrawlerError::TooLarge {
                    url: final_url.to_string(),
                });
            }
        }
        Ok(RawPage {
            url: final_url.to_string(),
            bytes,
            content_type,
            status: status.as_u16(),
        })
    }
}

/// 归一化代理配置：空白视为未配置。
fn normalize_proxy(proxy: Option<String>) -> Option<String> {
    proxy
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// MIME 白名单：HTML、XHTML 与纯文本（robots.txt）。
/// 缺少 `Content-Type` 时按 HTML 处理（老站点常见），由后续解码与提取兜底。
pub(crate) fn is_accepted_mime(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else {
        return true;
    };
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    mime.is_empty()
        || matches!(
            mime.as_str(),
            "text/html" | "text/plain" | "application/xhtml+xml"
        )
}

/// 传输层错误归类：超时单独成类，其余归入网络错误（含 URL 便于排查）。
fn transport_error(error: reqwest::Error, url: &Url) -> CrawlerError {
    if error.is_timeout() {
        CrawlerError::Timeout {
            url: url.to_string(),
        }
    } else {
        CrawlerError::Network(format!("{url} 请求失败：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use url::Url;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::extract::extract;
    use crate::robots::RobotsRules;
    use crate::testkit::mount_fixture_site;

    const BOT_UA: &str = "GdkBot/0.1 (+https://gaodekuai.local)";

    /// 启动夹具站点与默认参数的抓取器。
    async fn fixture_fetcher() -> (MockServer, SiteFetcher) {
        let server = MockServer::start().await;
        mount_fixture_site(&server).await;
        let fetcher =
            SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("构造抓取器失败");
        (server, fetcher)
    }

    fn url_of(server: &MockServer, path: &str) -> Url {
        Url::parse(&format!("{}{path}", server.uri())).expect("夹具 URL 应可解析")
    }

    #[test]
    fn default_limits_match_the_plan() {
        let limits = FetchLimits::default();
        assert_eq!(limits.max_pages, 8);
        assert_eq!(limits.per_page_timeout, Duration::from_secs(10));
        assert_eq!(limits.total_timeout, Duration::from_secs(60));
        assert_eq!(limits.max_bytes, 2_097_152);
    }

    #[test]
    fn building_two_fetchers_does_not_panic() {
        // reqwest 用 rustls-no-provider：crypto provider 重复安装必须被静默忽略。
        let first = SiteFetcher::new(FetchLimits::default(), "A/1", None).expect("第一个抓取器");
        let second = SiteFetcher::new(FetchLimits::default(), "B/2", None).expect("第二个抓取器");
        assert_eq!(first.user_agent, "A/1");
        assert_eq!(second.user_agent, "B/2");
        assert_eq!(first.limits.max_pages, 8);
    }

    #[test]
    fn blank_proxy_is_treated_as_unset_and_invalid_proxy_is_rejected() {
        SiteFetcher::new(FetchLimits::default(), BOT_UA, Some("   ".to_string()))
            .expect("空白代理应视为未配置");
        SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("无代理应成功");

        let error = SiteFetcher::new(
            FetchLimits::default(),
            BOT_UA,
            Some("::: 不是代理地址 :::".to_string()),
        )
        .expect_err("非法代理应报错");
        assert!(matches!(error, CrawlerError::InvalidUrl(_)), "{error}");
        assert_eq!(error.code(), "crawler/invalid_url");
        assert!(error.user_message().contains("代理"));
    }

    #[tokio::test]
    async fn fetch_returns_raw_bytes_and_metadata() {
        let (server, fetcher) = fixture_fetcher().await;
        let url = url_of(&server, "/");
        let raw = fetcher.fetch(&url).await.expect("首页抓取失败");

        assert_eq!(raw.status, 200);
        assert_eq!(raw.url, url.to_string());
        assert_eq!(
            raw.content_type.as_deref(),
            Some("text/html; charset=utf-8")
        );
        assert!(String::from_utf8_lossy(&raw.bytes).contains("宏宇泵业"));

        let page = extract(&raw).expect("提取失败");
        assert!(page.main_text.contains("自有水力性能测试台"));
    }

    #[tokio::test]
    async fn fetch_gbk_page_over_http_decodes_without_replacement_chars() {
        let (server, fetcher) = fixture_fetcher().await;
        let raw = fetcher
            .fetch(&url_of(&server, "/gbk-page.html"))
            .await
            .expect("GBK 页抓取失败");

        assert_eq!(raw.content_type.as_deref(), Some("text/html; charset=gbk"));
        assert!(
            std::str::from_utf8(&raw.bytes).is_err(),
            "线上字节应仍是 GBK"
        );

        let page = extract(&raw).expect("GBK 页提取失败");
        assert!(page.title.contains("技术公告"));
        assert!(page.main_text.contains("报修后 4 小时内响应"));
        assert!(!page.main_text.contains('\u{FFFD}'), "不应出现乱码替换符");
    }

    #[tokio::test]
    async fn fetch_text_reads_robots_txt() {
        let (server, fetcher) = fixture_fetcher().await;
        let text = fetcher
            .fetch_text(&url_of(&server, "/robots.txt"))
            .await
            .expect("robots.txt 抓取失败");

        assert!(text.contains("Disallow: /admin"));
        let rules = RobotsRules::parse(&text, BOT_UA);
        assert!(!rules.is_allowed("/admin/secret"));
        assert!(rules.is_allowed("/about.html"));
    }

    #[tokio::test]
    async fn request_carries_the_configured_user_agent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ua"))
            .and(header("user-agent", BOT_UA))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("<html><body>ok</body></html>"),
            )
            .expect(1)
            .mount(&server)
            .await;
        let fetcher = SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("构造失败");

        fetcher
            .fetch(&url_of(&server, "/ua"))
            .await
            .expect("带 UA 的请求应成功");
        server.verify().await;
    }

    #[tokio::test]
    async fn non_2xx_maps_to_network_error_carrying_the_status() {
        let server = MockServer::start().await;
        let fetcher = SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("构造失败");

        for status in [404u16, 500, 503] {
            let route = format!("/status-{status}");
            Mock::given(method("GET"))
                .and(path(route.clone()))
                .respond_with(ResponseTemplate::new(status))
                .mount(&server)
                .await;

            let error = fetcher
                .fetch(&url_of(&server, &route))
                .await
                .expect_err("非 2xx 应报错");
            assert!(matches!(error, CrawlerError::Network(_)), "{error}");
            assert!(error.to_string().contains(&status.to_string()), "{error}");
            assert_eq!(error.code(), "crawler/network");
        }
    }

    #[tokio::test]
    async fn oversized_response_maps_to_too_large() {
        let server = MockServer::start().await;
        let body = "<html><body>".to_string() + &"宏".repeat(400) + "</body></html>";
        Mock::given(method("GET"))
            .and(path("/big"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "text/html; charset=utf-8"))
            .mount(&server)
            .await;
        let fetcher = SiteFetcher::new(
            FetchLimits {
                max_bytes: 512,
                ..FetchLimits::default()
            },
            BOT_UA,
            None,
        )
        .expect("构造失败");

        let url = url_of(&server, "/big");
        let error = fetcher.fetch(&url).await.expect_err("超限应报错");
        assert!(matches!(error, CrawlerError::TooLarge { .. }), "{error}");
        assert_eq!(error.code(), "crawler/too_large");
        assert!(error.to_string().contains(url.as_str()), "{error}");
    }

    #[tokio::test]
    async fn slow_response_maps_to_timeout() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/slow"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("<html><body>慢</body></html>")
                    .set_delay(Duration::from_secs(5)),
            )
            .mount(&server)
            .await;
        let fetcher = SiteFetcher::new(
            FetchLimits {
                per_page_timeout: Duration::from_millis(200),
                ..FetchLimits::default()
            },
            BOT_UA,
            None,
        )
        .expect("构造失败");

        let started = Instant::now();
        let error = fetcher
            .fetch(&url_of(&server, "/slow"))
            .await
            .expect_err("超时应报错");
        assert!(matches!(error, CrawlerError::Timeout { .. }), "{error}");
        assert_eq!(error.code(), "crawler/timeout");
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "应在 per-page 超时后立即返回，而不是等满服务端延时"
        );
    }

    #[tokio::test]
    async fn non_html_content_type_is_blocked() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/manual.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(vec![b'%', b'P', b'D', b'F'], "application/pdf"),
            )
            .mount(&server)
            .await;
        let fetcher = SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("构造失败");

        let error = fetcher
            .fetch(&url_of(&server, "/manual.pdf"))
            .await
            .expect_err("非 HTML 内容应被拒绝");
        assert!(matches!(error, CrawlerError::Blocked { .. }), "{error}");
        assert!(error.to_string().contains("非 HTML 内容"), "{error}");
        assert_eq!(error.code(), "crawler/blocked");
    }

    #[tokio::test]
    async fn html_plain_and_xhtml_content_types_are_accepted() {
        let server = MockServer::start().await;
        for (route, mime) in [
            ("/page.html", "text/html"),
            ("/page.xhtml", "application/xhtml+xml; charset=utf-8"),
            ("/page.txt", "text/plain; charset=utf-8"),
            ("/page-upper", "TEXT/HTML; CHARSET=UTF-8"),
        ] {
            Mock::given(method("GET"))
                .and(path(route))
                .respond_with(
                    ResponseTemplate::new(200).set_body_raw("<html><body>正文</body></html>", mime),
                )
                .mount(&server)
                .await;
        }
        let fetcher = SiteFetcher::new(FetchLimits::default(), BOT_UA, None).expect("构造失败");

        for route in ["/page.html", "/page.xhtml", "/page.txt", "/page-upper"] {
            let raw = fetcher
                .fetch(&url_of(&server, route))
                .await
                .unwrap_or_else(|error| panic!("{route} 应被接受：{error}"));
            assert_eq!(raw.status, 200);
            assert!(extract(&raw).expect("提取失败").main_text.contains("正文"));
        }
    }

    #[tokio::test]
    async fn redirects_are_followed_and_final_url_is_recorded() {
        let (server, fetcher) = fixture_fetcher().await;
        Mock::given(method("GET"))
            .and(path("/old"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", "/about.html"))
            .mount(&server)
            .await;

        let raw = fetcher
            .fetch(&url_of(&server, "/old"))
            .await
            .expect("应跟随重定向");
        assert_eq!(raw.status, 200);
        assert!(raw.url.ends_with("/about.html"), "实际：{}", raw.url);
        assert!(extract(&raw).expect("提取失败").title.contains("公司简介"));
    }

    #[test]
    fn accepted_mime_predicate_covers_the_documented_set() {
        assert!(is_accepted_mime(Some("text/html")));
        assert!(is_accepted_mime(Some("text/html; charset=gbk")));
        assert!(is_accepted_mime(Some("TEXT/HTML")));
        assert!(is_accepted_mime(Some("text/plain")));
        assert!(is_accepted_mime(Some("application/xhtml+xml")));
        assert!(is_accepted_mime(None), "缺少 Content-Type 时按 HTML 处理");
        assert!(!is_accepted_mime(Some("application/pdf")));
        assert!(!is_accepted_mime(Some("image/png")));
        assert!(!is_accepted_mime(Some("application/octet-stream")));
    }
}
