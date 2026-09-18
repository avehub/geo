//! 同域站点抓取编排：robots 过滤 + 角色配额 BFS。
//!
//! 设计要点：
//! - **只抓自有域名**：竞品站点在 P0-A 一律不抓（产品红线，见 spec 4.1）；
//! - **失败不阻断**：任何单页失败都记进 `skipped` 并继续，建档宁可少一段语料，
//!   也不要因为一个 404 整体失败；
//! - **角色配额**：`max_pages` 很小时优先覆盖不同角色，避免 8 页全抓成新闻列表，
//!   导致实体卡缺「产品」「联系方式」这些关键字段。

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use url::Url;

use crate::discover::{classify, discover_from_html, normalize, PageRole};
use crate::error::CrawlerError;
use crate::extract::{extract, ExtractedPage};
use crate::fetch::{FetchLimits, SiteFetcher};
use crate::robots::RobotsRules;

/// 抓取请求：站点原点 + 可选种子页。种子为空时从原点根路径开始。
#[derive(Debug, Clone, PartialEq)]
pub struct CrawlRequest {
    pub origin: Url,
    pub seed_urls: Vec<Url>,
}

impl CrawlRequest {
    pub fn new(origin: Url) -> Self {
        Self {
            origin,
            seed_urls: Vec::new(),
        }
    }

    pub fn with_seeds(origin: Url, seed_urls: Vec<Url>) -> Self {
        Self { origin, seed_urls }
    }
}

/// 被跳过的页面与原因（robots / 网络 / 解码）。
///
/// `reason` 今天混着两种形态：robots 与总超时是 `site.rs` 自己写的中文说明；
/// 抓取失败那条来自 [`CrawlerError::user_message`](crate::CrawlerError::user_message)，
/// Task 4 之后是紧凑日志格式（`crawler/network reason=http_status status=503 url=…`）。
/// 它最终经 `entity_card_service` 落进 `crawler/empty` 的 `skipped` 参数，
/// 统一成稳定 key 属 Plan A 后续 task 的活。
#[derive(Debug, Clone, PartialEq)]
pub struct SkippedPage {
    pub url: String,
    pub reason: String,
}

/// 抓取结果：成功页面、角色索引与跳过明细。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CrawlResult {
    pub pages: Vec<ExtractedPage>,
    pub skipped: Vec<SkippedPage>,
    pub roles: HashMap<PageRole, Vec<String>>,
}

/// 拼接正文时的角色优先级：首页 → 关于 → 产品 → FAQ → 联系 → 其他。
const TEXT_PRIORITY: [PageRole; 6] = [
    PageRole::Home,
    PageRole::About,
    PageRole::Product,
    PageRole::Faq,
    PageRole::Contact,
    PageRole::Other,
];

impl CrawlResult {
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn urls_for(&self, role: PageRole) -> Vec<String> {
        self.roles.get(&role).cloned().unwrap_or_default()
    }

    /// 按角色优先级拼接正文，供 LLM 结构化抽取消费；按**字符**截断，不切半个汉字。
    pub fn combined_text(&self, max_chars: usize) -> String {
        let mut combined = String::new();
        for role in TEXT_PRIORITY {
            for url in self.urls_for(role) {
                let Some(page) = self.pages.iter().find(|page| page.url == url) else {
                    continue;
                };
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&page.main_text);
            }
        }
        combined.chars().take(max_chars).collect()
    }
}

/// 抓取整个站点（同域、受限、robots 合规）。
pub async fn crawl_site(
    fetcher: &SiteFetcher,
    request: &CrawlRequest,
    limits: &FetchLimits,
) -> CrawlResult {
    let deadline = Instant::now() + limits.total_timeout;
    let mut result = CrawlResult::default();

    let robots = load_robots(fetcher, &request.origin).await;

    let mut queue: VecDeque<Url> = VecDeque::new();
    let mut seen: HashSet<String> = HashSet::new();
    for seed in seeds_of(request) {
        enqueue(&mut queue, &mut seen, seed, &request.origin);
    }

    let mut covered: HashSet<PageRole> = HashSet::new();
    while result.pages.len() < limits.max_pages {
        if Instant::now() >= deadline {
            result.skipped.push(SkippedPage {
                url: request.origin.to_string(),
                reason: format!("已达总超时上限（{:?}），提前结束抓取", limits.total_timeout),
            });
            break;
        }
        let Some(index) = pick_next(&queue, &covered) else {
            break;
        };
        // index 来自同一个 queue 的 position()，remove 必然成功
        let url = queue
            .remove(index)
            .unwrap_or_else(|| request.origin.clone());

        if !robots.is_allowed(url.path()) {
            tracing::debug!(url = %url, "robots.txt 禁止抓取");
            result.skipped.push(SkippedPage {
                url: url.to_string(),
                reason: "robots.txt 禁止抓取该路径".to_string(),
            });
            continue;
        }

        match fetch_and_extract(fetcher, &url).await {
            Ok(page) => {
                for link in discover_from_html(&page, &request.origin) {
                    enqueue(&mut queue, &mut seen, link, &request.origin);
                }
                let role = classify(&url, &page.title);
                covered.insert(role);
                result.roles.entry(role).or_default().push(page.url.clone());
                result.pages.push(page);
            }
            Err(error) => {
                tracing::debug!(url = %url, error = %error, "页面抓取失败，跳过");
                result.skipped.push(SkippedPage {
                    url: url.to_string(),
                    reason: error.user_message(),
                });
            }
        }
    }

    result
}

async fn fetch_and_extract(
    fetcher: &SiteFetcher,
    url: &Url,
) -> Result<ExtractedPage, CrawlerError> {
    let raw = fetcher.fetch(url).await?;
    extract(&raw)
}

/// robots.txt 抓不到就当作「全放行」：小站点经常没有这个文件，
/// 不能因为 404 就把整站判成不可抓。
async fn load_robots(fetcher: &SiteFetcher, origin: &Url) -> RobotsRules {
    let Ok(robots_url) = origin.join("/robots.txt") else {
        return RobotsRules::allow_all();
    };
    match fetcher.fetch_text(&robots_url).await {
        Ok(text) => RobotsRules::parse(&text, &fetcher.user_agent),
        Err(error) => {
            tracing::debug!(%error, "robots.txt 不可用，按全放行处理");
            RobotsRules::allow_all()
        }
    }
}

fn seeds_of(request: &CrawlRequest) -> Vec<Url> {
    if request.seed_urls.is_empty() {
        vec![root_of(&request.origin)]
    } else {
        request.seed_urls.clone()
    }
}

fn root_of(origin: &Url) -> Url {
    let mut root = origin.clone();
    root.set_path("/");
    root.set_query(None);
    root.set_fragment(None);
    root
}

fn enqueue(queue: &mut VecDeque<Url>, seen: &mut HashSet<String>, url: Url, origin: &Url) {
    let Some(normalized) = normalize(&url, origin) else {
        return;
    };
    if seen.insert(normalized.to_string()) {
        queue.push_back(normalized);
    }
}

/// 选下一个要抓的 URL：**优先补还没覆盖到的角色**，其次优先有明确角色的页面，
/// 最后才退回 FIFO。这样 `max_pages` 很小时也能拿到多类语料。
fn pick_next(queue: &VecDeque<Url>, covered: &HashSet<PageRole>) -> Option<usize> {
    if queue.is_empty() {
        return None;
    }
    queue
        .iter()
        .position(|url| !covered.contains(&classify(url, "")))
        .or_else(|| {
            queue
                .iter()
                .position(|url| classify(url, "") != PageRole::Other)
        })
        .or(Some(0))
}

#[allow(dead_code)]
const _: fn() = || {
    // 编译期占位：确保 `Duration` 在本模块被显式使用（FetchLimits 的超时字段语义）
    let _: Duration = Duration::from_secs(0);
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::mount_fixture_site;
    use std::time::Duration;
    use wiremock::MockServer;

    fn limits(max_pages: usize) -> FetchLimits {
        FetchLimits {
            max_pages,
            per_page_timeout: Duration::from_secs(5),
            total_timeout: Duration::from_secs(20),
            max_bytes: 2 * 1024 * 1024,
        }
    }

    async fn server_with_fixtures() -> MockServer {
        let server = MockServer::start().await;
        mount_fixture_site(&server).await;
        server
    }

    fn fetcher(max_pages: usize) -> SiteFetcher {
        SiteFetcher::new(
            limits(max_pages),
            "geo-bot/0.1 (+https://gaodekuai.local/bot)",
            None,
        )
        .expect("抓取器可构造")
    }

    #[tokio::test]
    async fn crawls_the_five_fixture_pages_with_correct_roles() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(8);
        let origin = Url::parse(&server.uri()).unwrap();

        let result = crawl_site(&fetcher, &CrawlRequest::new(origin.clone()), &limits(8)).await;

        assert_eq!(result.page_count(), 5, "应抓到 5 个页面：{result:?}");
        assert_eq!(result.urls_for(PageRole::Home).len(), 1);
        assert_eq!(result.urls_for(PageRole::About).len(), 1);
        assert_eq!(result.urls_for(PageRole::Product).len(), 1);
        assert_eq!(result.urls_for(PageRole::Faq).len(), 1);
        assert_eq!(result.urls_for(PageRole::Contact).len(), 1);
        assert!(result.urls_for(PageRole::About)[0].ends_with("/about.html"));
    }

    #[tokio::test]
    async fn robots_blocked_page_lands_in_skipped_with_robots_reason() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(8);
        let origin = Url::parse(&server.uri()).unwrap();

        let result = crawl_site(&fetcher, &CrawlRequest::new(origin), &limits(8)).await;

        let blocked = result
            .skipped
            .iter()
            .find(|page| page.url.contains("/admin"))
            .unwrap_or_else(|| panic!("/admin/secret 应被 robots 拦下：{result:?}"));
        assert!(
            blocked.reason.contains("robots"),
            "reason 必须点明是 robots：{}",
            blocked.reason
        );
        assert!(
            !result.pages.iter().any(|page| page.url.contains("/admin")),
            "被禁页面不得进入结果"
        );
        // robots 的约束是「别去抓」，不是「抓回来再扔」：一条请求都不该发出去
        let fetched: Vec<String> = server
            .received_requests()
            .await
            .expect("wiremock 默认记录请求")
            .iter()
            .map(|request| request.url.path().to_string())
            .collect();
        assert!(
            !fetched.iter().any(|path| path == "/admin/secret"),
            "被 robots 禁止的页面不得真的发出请求，实发：{fetched:?}"
        );
        // 双保险：即使将来抓取顺序变了，被禁页面的正文也不得混进结果
        assert!(
            !result
                .pages
                .iter()
                .any(|page| page.main_text.contains("ADMIN_CANARY_7b2e")),
            "被禁页面的 canary 不得出现在正文提取结果里"
        );
    }

    #[tokio::test]
    async fn http_error_is_skipped_and_does_not_abort_the_crawl() {
        let server = server_with_fixtures().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/broken.html"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let origin = Url::parse(&server.uri()).unwrap();
        let fetcher = fetcher(8);
        let request = CrawlRequest {
            origin: origin.clone(),
            seed_urls: vec![origin.clone(), origin.join("/broken.html").unwrap()],
        };

        let result = crawl_site(&fetcher, &request, &limits(8)).await;

        assert_eq!(result.page_count(), 5, "坏页不影响其余页面");
        let broken = result
            .skipped
            .iter()
            .find(|page| page.url.contains("/broken.html"))
            .unwrap_or_else(|| panic!("坏页应记入 skipped：{result:?}"));
        assert!(
            broken.reason.contains("500"),
            "reason 应含状态码：{}",
            broken.reason
        );
    }

    #[tokio::test]
    async fn max_pages_caps_the_crawl() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(2);
        let origin = Url::parse(&server.uri()).unwrap();

        let result = crawl_site(&fetcher, &CrawlRequest::new(origin), &limits(2)).await;

        assert!(result.page_count() <= 2, "不得超过 max_pages：{result:?}");
        assert!(result.page_count() >= 1, "至少要抓到首页");
    }

    #[tokio::test]
    async fn role_quota_lets_small_budgets_still_cover_distinct_roles() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(3);
        let origin = Url::parse(&server.uri()).unwrap();

        let result = crawl_site(&fetcher, &CrawlRequest::new(origin), &limits(3)).await;

        assert!(
            result.roles.len() >= 3,
            "3 页配额应覆盖 3 类不同角色，而不是同一角色的 3 个页面：{result:?}"
        );
    }

    #[tokio::test]
    async fn combined_text_puts_home_first_and_truncates() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(8);
        let origin = Url::parse(&server.uri()).unwrap();

        let result = crawl_site(&fetcher, &CrawlRequest::new(origin), &limits(8)).await;

        let full = result.combined_text(usize::MAX);
        assert!(!full.is_empty());
        let truncated = result.combined_text(200);
        assert_eq!(truncated.chars().count(), 200, "按字符截断，不能截半个汉字");

        let home = &result.urls_for(PageRole::Home)[0];
        let home_page = result
            .pages
            .iter()
            .find(|page| &page.url == home)
            .expect("首页在结果里");
        let head: String = home_page.main_text.chars().take(20).collect();
        assert!(full.contains(&head), "combined_text 必须包含首页正文");
    }

    #[tokio::test]
    async fn empty_seeds_fall_back_to_origin_root() {
        let server = server_with_fixtures().await;
        let fetcher = fetcher(8);
        let origin = Url::parse(&server.uri()).unwrap();

        let request = CrawlRequest {
            origin: origin.clone(),
            seed_urls: vec![],
        };
        let result = crawl_site(&fetcher, &request, &limits(8)).await;
        assert_eq!(
            result.urls_for(PageRole::Home).len(),
            1,
            "应从 origin 根开始"
        );
    }
}
