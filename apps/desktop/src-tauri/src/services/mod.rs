//! 业务编排层。**不依赖 `tauri::*`**，因此集成测试可以直接构造调用，无需启动 WebView。

pub mod entity_card_service;
pub mod project_service;
pub mod prompt_service;
pub mod templates;

// 重导出随 Task 22/23 的实现补全。
