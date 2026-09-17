//! 编码探测与正文提取。
//!
//! 处理链路：`RawPage` 原始字节 → 字符集探测 → 解码 → `scraper` 解析 DOM →
//! 剔除样板子树（`script`/`style`/`nav`/`footer`…）→ `html2text` 转纯文本 → 空白归一化。
//! 链接收集独立于样板剔除：导航区的链接对企业站尤其重要，因此从整篇文档收集同域绝对链接。

use std::collections::HashSet;
use std::ops::Deref;
use std::sync::LazyLock;

use encoding_rs::Encoding;
use scraper::{ElementRef, Html, Node, Selector};
use url::Url;

use crate::error::CrawlerError;

/// 抓取到的原始页面（未解码的字节 + 响应元信息）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPage {
    /// 最终 URL（跟随重定向后的地址），字符串形式。
    pub url: String,
    /// 响应体原始字节，由 [`detect_charset`] 决定如何解码。
    pub bytes: Vec<u8>,
    /// 响应头 `Content-Type` 的完整值（如 `text/html; charset=gbk`）。
    pub content_type: Option<String>,
    /// HTTP 状态码。
    pub status: u16,
}

/// 从页面提取出的结构化内容，是后续 LLM 抽取的输入。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExtractedPage {
    /// 页面 URL。
    pub url: String,
    /// `<title>`，缺失时回退到首个 `<h1>`，仍缺失则为空串。
    pub title: String,
    /// 剔除样板后的正文纯文本，段落之间以换行分隔。
    pub main_text: String,
    /// 同域绝对链接，已去重并保持文档顺序。
    pub links: Vec<String>,
    /// `main_text` 的字符数（按 `char` 计，不是字节数）。
    pub char_count: usize,
}

/// 字符集探测扫描的字节数上限：`<meta>` 声明按规范必须在文档前部。
const CHARSET_SCAN_BYTES: usize = 4096;

/// `html2text` 的换行宽度。取足够大的值，避免中文句子被硬换行切断，
/// 从而保证正文里的整句可以直接被下游检索与喂给 LLM。
const TEXT_WIDTH: usize = 4096;

/// DOM 序列化的最大深度：抓的是不可信内容，超深嵌套（多为异常页面）直接截断，
/// 避免递归栈溢出。正常企业站的嵌套深度远小于该值。
const MAX_DEPTH: usize = 128;

/// 正文提取时整棵丢弃的标签：脚本、样式与页面样板区。
const DROPPED_TAGS: [&str; 9] = [
    "script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg",
];

/// HTML 空元素：序列化时不写闭合标签。
const VOID_TAGS: [&str; 14] = [
    "area", "base", "br", "col", "embed", "hr", "img", "link", "meta", "param", "source", "track",
    "wbr", "input",
];

/// 序列化时保留的属性：只保留影响文本渲染的部分，`href` 等一律不写进正文，
/// 避免链接地址污染 LLM 输入（链接由 [`ExtractedPage::links`] 单独承载）。
const KEPT_ATTRIBUTES: [&str; 4] = ["alt", "title", "colspan", "rowspan"];

static BODY_SELECTOR: LazyLock<Selector> = LazyLock::new(|| selector("body"));
static TITLE_SELECTOR: LazyLock<Selector> = LazyLock::new(|| selector("title"));
static H1_SELECTOR: LazyLock<Selector> = LazyLock::new(|| selector("h1"));
static LINK_SELECTOR: LazyLock<Selector> = LazyLock::new(|| selector("a[href]"));

/// 解析内置选择器。选择器都是编译期常量，非法即属开发错误。
fn selector(raw: &str) -> Selector {
    Selector::parse(raw).unwrap_or_else(|error| panic!("内置选择器 {raw} 非法：{error}"))
}

/// 探测页面字符集，优先级：
///
/// 1. HTTP 响应头 `Content-Type` 的 `charset` 参数；
/// 2. 前 [`CHARSET_SCAN_BYTES`] 字节里的 `<meta charset>` 或
///    `<meta http-equiv="Content-Type" content="...; charset=...">`（按 ASCII 有损扫描）；
/// 3. 严格 UTF-8 解码成功 → UTF-8；
/// 4. 兜底 GBK（国内中小企业老站的主要编码）。
pub fn detect_charset(content_type: Option<&str>, bytes: &[u8]) -> &'static Encoding {
    if let Some(encoding) = content_type.and_then(charset_in_text) {
        return encoding;
    }
    let head = &bytes[..bytes.len().min(CHARSET_SCAN_BYTES)];
    if let Some(encoding) = charset_in_text(&String::from_utf8_lossy(head)) {
        return encoding;
    }
    if std::str::from_utf8(bytes).is_ok() {
        return encoding_rs::UTF_8;
    }
    encoding_rs::GBK
}

/// 按探测到的编码解码字节，并剥掉可能存在的 UTF-8 BOM。
///
/// 参数是 `&'static Encoding`：`encoding_rs` 的解码与 `name()` 方法都要求 `'static`
/// 接收者（所有编码实例本身都是静态常量），[`detect_charset`] 的返回值可直接传入。
pub fn decode(bytes: &[u8], encoding: &'static Encoding) -> String {
    // 解码失败时 `encoding_rs` 会用 U+FFFD 替换，这里不中断：能读出多少算多少。
    let (text, _had_errors) = encoding.decode_without_bom_handling(bytes);
    text.strip_prefix('\u{feff}').unwrap_or(&text).to_string()
}

/// 从响应头或 HTML 头部文本中解析 `charset=` 标签。
fn charset_in_text(text: &str) -> Option<&'static Encoding> {
    let label = charset_label(text)?;
    Encoding::for_label(label.as_bytes())
}

/// 取出 `charset=` 之后的编码标签（兼容带引号/不带引号/大小写混写）。
fn charset_label(text: &str) -> Option<String> {
    // `to_ascii_lowercase` 只改 ASCII 字节，长度与偏移保持一致，可安全回索引原文。
    let position = text.to_ascii_lowercase().find("charset")?;
    let rest = &text[position + "charset".len()..];
    let rest = rest.trim_start();
    let rest = rest
        .strip_prefix('=')
        .unwrap_or(rest)
        .trim_start_matches(' ');
    let rest = rest.trim_start_matches(['"', '\'']);
    let label: String = rest
        .chars()
        .take_while(|ch| !matches!(ch, '"' | '\'' | ';' | '>' | '<' | '/' | '=' | ','))
        .take_while(|ch| !ch.is_whitespace())
        .collect();
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

/// 提取标题、正文与同域链接。`raw.url` 无法解析时返回 [`CrawlerError::InvalidUrl`]。
pub fn extract(raw: &RawPage) -> Result<ExtractedPage, CrawlerError> {
    let base = Url::parse(&raw.url)
        .map_err(|error| CrawlerError::InvalidUrl(format!("{}（{error}）", raw.url)))?;
    let encoding = detect_charset(raw.content_type.as_deref(), &raw.bytes);
    let html = decode(&raw.bytes, encoding);
    let document = Html::parse_document(&html);
    let main_text = normalize_text(&body_to_text(&document)?);
    Ok(ExtractedPage {
        url: raw.url.clone(),
        title: find_title(&document),
        links: collect_links(&document, &base),
        char_count: main_text.chars().count(),
        main_text,
    })
}

/// 取 `<title>`；为空则回退到首个 `<h1>`；都没有则为空串。
fn find_title(document: &Html) -> String {
    let first_text = |selector: &Selector| {
        document
            .select(selector)
            .next()
            .map(|element| collapse_spaces(&element.text().collect::<String>()))
            .filter(|text| !text.is_empty())
    };
    first_text(&TITLE_SELECTOR)
        .or_else(|| first_text(&H1_SELECTOR))
        .unwrap_or_default()
}

/// 把 `<body>` 剔除样板子树后重新序列化，再交给 `html2text` 转纯文本。
fn body_to_text(document: &Html) -> Result<String, CrawlerError> {
    let body = document
        .select(&BODY_SELECTOR)
        .next()
        .unwrap_or_else(|| document.root_element());
    let mut pruned = String::new();
    serialize_pruned(body, &mut pruned, 0);
    html2text::from_read(pruned.as_bytes(), TEXT_WIDTH)
        .map_err(|error| CrawlerError::Decode(error.to_string()))
}

/// 深度优先序列化 DOM，跳过 [`DROPPED_TAGS`] 的整棵子树。
/// 用显式深度上限而非无限递归：抓取内容不可信，超深嵌套页面不得让进程崩溃。
fn serialize_pruned(node: ElementRef<'_>, out: &mut String, depth: usize) {
    if depth >= MAX_DEPTH {
        tracing::debug!("DOM 嵌套超过 {MAX_DEPTH} 层，截断更深层内容");
        return;
    }
    for child in node.children() {
        match child.value() {
            Node::Text(text) => out.push_str(text.deref()),
            Node::Element(element) => {
                let name = element.name();
                if DROPPED_TAGS.contains(&name) {
                    continue;
                }
                let Some(element_ref) = ElementRef::wrap(child) else {
                    continue;
                };
                write_open_tag(element_ref, out);
                if VOID_TAGS.contains(&name) {
                    continue;
                }
                serialize_pruned(element_ref, out, depth + 1);
                out.push_str("</");
                out.push_str(name);
                out.push('>');
            }
            // 注释、doctype、处理指令对正文没有贡献。
            _ => {}
        }
    }
}

/// 写开始标签，只保留 [`KEPT_ATTRIBUTES`] 中影响文本渲染的属性。
fn write_open_tag(element: ElementRef<'_>, out: &mut String) {
    out.push('<');
    out.push_str(element.value().name());
    for name in KEPT_ATTRIBUTES {
        if let Some(value) = element.attr(name) {
            out.push(' ');
            out.push_str(name);
            out.push_str("=\"");
            out.push_str(&escape_attribute(value));
            out.push('"');
        }
    }
    out.push('>');
}

/// 属性值转义，防止把标签结构重新注入序列化结果。
fn escape_attribute(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// 收集同域绝对链接：相对地址按页面 URL 解析，丢弃非 http(s)、跨域与空链接，
/// 去掉片段与空查询串后按文档顺序去重（`/a.html#x` 与 `/a.html` 视为同一页）。
fn collect_links(document: &Html, base: &Url) -> Vec<String> {
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    for element in document.select(&LINK_SELECTOR) {
        let Some(href) = element
            .attr("href")
            .map(str::trim)
            .filter(|h| !h.is_empty())
        else {
            continue;
        };
        let Ok(joined) = base.join(href) else {
            continue;
        };
        if !matches!(joined.scheme(), "http" | "https") || joined.origin() != base.origin() {
            continue;
        }
        let normalized = normalize_link(joined).to_string();
        if seen.insert(normalized.clone()) {
            links.push(normalized);
        }
    }
    links
}

/// 归一化链接：去掉片段，空查询串一并去掉，便于跨页面去重。
fn normalize_link(mut url: Url) -> Url {
    url.set_fragment(None);
    if url.query() == Some("") {
        url.set_query(None);
    }
    url
}

/// 空白归一化：统一换行符、折叠空白串、丢弃空行，段落之间保留单个换行。
fn normalize_text(text: &str) -> String {
    text.replace('\r', "\n")
        .lines()
        .map(collapse_spaces)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 折叠一行内的连续空白为单个空格并去掉首尾空白。
fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{fixture_bytes, raw_page};

    const SITE_URL: &str = "https://www.hongyu-pump.example/";
    const GBK_URL: &str = "https://www.hongyu-pump.example/gbk-page.html";

    fn page_from_html(url: &str, html: &str) -> RawPage {
        RawPage {
            url: url.to_string(),
            bytes: html.as_bytes().to_vec(),
            content_type: Some("text/html; charset=utf-8".to_string()),
            status: 200,
        }
    }

    #[test]
    fn utf8_fixture_page_yields_chinese_title_and_body() {
        let raw = raw_page("index.html", SITE_URL, Some("text/html; charset=utf-8"));
        let page = extract(&raw).expect("UTF-8 首页应能提取");

        assert!(page.title.contains("宏宇泵业"), "实际标题：{}", page.title);
        assert!(page.main_text.contains("上海宏宇水泵制造有限公司"));
        assert!(page.main_text.contains("2006"));
        assert!(page.main_text.contains("自有水力性能测试台"));
        assert!(page.main_text.contains("26 个省级行政区"));
        assert!(page.main_text.contains("某市政污水处理厂二期扩容"));
        assert_eq!(page.url, SITE_URL);
        assert_eq!(page.char_count, page.main_text.chars().count());
        assert!(page.char_count > 200, "首页正文过短：{}", page.char_count);
    }

    #[test]
    fn charset_prefers_http_header_over_meta_and_bytes() {
        let utf8_bytes = b"<html><head><meta charset=\"utf-8\"></head><body>zh</body></html>";
        assert_eq!(
            detect_charset(Some("text/html; charset=gbk"), utf8_bytes).name(),
            "GBK"
        );
        assert_eq!(
            detect_charset(Some("TEXT/HTML; CHARSET=GB2312"), utf8_bytes).name(),
            "GBK",
            "指令大小写与 gb2312 标签都应被识别"
        );
        // 未知标签忽略后继续走后续优先级。
        assert_eq!(
            detect_charset(Some("text/html; charset=unknown-xyz"), "中文".as_bytes()).name(),
            "UTF-8"
        );
        assert_eq!(
            detect_charset(Some("text/html"), "中文".as_bytes()).name(),
            "UTF-8"
        );
    }

    #[test]
    fn charset_falls_back_to_meta_then_utf8_then_gbk() {
        let meta_charset = b"<html><head><meta charset=\"gbk\"></head><body>zh</body></html>";
        assert_eq!(detect_charset(None, meta_charset).name(), "GBK");

        let http_equiv =
            b"<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=gbk\"></head>";
        assert_eq!(detect_charset(None, http_equiv).name(), "GBK");

        assert_eq!(detect_charset(None, "中文内容".as_bytes()).name(), "UTF-8");

        let (gbk_bytes, _, _) = encoding_rs::GBK.encode("中文内容");
        assert_eq!(detect_charset(None, &gbk_bytes).name(), "GBK");
    }

    #[test]
    fn charset_meta_scan_is_limited_to_first_4096_bytes() {
        let mut bytes = b"<html><body>".to_vec();
        bytes.extend(std::iter::repeat_n(b' ', 5000));
        bytes.extend_from_slice("<meta charset=\"gbk\">正文".as_bytes());

        assert_eq!(
            detect_charset(None, &bytes).name(),
            "UTF-8",
            "4096 字节之后的声明不应参与探测"
        );
    }

    #[test]
    fn gbk_fixture_on_disk_is_not_valid_utf8_and_decodes_cleanly() {
        let bytes = fixture_bytes("gbk-page.html");
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "夹具必须是真正的 GBK 字节，不能是 UTF-8"
        );

        let encoding = detect_charset(None, &bytes);
        assert_eq!(encoding.name(), "GBK", "无 HTTP 头时应从 meta 探测到 GBK");

        let text = decode(&bytes, encoding);
        assert!(text.contains("技术公告与服务承诺"));
        assert!(text.contains("报修后 4 小时内响应"));
        assert!(text.contains('℃'));
        assert!(!text.contains('\u{FFFD}'), "不应出现乱码替换符");
    }

    #[test]
    fn gbk_page_with_charset_header_extracts_clean_chinese() {
        let raw = raw_page("gbk-page.html", GBK_URL, Some("text/html; charset=gbk"));
        let page = extract(&raw).expect("GBK 页应能提取");

        assert!(page.title.contains("技术公告"), "实际标题：{}", page.title);
        assert!(page.main_text.contains("机械密封泄漏量超过每分钟 5 滴"));
        assert!(page.main_text.contains("《维护保养手册》"));
        assert!(!page.main_text.contains('\u{FFFD}'));
        assert_eq!(page.char_count, page.main_text.chars().count());
    }

    #[test]
    fn gbk_page_built_at_byte_level_round_trips() {
        let source = "宏宇泵业提供工业离心泵与潜水排污泵，并承接非标定制。";
        let (encoded, encoding, had_errors) = encoding_rs::GBK.encode(source);
        assert!(!had_errors);
        assert_eq!(encoding.name(), "GBK");
        assert!(
            std::str::from_utf8(&encoded).is_err(),
            "GBK 编码后的中文字节不应是合法 UTF-8"
        );
        assert_eq!(decode(&encoded, encoding_rs::GBK), source);

        // 字节级拼装整页：GBK 正文 + ASCII 标签。
        let mut bytes = b"<html><head><meta charset=\"gbk\"><title>".to_vec();
        bytes.extend_from_slice(&encoded);
        bytes.extend_from_slice(b"</title></head><body><p>".as_slice());
        bytes.extend_from_slice(&encoded);
        bytes.extend_from_slice(b"</p></body></html>".as_slice());

        let raw = RawPage {
            url: GBK_URL.to_string(),
            bytes,
            content_type: Some("text/html; charset=gbk".to_string()),
            status: 200,
        };
        let page = extract(&raw).expect("字节级构造的 GBK 页应能提取");
        assert_eq!(page.title, source);
        assert!(page.main_text.contains(source));
        assert!(!page.main_text.contains('\u{FFFD}'));
    }

    #[test]
    fn script_style_and_boilerplate_never_leak_into_main_text() {
        let raw = raw_page("index.html", SITE_URL, Some("text/html; charset=utf-8"));
        let page = extract(&raw).expect("提取失败");

        assert!(!page.main_text.contains("SCRIPT_CANARY_9f3a_must_not_leak"));
        assert!(!page.main_text.contains("CANARY_TOKEN_5c1d"));
        assert!(!page.main_text.contains("这段脚本注入的文字"));
        assert!(
            !page.main_text.contains("服务热线"),
            "header 样板文字应被丢弃"
        );
        assert!(
            !page.main_text.contains("沪ICP备06000000号"),
            "footer 应被丢弃"
        );
        assert!(!page.main_text.contains("<p>"));
        assert!(!page.main_text.contains("</ul>"));
        assert!(
            !page.main_text.contains("宏宇泵业 - 工业水泵制造商"),
            "title 不进正文"
        );
    }

    #[test]
    fn every_dropped_subtree_is_removed() {
        let html = r#"<html><body>
            <script>var x = "JS_CANARY";</script>
            <style>.a { color: red } /* CSS_CANARY */</style>
            <noscript>NOSCRIPT_CANARY</noscript>
            <header>HEADER_CANARY</header>
            <nav>NAV_CANARY</nav>
            <aside>ASIDE_CANARY</aside>
            <form>FORM_CANARY<input value="INPUT_CANARY"></form>
            <svg>SVG_CANARY</svg>
            <footer>FOOTER_CANARY</footer>
            <main><p>MAIN_TEXT 正文内容</p></main>
        </body></html>"#;
        let page = extract(&page_from_html("https://a.example/", html)).expect("提取失败");

        assert!(page.main_text.contains("MAIN_TEXT 正文内容"));
        for canary in [
            "JS_CANARY",
            "CSS_CANARY",
            "NOSCRIPT_CANARY",
            "HEADER_CANARY",
            "NAV_CANARY",
            "ASIDE_CANARY",
            "FORM_CANARY",
            "INPUT_CANARY",
            "SVG_CANARY",
            "FOOTER_CANARY",
        ] {
            assert!(!page.main_text.contains(canary), "{canary} 不应出现在正文");
        }
    }

    #[test]
    fn same_origin_links_are_collected_and_cross_origin_dropped() {
        let raw = raw_page("index.html", SITE_URL, Some("text/html; charset=utf-8"));
        let page = extract(&raw).expect("提取失败");

        for path in [
            "/about.html",
            "/products.html",
            "/faq.html",
            "/contact.html",
            "/admin/secret",
        ] {
            let expected = format!("https://www.hongyu-pump.example{path}");
            assert!(page.links.contains(&expected), "缺少同域链接 {expected}");
        }
        assert!(
            !page
                .links
                .iter()
                .any(|link| link.contains("example.com/partner")),
            "跨域链接必须被丢弃：{:?}",
            page.links
        );
        let about_count = page
            .links
            .iter()
            .filter(|link| link.ends_with("/about.html"))
            .count();
        assert_eq!(about_count, 1, "同域链接应去重且保持文档顺序");
    }

    #[test]
    fn links_inside_nav_are_collected_even_though_nav_text_is_dropped() {
        let html = r#"<html><body>
            <nav><a href="/only-in-nav.html">导航页</a></nav>
            <main><p>正文</p></main>
        </body></html>"#;
        let page = extract(&page_from_html("https://a.example/list", html)).expect("提取失败");

        assert_eq!(
            page.links,
            vec!["https://a.example/only-in-nav.html".to_string()]
        );
        assert!(!page.main_text.contains("导航页"));
        assert!(page.main_text.contains("正文"));
    }

    #[test]
    fn fragment_and_empty_query_duplicates_are_deduped_in_document_order() {
        let html = r#"<html><body>
            <a href="/p.html#sec1">A</a>
            <a href="/p.html">B</a>
            <a href="/p.html#sec2">C</a>
            <a href="/q.html?">D</a>
            <a href="/q.html">E</a>
            <a href="/r.html?size=3#top">F</a>
            <a href="/r.html?size=3">G</a>
        </body></html>"#;
        let page = extract(&page_from_html("https://a.example/x", html)).expect("提取失败");

        assert_eq!(
            page.links,
            vec![
                "https://a.example/p.html".to_string(),
                "https://a.example/q.html".to_string(),
                "https://a.example/r.html?size=3".to_string(),
            ]
        );
    }

    #[test]
    fn non_http_links_and_blank_hrefs_are_dropped() {
        let html = r#"<html><body>
            <a href="mailto:sales@hongyu-pump.example">邮件</a>
            <a href="tel:4008206688">电话</a>
            <a href="javascript:void(0)">脚本</a>
            <a href="">空</a>
            <a>无 href</a>
            <a href="  ">空白</a>
            <a href="products.html">相对路径</a>
        </body></html>"#;
        let page =
            extract(&page_from_html("https://a.example/dir/index.html", html)).expect("提取失败");

        assert_eq!(
            page.links,
            vec!["https://a.example/dir/products.html".to_string()]
        );
    }

    #[test]
    fn title_falls_back_to_h1_and_blank_title_is_ignored() {
        let no_title = extract(&page_from_html(
            "https://a.example/",
            "<html><body><h1>产品总览</h1><p>正文</p></body></html>",
        ))
        .expect("提取失败");
        assert_eq!(no_title.title, "产品总览");

        let blank_title = extract(&page_from_html(
            "https://a.example/",
            "<html><head><title>   </title></head><body><h1>  公司简介  </h1></body></html>",
        ))
        .expect("提取失败");
        assert_eq!(blank_title.title, "公司简介");

        let nothing = extract(&page_from_html(
            "https://a.example/",
            "<html><body><p>x</p></body></html>",
        ))
        .expect("提取失败");
        assert_eq!(nothing.title, "");
    }

    #[test]
    fn decode_strips_utf8_bom_and_keeps_chinese() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("宏宇泵业".as_bytes());
        assert_eq!(decode(&bytes, encoding_rs::UTF_8), "宏宇泵业");
    }

    #[test]
    fn char_count_is_measured_in_chars_not_bytes() {
        let page = extract(&page_from_html(
            "https://a.example/",
            "<html><body><p>中文abc</p></body></html>",
        ))
        .expect("提取失败");
        assert_eq!(page.main_text, "中文abc");
        assert_eq!(page.char_count, 5);
    }

    #[test]
    fn blank_runs_are_collapsed() {
        let page = extract(&page_from_html(
            "https://a.example/",
            "<html><body><p>   宏宇   泵业   </p>\n\n\n<p>第二段</p></body></html>",
        ))
        .expect("提取失败");
        assert_eq!(page.main_text, "宏宇 泵业\n第二段");
    }

    #[test]
    fn invalid_page_url_is_rejected() {
        let raw = RawPage {
            url: "not a url".to_string(),
            bytes: b"<html><body><p>x</p></body></html>".to_vec(),
            content_type: None,
            status: 200,
        };
        let error = extract(&raw).expect_err("非法 URL 应报错");
        assert!(matches!(error, CrawlerError::InvalidUrl(_)));
        assert_eq!(error.code(), "crawler/invalid_url");
        assert!(error.user_message().contains("not a url"));
    }
}
