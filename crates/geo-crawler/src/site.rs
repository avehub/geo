//! 站点抓取编排：robots 过滤 + 角色配额 BFS（同站限定）。
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

use crate::discover::{classify, discover_from_html, normalize, same_site, PageRole};
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

/// 被跳过的页面与原因（robots / 总超时 / 抓取失败）。
///
/// `reason` 是**稳定记号**，取值只有四种（裁定 §G-5 / R-C4）：
/// [`SKIP_TOTAL_TIMEOUT`] / [`SKIP_ROBOTS_DISALLOWED`] / [`SKIP_FETCH_FAILED`] /
/// [`SKIP_EMPTY_CONTENT`]。
/// 它最终经 `entity_card_service` 落进 `crawler/empty` 的 `skipped` 参数，
/// 而壳侧 `guard_instance_params_stay_ascii` **没有白名单**——params 的取值只能是
/// 语言中立数据或稳定记号，中文说明一律只进日志（AGENTS 规则 7）。
///
/// 代价是粒度变粗：抓取失败不再区分超时 / 5xx / 非 HTML（改造前由
/// [`CrawlerError::user_message`](crate::CrawlerError::user_message) 的紧凑串带出来）。
/// 细节没有丢，只是换到了它该在的地方——`crawl_site` 的 `tracing::debug!`
/// 已经把整个 `CrawlerError`（含 `status` / `url`）打进日志。
#[derive(Debug, Clone, PartialEq)]
pub struct SkippedPage {
    pub url: String,
    pub reason: String,
}

/// `SkippedPage::reason` 的四种取值。
///
/// 提成常量而不是各站点写字面量：这四个记号是 `crawler/empty` 的 `skipped` 参数
/// 与前端词典之间的契约，拼错一个字母不会有任何测试变红（漂移守卫比的是**键名**
/// 不是取值），与 `geo-llm` 把 reason key 收成常量的理由相同。
///
/// 总超时预算用尽（`FetchLimits::total_timeout`）。
pub const SKIP_TOTAL_TIMEOUT: &str = "total_timeout";
/// robots.txt 禁止抓取该路径。
pub const SKIP_ROBOTS_DISALLOWED: &str = "robots_disallowed";
/// 单页抓取或正文提取失败（超时 / 非 2xx / 超大 / 非 HTML / 解码失败）。
pub const SKIP_FETCH_FAILED: &str = "fetch_failed";
/// 页面抓取成功，但正文为空或过短（`<script>` 渲染壳、纯跳转页、反爬挑战页）。
///
/// 这类页面**不能**算成功：算进去会白占 `max_pages` 配额，还会让
/// `crawler/empty` 的「一页都没抓到」失效——用户看到的是「抓了 8 页」而实体卡全空。
pub const SKIP_EMPTY_CONTENT: &str = "empty_content";

/// 抓取结果：成功页面、角色索引与跳过明细。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CrawlResult {
    pub pages: Vec<ExtractedPage>,
    pub skipped: Vec<SkippedPage>,
    pub roles: HashMap<PageRole, Vec<String>>,
}

/// 客户端跳转（meta refresh / location.href）最多跟几跳，防止 a → b → a 循环。
const MAX_CLIENT_REDIRECTS: usize = 3;

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
    ///
    /// 预算分两轮分配：第一轮每页均分，避免一个 1.4 万字的首页把「关于 / 产品 / 联系」
    /// 全挤掉（真实站点 `www.ouhor.com` 的首页就是这种形态）；第二轮把短页面没用完的
    /// 额度按角色优先级回填。跨页重复的行（导航 / 页脚）只保留第一次出现。
    pub fn combined_text(&self, max_chars: usize) -> String {
        if max_chars == 0 {
            return String::new();
        }
        let pages: Vec<&crate::extract::ExtractedPage> = TEXT_PRIORITY
            .iter()
            .flat_map(|role| self.urls_for(*role))
            .filter_map(|url| self.pages.iter().find(|page| page.url == url))
            .collect();
        if pages.is_empty() {
            return String::new();
        }

        let lines: Vec<Vec<&str>> = pages
            .iter()
            .map(|page| page.main_text.lines().collect())
            .collect();
        let mut cursors = vec![0usize; lines.len()];
        let mut seen_lines: HashSet<String> = HashSet::new();
        let mut combined = String::new();

        // 第一轮：每页均分预算。
        let fair_share = max_chars / pages.len();
        for (page_lines, cursor) in lines.iter().zip(cursors.iter_mut()) {
            append_lines(
                page_lines,
                cursor,
                fair_share,
                &mut combined,
                &mut seen_lines,
            );
        }
        // 第二轮：短页面没用完的额度，按角色优先级回填。
        for (page_lines, cursor) in lines.iter().zip(cursors.iter_mut()) {
            let remaining = max_chars.saturating_sub(combined.chars().count());
            if remaining == 0 {
                break;
            }
            append_lines(
                page_lines,
                cursor,
                remaining,
                &mut combined,
                &mut seen_lines,
            );
        }
        combined
    }
}

/// 从一页的剩余行里追加正文，最多占用 `budget` 个字符（含换行分隔符）。
///
/// 整行放不下时按字符截断最后一行，保持 `combined_text`「最多 max_chars」的旧契约；
/// 空行与跨页重复行跳过。返回本次实际追加的字符数。
fn append_lines(
    lines: &[&str],
    cursor: &mut usize,
    budget: usize,
    out: &mut String,
    seen: &mut HashSet<String>,
) -> usize {
    let mut used = 0usize;
    while *cursor < lines.len() {
        let line = lines[*cursor];
        if line.is_empty() {
            *cursor += 1;
            continue;
        }
        if seen.contains(line) {
            *cursor += 1;
            continue;
        }
        let separator = usize::from(!out.is_empty());
        let cost = separator + line.chars().count();
        if used + cost <= budget {
            *cursor += 1;
            seen.insert(line.to_string());
            if separator == 1 {
                out.push('\n');
            }
            out.push_str(line);
            used += cost;
            continue;
        }
        let remaining = budget.saturating_sub(used);
        if remaining > separator {
            *cursor += 1;
            seen.insert(line.to_string());
            if separator == 1 {
                out.push('\n');
            }
            let keep = remaining - separator;
            let truncated: String = line.chars().take(keep).collect();
            out.push_str(&truncated);
            used += separator + truncated.chars().count();
        }
        break;
    }
    used
}

/// 抓取整个站点（同站、受限、robots 合规）。
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
    // 最终地址去重（302 / 客户端跳转的落点可能与已抓页面相同）。
    let mut fetched_final: HashSet<String> = HashSet::new();
    while result.pages.len() < limits.max_pages {
        if Instant::now() >= deadline {
            tracing::debug!(
                budget = ?limits.total_timeout,
                pages = result.pages.len(),
                "已达总超时上限，提前结束抓取"
            );
            result.skipped.push(SkippedPage {
                url: request.origin.to_string(),
                reason: SKIP_TOTAL_TIMEOUT.to_string(),
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

        let mut target = url;
        let mut hops = 0usize;
        loop {
            if Instant::now() >= deadline {
                tracing::debug!(url = %target, "跟随跳转时达到总超时上限");
                result.skipped.push(SkippedPage {
                    url: request.origin.to_string(),
                    reason: SKIP_TOTAL_TIMEOUT.to_string(),
                });
                break;
            }
            if !robots.is_allowed(target.path()) {
                tracing::debug!(url = %target, "robots.txt 禁止抓取");
                result.skipped.push(SkippedPage {
                    url: target.to_string(),
                    reason: SKIP_ROBOTS_DISALLOWED.to_string(),
                });
                break;
            }

            match fetch_and_extract(fetcher, &target).await {
                Ok(page) if page.char_count >= crate::extract::MIN_USABLE_TEXT_CHARS => {
                    // 302 也是不可信输入：跳到另一个注册域的响应不能当成本站内容
                    // （同时挡住跳去内网地址的 SSRF 面）。
                    let final_url = match Url::parse(&page.url) {
                        Ok(final_url) if same_site(&final_url, &request.origin) => final_url,
                        _ => {
                            tracing::debug!(from = %target, to = %page.url, "HTTP 跳转落到站外，拒收");
                            result.skipped.push(SkippedPage {
                                url: page.url.clone(),
                                reason: SKIP_FETCH_FAILED.to_string(),
                            });
                            break;
                        }
                    };
                    // 302 / 客户端跳转都可能让不同 URL 落到同一页面：按最终地址去重，
                    // 否则同一页会重复占配额、正文也会在拼接时重复。
                    if !fetched_final.insert(page.url.clone()) {
                        tracing::debug!(url = %page.url, "最终地址与已抓页面重复，不重复计入");
                        break;
                    }
                    for link in discover_from_html(&page, &request.origin) {
                        enqueue(&mut queue, &mut seen, link, &request.origin);
                    }
                    let role = classify(&final_url, &page.title);
                    covered.insert(role);
                    result.roles.entry(role).or_default().push(page.url.clone());
                    result.pages.push(page);
                    break;
                }
                Ok(page) => {
                    // HTTP 200 但正文为空：先看是不是客户端跳转壳页，是就跟过去。
                    if hops < MAX_CLIENT_REDIRECTS {
                        let next = page
                            .client_redirect
                            .as_deref()
                            .and_then(|raw| Url::parse(raw).ok())
                            .and_then(|next| normalize(&next, &request.origin));
                        if let Some(next) = next {
                            tracing::debug!(from = %target, to = %next, "跟随客户端跳转");
                            target = next;
                            hops += 1;
                            continue;
                        }
                    }
                    tracing::debug!(
                        url = %target,
                        chars = page.char_count,
                        "正文为空或过短，跳过该页（不占配额）"
                    );
                    result.skipped.push(SkippedPage {
                        url: target.to_string(),
                        reason: SKIP_EMPTY_CONTENT.to_string(),
                    });
                    break;
                }
                Err(error) => {
                    tracing::debug!(url = %target, error = %error, "页面抓取失败，跳过");
                    result.skipped.push(SkippedPage {
                        url: target.to_string(),
                        reason: SKIP_FETCH_FAILED.to_string(),
                    });
                    break;
                }
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
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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
        assert_eq!(
            blocked.reason, SKIP_ROBOTS_DISALLOWED,
            "reason 必须是稳定记号（裁定 §G-5），不得是中文说明"
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
        // 裁定 §G-5：`reason` 统一成稳定记号，状态码这类细节留在 `tracing::debug!`
        // （那里打的是整个 `CrawlerError`，含 `status` 与 `url`），不进 params。
        assert_eq!(
            broken.reason, SKIP_FETCH_FAILED,
            "reason 必须是稳定记号，不得是紧凑日志串：{}",
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

    /// 真实站点（ouhor.com）实测：分类页返回 200 + 一行 `window.location`，正文为空。
    /// 这类壳页必须跟随到真实页面，而不是作为一个「成功但 0 字」的页面占掉配额。
    const CONTENT: &str =
        "上海宏宇水泵制造有限公司成立于2006年，专注工业离心泵与潜水排污泵的研发、生产与销售，服务全国二十六个省级行政区。";

    async fn mount_page(server: &MockServer, route: &str, html: &str) {
        Mock::given(method("GET"))
            .and(path(route))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(html.as_bytes().to_vec(), "text/html; charset=utf-8"),
            )
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn js_redirect_stub_is_followed_instead_of_counting_an_empty_page() {
        let server = MockServer::start().await;
        mount_page(
            &server,
            "/",
            "<html><body><script>window.location.href='/about.html';</script></body></html>",
        )
        .await;
        mount_page(
            &server,
            "/about.html",
            &format!("<html><body><main><p>{CONTENT}</p></main><a href='/contact.html'>联系</a></body></html>"),
        )
        .await;
        mount_page(
            &server,
            "/contact.html",
            &format!("<html><body><main><p>{CONTENT}</p></main></body></html>"),
        )
        .await;

        let origin = Url::parse(&server.uri()).unwrap();
        let result = crawl_site(&fetcher(3), &CrawlRequest::new(origin.clone()), &limits(3)).await;

        assert!(
            result
                .pages
                .iter()
                .all(|page| page.char_count >= crate::extract::MIN_USABLE_TEXT_CHARS),
            "不得把 0 字壳页记成成功页面：{result:?}"
        );
        assert!(
            result
                .pages
                .iter()
                .any(|page| page.url.ends_with("/about.html")),
            "应跟随跳转抓到真实页面：{result:?}"
        );
        assert!(
            result.skipped.is_empty(),
            "跟随跳转不应记成跳过：{result:?}"
        );
        assert_eq!(result.page_count(), 2, "壳页不占配额：{result:?}");
    }

    #[tokio::test]
    async fn blank_page_is_skipped_and_does_not_consume_the_page_budget() {
        let server = MockServer::start().await;
        mount_page(
            &server,
            "/",
            &format!("<html><body><a href='/blank.html'>空白</a><a href='/about.html'>关于</a><p>{CONTENT}</p></body></html>"),
        )
        .await;
        mount_page(
            &server,
            "/blank.html",
            "<html><body><div id='app'></div></body></html>",
        )
        .await;
        mount_page(
            &server,
            "/about.html",
            &format!("<html><body><main><p>{CONTENT}</p></main></body></html>"),
        )
        .await;

        let origin = Url::parse(&server.uri()).unwrap();
        let result = crawl_site(&fetcher(2), &CrawlRequest::new(origin), &limits(2)).await;

        assert_eq!(result.page_count(), 2, "空白页不得占掉配额：{result:?}");
        assert!(result
            .pages
            .iter()
            .any(|page| page.url.ends_with("/about.html")));
        let blank = result
            .skipped
            .iter()
            .find(|page| page.url.ends_with("/blank.html"))
            .unwrap_or_else(|| panic!("空白页应记入 skipped：{result:?}"));
        assert_eq!(blank.reason, SKIP_EMPTY_CONTENT);
    }

    /// 首页 302 到 `/home.html` 后，页面里又链回 `/home.html`：同一最终地址只能算一页。
    #[tokio::test]
    async fn redirect_collisions_do_not_duplicate_pages() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", "/home.html"))
            .mount(&server)
            .await;
        mount_page(
            &server,
            "/home.html",
            &format!(
                "<html><body><a href='/home.html'>自己</a><a href='/about.html'>关于</a><p>{CONTENT}</p></body></html>"
            ),
        )
        .await;
        mount_page(
            &server,
            "/about.html",
            &format!("<html><body><main><p>{CONTENT}</p></main></body></html>"),
        )
        .await;

        let origin = Url::parse(&server.uri()).unwrap();
        let result = crawl_site(&fetcher(3), &CrawlRequest::new(origin), &limits(3)).await;

        assert_eq!(result.page_count(), 2, "重定向落点不得重复计入：{result:?}");
        let home_hits = result
            .pages
            .iter()
            .filter(|page| page.url.ends_with("/home.html"))
            .count();
        assert_eq!(home_hits, 1, "同一最终地址只应出现一次：{result:?}");
    }

    /// 302 跳到另一个注册域（或内网）时不能把目标内容当成本站页面。
    #[tokio::test]
    async fn cross_site_http_redirect_is_rejected() {
        let server = MockServer::start().await;
        let port = Url::parse(&server.uri()).unwrap().port().unwrap();
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", format!("http://localhost:{port}/other")),
            )
            .mount(&server)
            .await;
        mount_page(
            &server,
            "/other",
            &format!("<html><body><main><p>{CONTENT}</p></main></body></html>"),
        )
        .await;

        let origin = Url::parse(&server.uri()).unwrap();
        let result = crawl_site(&fetcher(1), &CrawlRequest::new(origin), &limits(1)).await;

        assert_eq!(result.page_count(), 0, "站外落点不得计入：{result:?}");
        assert!(
            result
                .skipped
                .iter()
                .any(|page| page.reason == SKIP_FETCH_FAILED),
            "站外跳转应记 fetch_failed：{result:?}"
        );
    }

    /// 超大首页不能把「关于 / 产品 / 联系」的预算全吃掉。
    #[test]
    fn combined_text_gives_every_page_a_share() {
        let mut result = CrawlResult::default();
        let page = |url: &str, text: &str| crate::extract::ExtractedPage {
            url: url.to_string(),
            title: String::new(),
            main_text: text.to_string(),
            links: Vec::new(),
            char_count: text.chars().count(),
            client_redirect: None,
        };
        let home_text = "首页正文".repeat(2_000);
        result.pages = vec![
            page("https://a.example/", &home_text),
            page("https://a.example/about.html", "关于我们"),
            page("https://a.example/contact.html", "联系电话 400-820-6688"),
        ];
        result
            .roles
            .insert(PageRole::Home, vec!["https://a.example/".to_string()]);
        result.roles.insert(
            PageRole::About,
            vec!["https://a.example/about.html".to_string()],
        );
        result.roles.insert(
            PageRole::Contact,
            vec!["https://a.example/contact.html".to_string()],
        );

        let text = result.combined_text(300);
        assert!(text.contains("关于我们"), "关于页被首页挤掉了：{text}");
        assert!(
            text.contains("联系电话 400-820-6688"),
            "联系页被首页挤掉了：{text}"
        );
        assert!(text.chars().count() <= 300, "不得超过预算：{text:?}");
    }

    /// 每个页面都重复同一段导航时，拼接语料不应把预算耗在重复行上。
    #[test]
    fn combined_text_drops_lines_repeated_across_pages() {
        let mut result = CrawlResult::default();
        let page = |url: &str, text: &str| crate::extract::ExtractedPage {
            url: url.to_string(),
            title: String::new(),
            main_text: text.to_string(),
            links: Vec::new(),
            char_count: text.chars().count(),
            client_redirect: None,
        };
        result.pages = vec![
            page("https://a.example/", "首页\n产品\n共同行"),
            page("https://a.example/about.html", "首页\n关于我们\n共同行"),
        ];
        result
            .roles
            .insert(PageRole::Home, vec!["https://a.example/".to_string()]);
        result.roles.insert(
            PageRole::About,
            vec!["https://a.example/about.html".to_string()],
        );

        assert_eq!(
            result.combined_text(usize::MAX),
            "首页\n产品\n共同行\n关于我们"
        );
    }
}
