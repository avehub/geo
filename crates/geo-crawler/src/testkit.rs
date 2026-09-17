//! 测试夹具加载与 wiremock 站点挂载（仅测试使用，不进生产代码路径）。

use std::path::PathBuf;

use wiremock::MockServer;

use crate::extract::RawPage;

/// `fixtures/http/` 的绝对路径（相对本 crate 目录向上两级）。
pub(crate) fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/http")
}

/// 读取夹具原始字节（GBK 夹具必须按字节读，不能走 `String`）。
pub(crate) fn fixture_bytes(name: &str) -> Vec<u8> {
    std::fs::read(fixtures_dir().join(name))
        .unwrap_or_else(|error| panic!("读取夹具 {name} 失败：{error}"))
}

/// 读取 UTF-8 夹具文本。
pub(crate) fn fixture_text(name: &str) -> String {
    String::from_utf8(fixture_bytes(name))
        .unwrap_or_else(|error| panic!("夹具 {name} 不是 UTF-8：{error}"))
}

/// 由夹具字节直接构造 `RawPage`，用于不经 HTTP 的解码/提取测试。
pub(crate) fn raw_page(name: &str, url: &str, content_type: Option<&str>) -> RawPage {
    RawPage {
        url: url.to_string(),
        bytes: fixture_bytes(name),
        content_type: content_type.map(str::to_string),
        status: 200,
    }
}

/// 把夹具站点挂载到 wiremock：5 个 UTF-8 页面 + GBK 页 + robots.txt + 受禁的 `/admin/secret`。
/// 挂载后 `server.uri()` 即站点根，BFS 从 `/` 出发能发现全部 5 页。
pub(crate) async fn mount_fixture_site(server: &MockServer) {
    for (path, fixture) in [
        ("/", "index.html"),
        ("/about.html", "about.html"),
        ("/products.html", "products.html"),
        ("/faq.html", "faq.html"),
        ("/contact.html", "contact.html"),
        ("/admin/secret", "admin.html"),
    ] {
        mount_html(server, path, fixture).await;
    }
    mount_raw(
        server,
        "/gbk-page.html",
        &fixture_bytes("gbk-page.html"),
        "text/html; charset=gbk",
    )
    .await;
    mount_raw(
        server,
        "/robots.txt",
        &fixture_bytes("robots.txt"),
        "text/plain; charset=utf-8",
    )
    .await;
}

/// 以 `text/html; charset=utf-8` 挂载一个 UTF-8 夹具。
pub(crate) async fn mount_html(server: &MockServer, path: &str, fixture: &str) {
    mount_raw(
        server,
        path,
        &fixture_bytes(fixture),
        "text/html; charset=utf-8",
    )
    .await;
}

/// 以指定 MIME 挂载原始字节（编码夹具必须按字节挂载，不能被转成 `String`）。
pub(crate) async fn mount_raw(server: &MockServer, path: &str, bytes: &[u8], mime: &str) {
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(path))
        .respond_with(wiremock::ResponseTemplate::new(200).set_body_raw(bytes.to_vec(), mime))
        .mount(server)
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{decode, detect_charset};

    /// 参与内容校验的页面夹具（`admin.html` 是「不得被抓取」的反例，只校验合规词）。
    const CONTENT_FIXTURES: [&str; 5] = [
        "index.html",
        "about.html",
        "products.html",
        "faq.html",
        "contact.html",
    ];

    fn gbk_fixture_text() -> String {
        let bytes = fixture_bytes("gbk-page.html");
        decode(&bytes, detect_charset(None, &bytes))
    }

    #[test]
    fn fixtures_are_free_of_absolute_terms() {
        let mut texts: Vec<(String, String)> = CONTENT_FIXTURES
            .iter()
            .map(|name| (name.to_string(), fixture_text(name)))
            .collect();
        texts.push(("gbk-page.html".to_string(), gbk_fixture_text()));
        texts.push(("admin.html".to_string(), fixture_text("admin.html")));

        for (name, text) in texts {
            let violations = geo_domain::compliance::scan(&text);
            assert!(
                violations.is_empty(),
                "{name} 命中绝对化用语：{:?}",
                violations
                    .iter()
                    .map(|item| item.term.clone())
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn fixtures_cover_at_least_eight_required_entity_fields() {
        let mut combined = CONTENT_FIXTURES
            .iter()
            .map(|name| fixture_text(name))
            .collect::<Vec<_>>()
            .join("\n");
        combined.push_str(&gbk_fixture_text());

        // 每项必填字段给出判定用的标记串（全部命中才视为该字段有素材）。
        let markers: [(&str, &[&str]); 10] = [
            ("standard_name", &["宏宇泵业", "上海宏宇水泵制造有限公司"]),
            ("aliases", &["上海宏宇水泵", "Hongyu Pump"]),
            ("founded_year", &["2006"]),
            ("qualifications", &["ISO9001", "CCC"]),
            ("products", &["HY-ISG", "HY-WQ", "HY-XBD", "HY-ZS"]),
            ("price_range", &["价格区间", "元/台"]),
            ("service_regions", &["省级行政区", "服务网点"]),
            ("cases", &["典型案例", "污水处理厂二期扩容"]),
            ("differentiators", &["差异化", "自有水力性能测试台"]),
            ("contact", &["400-820-6688", "@hongyu-pump.example"]),
        ];

        assert_eq!(
            markers.len(),
            geo_domain::REQUIRED_FIELDS.len(),
            "夹具校验应覆盖全部必填字段"
        );
        let mut missing = Vec::new();
        for (field, options) in markers {
            if !options.iter().all(|marker| combined.contains(marker)) {
                missing.push(field);
            }
        }
        assert!(
            missing.is_empty(),
            "以下必填字段缺少素材（要求至少 8/10）：{missing:?}"
        );
    }

    #[test]
    fn gbk_fixture_is_genuinely_gbk_encoded() {
        let bytes = fixture_bytes("gbk-page.html");
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "gbk-page.html 必须是 GBK 字节，不能是 UTF-8"
        );
        assert_eq!(detect_charset(None, &bytes).name(), "GBK");
        assert!(gbk_fixture_text().contains("技术公告与服务承诺"));
    }
}
