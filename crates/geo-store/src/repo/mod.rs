//! 仓储层：领域对象 ↔ SQLite 行。
//!
//! 全 crate 统一的仓储约定：
//! - 只负责持久化，不重复业务校验（校验属于 `geo-domain`）；
//! - 按 ID 定位的读/改方法（`get` / `update` / `archive` / `rename` …）在行缺失时返回
//!   [`StoreError::NotFound`](crate::StoreError::NotFound)，`kind` 用资源类别；
//! - `delete` 一律幂等：行不存在也返回 `Ok(())`，便于上层重试与失败回滚清理；
//! - 时间戳由调用方注入的领域对象携带，仓储不改写业务时间。

pub mod asset;
pub mod competitor;
pub mod entity_card;
pub mod faq;
pub mod keyword;
pub mod project;
pub mod prompt_set;

pub use asset::AssetRepo;
pub use competitor::CompetitorRepo;
pub use entity_card::EntityCardRepo;
pub use faq::FaqRepo;
pub use keyword::KeywordRepo;
pub use project::{ProjectFilter, ProjectRepo};
pub use prompt_set::{PromptSetRepo, PromptSetSummary};

use crate::error::StoreError;

/// 构造"资源不存在"错误：`kind` 用资源类别，`id` 用调用方传入的 ID 文本。
pub(crate) fn not_found(kind: &str, id: impl std::fmt::Display) -> StoreError {
    StoreError::NotFound {
        kind: kind.to_string(),
        id: id.to_string(),
    }
}

/// 写操作的"影响行数必须为 1"断言：0 行说明目标不存在。
pub(crate) fn require_found(
    rows_affected: u64,
    kind: &str,
    id: impl std::fmt::Display,
) -> Result<(), StoreError> {
    if rows_affected == 0 {
        return Err(not_found(kind, id));
    }
    Ok(())
}
