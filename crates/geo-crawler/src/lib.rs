//! `geo-crawler`：站点抓取与正文提取。

#[cfg(test)]
mod testkit;

pub mod error;
pub mod extract;
pub mod fetch;
pub mod robots;

pub use error::CrawlerError;
pub use extract::{decode, detect_charset, extract, ExtractedPage, RawPage};
pub use fetch::{FetchLimits, SiteFetcher};
pub use robots::RobotsRules;
