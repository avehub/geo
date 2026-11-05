//! 自检结论的稳定形状：`code` + 语言中立 `params`。
//!
//! 后端只回稳定码，文案由前端 `checkDetails.<code>` 词典按 locale 渲染（AGENTS 规则 7）。
//! 查不到 code 时前端回落到 code 本身，绝不回落到中文。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckDetail {
    pub code: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

impl CheckDetail {
    pub fn new(code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            params: BTreeMap::new(),
        }
    }

    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params.insert(key.into(), value.into());
        self
    }
}
