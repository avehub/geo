//! 测试替身：可编程传输，按调用顺序回放响应并记录收到的请求。
//!
//! 与 `FixtureTransport`（按 `sha256(url+body)` 匹配）互补：`chat_json` 的修复重试
//! 会改变请求体，key 每次都不同，因此这里按调用次序回放。

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use geo_llm::transport::{HttpRequest, HttpResponse, Transport, TransportError};

#[derive(Debug, Default)]
pub struct ScriptedTransport {
    bodies: Vec<String>,
    cursor: Mutex<usize>,
    requests: Mutex<Vec<HttpRequest>>,
}

impl ScriptedTransport {
    /// 返回可直接当作 `Arc<dyn Transport>` 使用的句柄。
    pub fn new(bodies: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            bodies,
            ..Self::default()
        })
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().expect("lock").len()
    }

    pub fn requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().expect("lock").clone()
    }
}

#[async_trait]
impl Transport for ScriptedTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.requests.lock().expect("lock").push(req);
        let mut cursor = self.cursor.lock().expect("lock");
        if self.bodies.is_empty() {
            return Err(TransportError::Other("脚本响应为空".to_string()));
        }
        let index = (*cursor).min(self.bodies.len() - 1);
        *cursor = cursor.saturating_add(1);
        Ok(HttpResponse {
            status: 200,
            body: self.bodies[index].clone(),
        })
    }
}

/// 把模型输出包装成 OpenAI 兼容响应体。
pub fn openai_response(content: &str) -> String {
    serde_json::json!({
        "id": "chatcmpl-scripted",
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
        "usage": { "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150 },
    })
    .to_string()
}
