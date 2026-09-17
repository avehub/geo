//! `geo-crawler`：站点抓取与正文提取。

#[cfg(test)]
mod testkit;

pub mod discover;
pub mod error;
pub mod extract;
pub mod fetch;
pub mod robots;
pub mod site;

pub use discover::{classify, discover_from_html, normalize, PageRole};
pub use error::CrawlerError;
pub use extract::{decode, detect_charset, extract, ExtractedPage, RawPage};
pub use fetch::{FetchLimits, SiteFetcher};
pub use robots::RobotsRules;
pub use site::{crawl_site, CrawlRequest, CrawlResult, SkippedPage};
