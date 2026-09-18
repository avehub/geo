//! 页面角色分类与同域链接发现。
//!
//! 角色分类只做「够用的启发式」：URL 关键词优先，标题关键词兜底。
//! 之所以不引入更重的分类器，是因为下游只按角色分配抓取配额与拼接 LLM 输入，
//! 分错一页的代价只是少一段语料，不值得为它增加不确定性。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::extract::ExtractedPage;

/// 页面角色。序列化值即前端契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageRole {
    Home,
    About,
    Product,
    Faq,
    Contact,
    Other,
}

impl PageRole {
    pub fn all() -> [Self; 6] {
        [
            Self::Home,
            Self::About,
            Self::Product,
            Self::Faq,
            Self::Contact,
            Self::Other,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::About => "about",
            Self::Product => "product",
            Self::Faq => "faq",
            Self::Contact => "contact",
            Self::Other => "other",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Self::all().into_iter().find(|role| role.as_str() == raw)
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::Home => "首页",
            Self::About => "关于我们",
            Self::Product => "产品与服务",
            Self::Faq => "常见问题",
            Self::Contact => "联系我们",
            Self::Other => "其他页面",
        }
    }
}

/// 关键词表，**按匹配优先级排列**：越具体的角色越靠前。
///
/// 顺序即裁决规则——`/services-contact.html` 判为「联系我们」而不是「产品」，
/// 因为联系方式页对实体卡的贡献更直接。
const KEYWORDS: [(PageRole, &[&str]); 4] = [
    (PageRole::Faq, &["faq", "常见问题", "问答"]),
    (PageRole::Contact, &["contact", "联系"]),
    (
        PageRole::About,
        &["about", "company", "关于", "公司简介", "企业简介"],
    ),
    (
        PageRole::Product,
        &["product", "service", "solution", "产品", "服务", "解决方案"],
    ),
];

/// 判定页面角色：根路径 → 首页；否则 URL 关键词优先，标题关键词兜底。
pub fn classify(url: &Url, title: &str) -> PageRole {
    let path = url.path().to_lowercase();
    if path == "/" || path.is_empty() {
        return PageRole::Home;
    }
    if let Some(role) = match_keywords(&path) {
        return role;
    }
    let title = title.trim();
    if !title.is_empty() {
        if let Some(role) = match_keywords(&title.to_lowercase()) {
            return role;
        }
    }
    PageRole::Other
}

fn match_keywords(haystack: &str) -> Option<PageRole> {
    KEYWORDS
        .iter()
        .find(|(_, keywords)| keywords.iter().any(|word| haystack.contains(word)))
        .map(|(role, _)| *role)
}

/// 归一化并做同域校验：非 http(s)、跨域一律返回 `None`。
///
/// 去片段、去空查询串，保证同一页面的不同链接写法只抓一次。
pub fn normalize(url: &Url, origin: &Url) -> Option<Url> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if url.origin() != origin.origin() {
        return None;
    }
    let mut normalized = url.clone();
    normalized.set_fragment(None);
    if normalized.query() == Some("") {
        normalized.set_query(None);
    }
    Some(normalized)
}

/// 从已提取页面里取出可继续爬的同域链接（绝对化、去重、保持文档顺序）。
pub fn discover_from_html(page: &ExtractedPage, origin: &Url) -> Vec<Url> {
    let mut discovered = Vec::new();
    let mut seen = HashSet::new();
    for link in &page.links {
        let Ok(parsed) = Url::parse(link) else {
            continue;
        };
        let Some(normalized) = normalize(&parsed, origin) else {
            continue;
        };
        if seen.insert(normalized.to_string()) {
            discovered.push(normalized);
        }
    }
    discovered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract, RawPage};

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("测试用 URL 必须合法")
    }

    #[test]
    fn root_path_is_home() {
        assert_eq!(classify(&url("https://a.example/"), ""), PageRole::Home);
        assert_eq!(classify(&url("https://a.example"), ""), PageRole::Home);
    }

    #[test]
    fn english_url_keywords_map_to_roles() {
        assert_eq!(
            classify(&url("https://a.example/about.html"), ""),
            PageRole::About
        );
        assert_eq!(
            classify(&url("https://a.example/company"), ""),
            PageRole::About
        );
        assert_eq!(
            classify(&url("https://a.example/products.html"), ""),
            PageRole::Product
        );
        assert_eq!(
            classify(&url("https://a.example/service"), ""),
            PageRole::Product
        );
        assert_eq!(
            classify(&url("https://a.example/faq.html"), ""),
            PageRole::Faq
        );
        assert_eq!(
            classify(&url("https://a.example/contact.html"), ""),
            PageRole::Contact
        );
        assert_eq!(
            classify(&url("https://a.example/news/1"), ""),
            PageRole::Other
        );
    }

    #[test]
    fn chinese_title_keywords_are_used_when_url_gives_no_hint() {
        assert_eq!(
            classify(&url("https://a.example/p/1"), "关于我们"),
            PageRole::About
        );
        assert_eq!(
            classify(&url("https://a.example/p/2"), "公司简介 - 宏宇泵业"),
            PageRole::About
        );
        assert_eq!(
            classify(&url("https://a.example/p/3"), "产品中心"),
            PageRole::Product
        );
        assert_eq!(
            classify(&url("https://a.example/p/4"), "常见问题"),
            PageRole::Faq
        );
        assert_eq!(
            classify(&url("https://a.example/p/5"), "联系我们"),
            PageRole::Contact
        );
    }

    #[test]
    fn url_keyword_wins_over_title_keyword() {
        // URL 已经说明是 contact，就别被标题里的「产品」带跑
        assert_eq!(
            classify(&url("https://a.example/contact"), "产品咨询"),
            PageRole::Contact
        );
    }

    #[test]
    fn role_serde_is_snake_case_and_roundtrips() {
        for role in PageRole::all() {
            let raw = serde_json::to_string(&role).expect("枚举可序列化");
            assert_eq!(raw, format!(r#""{}""#, role.as_str()));
            assert_eq!(PageRole::parse(role.as_str()), Some(role));
            assert!(!role.label_zh().is_empty());
        }
        assert_eq!(PageRole::parse("不存在的角色"), None);
    }

    #[test]
    fn discover_keeps_same_origin_and_drops_noise() {
        let raw = RawPage {
            url: "https://a.example/".to_string(),
            bytes: r##"<html><body>
                <a href="/about.html">关于</a>
                <a href="products.html">产品</a>
                <a href="#section">锚点</a>
                <a href="/about.html">重复</a>
                <a href="https://other.example/x">跨域</a>
                <a href="mailto:sales@a.example">邮件</a>
                <a href="tel:4008008888">电话</a>
                <a href="javascript:void(0)">脚本</a>
            </body></html>"##
                .as_bytes()
                .to_vec(),
            content_type: Some("text/html; charset=utf-8".to_string()),
            status: 200,
        };
        let page = extract(&raw).expect("可提取");
        let origin = url("https://a.example/");

        let discovered = discover_from_html(&page, &origin);
        let texts: Vec<String> = discovered.iter().map(Url::to_string).collect();

        assert!(texts.contains(&"https://a.example/about.html".to_string()));
        // 相对链接按 origin 补全
        assert!(texts.contains(&"https://a.example/products.html".to_string()));
        assert!(
            !texts.iter().any(|item| item.contains("other.example")),
            "跨域链接必须丢弃：{texts:?}"
        );
        assert!(
            !texts
                .iter()
                .any(|item| item.starts_with("mailto:") || item.starts_with("tel:")),
            "非 http(s) 链接必须丢弃：{texts:?}"
        );
        assert_eq!(
            texts
                .iter()
                .filter(|item| item.ends_with("/about.html"))
                .count(),
            1,
            "重复链接只保留一次"
        );
    }

    #[test]
    fn discover_resolves_relative_links_against_the_page_url() {
        let raw = RawPage {
            url: "https://a.example/docs/index.html".to_string(),
            bytes: r#"<html><body><a href="../about.html">关于</a></body></html>"#
                .as_bytes()
                .to_vec(),
            content_type: Some("text/html".to_string()),
            status: 200,
        };
        let page = extract(&raw).expect("可提取");
        let discovered = discover_from_html(&page, &url("https://a.example/"));
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].as_str(), "https://a.example/about.html");
    }

    #[test]
    fn normalize_drops_fragment_and_keeps_distinct_paths() {
        let origin = url("https://a.example/");
        assert_eq!(
            normalize(&url("https://a.example/about#team"), &origin).map(|u| u.to_string()),
            Some("https://a.example/about".to_string())
        );
        assert_eq!(
            normalize(&url("https://b.example/x"), &origin),
            None,
            "跨域直接判 None"
        );
    }
}
