//! Provider 预设、计价与调用配置。
//!
//! 计价单位统一为「元 / 百万 token」（口径见产品文档 5.1 单位成本测算），
//! 成本看板按此把每次调用的 token 用量折算为人民币花费。
//! 定价为 2026-09 的公开定价快照，运营需要定期校准。

use serde::{Deserialize, Serialize};

/// 单次调用的 token 用量。
///
/// 与 `Pricing` 成对出现（用量 × 单价 = 成本），因此和计价放在同一模块，
/// 并由 `crate::client` 再导出一次，方便调用方从客户端侧引用。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u32,
    #[serde(default)]
    pub completion_tokens: u32,
    #[serde(default)]
    pub total_tokens: u32,
}

/// 计价：元 / 百万 token。
///
/// `cache_hit_per_mtok` 为上下文缓存命中时的输入单价，仅用于成本看板的
/// 估算展示；`cost_cny` 只按「输入 + 输出」计费，因为 OpenAI 兼容响应的
/// `usage` 并不稳定返回缓存命中 token 数。
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Pricing {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    pub cache_hit_per_mtok: f64,
}

/// 每百万 token 的换算基数。
const TOKENS_PER_MILLION: f64 = 1_000_000.0;

impl Pricing {
    pub fn new(input_per_mtok: f64, output_per_mtok: f64, cache_hit_per_mtok: f64) -> Self {
        Self {
            input_per_mtok,
            output_per_mtok,
            cache_hit_per_mtok,
        }
    }

    /// 折算本次调用的人民币成本，四舍五入到分。
    pub fn cost_cny(&self, usage: &Usage) -> f64 {
        let input = f64::from(usage.prompt_tokens) / TOKENS_PER_MILLION * self.input_per_mtok;
        let output = f64::from(usage.completion_tokens) / TOKENS_PER_MILLION * self.output_per_mtok;
        round_to_cent(input + output)
    }
}

/// 四舍五入到分（保留 2 位小数），避免成本看板出现浮点长尾。
fn round_to_cent(amount: f64) -> f64 {
    (amount * 100.0).round() / 100.0
}

/// 支持的 LLM Provider。
///
/// 序列化值为 snake_case，`as_str()` 与之一致；`parse()` 额外容忍用户常见的
/// 写法（`deepseek` / `DeepSeek` / `kimi` 等），设置页手填时更宽松。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProvider {
    #[default]
    DeepSeek,
    Moonshot,
    VolcengineArk,
    AliBailian,
    BaiduQianfan,
    TencentHunyuan,
    /// 自定义 OpenAI 兼容服务：`base_url` 与 `model` 必须由 `LlmConfig` 覆盖。
    Custom,
}

/// `parse()` 容忍的别名（已归一化为小写、去掉分隔符）。
/// 用户在手填设置时通常写厂商简称或模型系列名，这里做一次兜底映射。
const PROVIDER_ALIASES: [(&str, LlmProvider); 12] = [
    ("deepseek", LlmProvider::DeepSeek),
    ("kimi", LlmProvider::Moonshot),
    ("moonshotai", LlmProvider::Moonshot),
    ("ark", LlmProvider::VolcengineArk),
    ("volcengine", LlmProvider::VolcengineArk),
    ("doubao", LlmProvider::VolcengineArk),
    ("bailian", LlmProvider::AliBailian),
    ("dashscope", LlmProvider::AliBailian),
    ("qwen", LlmProvider::AliBailian),
    ("qianfan", LlmProvider::BaiduQianfan),
    ("ernie", LlmProvider::BaiduQianfan),
    ("hunyuan", LlmProvider::TencentHunyuan),
];

impl LlmProvider {
    pub fn all() -> [Self; 7] {
        [
            Self::DeepSeek,
            Self::Moonshot,
            Self::VolcengineArk,
            Self::AliBailian,
            Self::BaiduQianfan,
            Self::TencentHunyuan,
            Self::Custom,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DeepSeek => "deep_seek",
            Self::Moonshot => "moonshot",
            Self::VolcengineArk => "volcengine_ark",
            Self::AliBailian => "ali_bailian",
            Self::BaiduQianfan => "baidu_qianfan",
            Self::TencentHunyuan => "tencent_hunyuan",
            Self::Custom => "custom",
        }
    }

    /// 宽松解析：忽略大小写与 `_`/`-`/空格分隔，并支持常见别名。
    pub fn parse(raw: &str) -> Option<Self> {
        let normalized: String = raw
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|ch| !ch.is_ascii_whitespace() && *ch != '_' && *ch != '-')
            .collect();
        if normalized.is_empty() {
            return None;
        }
        if let Some(provider) = Self::all()
            .into_iter()
            .find(|provider| normalize(provider.as_str()) == normalized)
        {
            return Some(provider);
        }
        PROVIDER_ALIASES
            .into_iter()
            .find(|(alias, _)| *alias == normalized)
            .map(|(_, provider)| provider)
    }

    /// 设置页展示的中文名称。
    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::DeepSeek => "DeepSeek（深度求索）",
            Self::Moonshot => "Kimi（月之暗面）",
            Self::VolcengineArk => "火山方舟（豆包）",
            Self::AliBailian => "阿里云百炼（通义千问）",
            Self::BaiduQianfan => "百度千帆（文心一言）",
            Self::TencentHunyuan => "腾讯混元",
            Self::Custom => "自定义（OpenAI 兼容）",
        }
    }

    /// OpenAI 兼容服务的 base_url；`Custom` 为空，必须由 `LlmConfig` 覆盖。
    pub fn base_url(&self) -> &'static str {
        match self {
            Self::DeepSeek => "https://api.deepseek.com/v1",
            Self::Moonshot => "https://api.moonshot.cn/v1",
            Self::VolcengineArk => "https://ark.cn-beijing.volces.com/api/v3",
            Self::AliBailian => "https://dashscope.aliyuncs.com/compatible-mode/v1",
            Self::BaiduQianfan => "https://qianfan.baidubce.com/v2",
            Self::TencentHunyuan => "https://api.hunyuan.cloud.tencent.com/v1",
            Self::Custom => "",
        }
    }

    /// 该 Provider 的默认模型；`Custom` 为空，必须由用户填写。
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek-chat",
            Self::Moonshot => "moonshot-v1-8k",
            Self::VolcengineArk => "doubao-1-5-pro-32k-250115",
            Self::AliBailian => "qwen-plus",
            Self::BaiduQianfan => "ernie-4.0-8k-latest",
            Self::TencentHunyuan => "hunyuan-turbos",
            Self::Custom => "",
        }
    }

    /// 该 Provider 默认模型的计价（元 / 百万 token）。
    ///
    /// `Custom` 返回全 0，表示单价未知、不计入成本看板。
    pub fn pricing(&self) -> Pricing {
        match self {
            Self::DeepSeek => Pricing::new(2.0, 8.0, 0.2),
            Self::Moonshot => Pricing::new(12.0, 12.0, 0.0),
            Self::VolcengineArk => Pricing::new(0.8, 2.0, 0.4),
            Self::AliBailian => Pricing::new(0.8, 2.0, 0.2),
            Self::BaiduQianfan => Pricing::new(120.0, 120.0, 24.0),
            Self::TencentHunyuan => Pricing::new(3.2, 9.6, 0.8),
            Self::Custom => Pricing::default(),
        }
    }
}

/// 去掉分隔符，用于 `parse()` 的宽松比较。
fn normalize(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !ch.is_ascii_whitespace() && *ch != '_' && *ch != '-')
        .collect()
}

/// 默认采样温度：GEO 抽取与题库生成偏向稳定输出。
const DEFAULT_TEMPERATURE: f32 = 0.3;
/// 默认单请求超时（秒）。
const DEFAULT_TIMEOUT_SECS: u64 = 60;
/// 默认额外重试次数（不含首次请求）。
const DEFAULT_MAX_RETRIES: u32 = 3;
/// 默认指数退避基数（毫秒）；测试可下调以缩短耗时。
const DEFAULT_RETRY_BACKOFF_MS: u64 = 300;
/// 退避上限（毫秒）。
const MAX_RETRY_BACKOFF_MS: u64 = 4_000;

/// 一次 LLM 调用的完整配置。
///
/// `secret_ref` 只是钥匙串引用（如 `keyring://llm/deepseek`），
/// API Key 本身永不进入本结构体，也不会写库或写日志。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: LlmProvider,
    pub base_url: String,
    pub model: String,
    pub secret_ref: String,
    pub temperature: f32,
    pub timeout_secs: u64,
    /// 首次请求之外的额外重试次数。
    pub max_retries: u32,
    /// 指数退避基数（毫秒），实际上限为 4 秒。
    pub retry_backoff_ms: u64,
}

impl LlmConfig {
    /// 用 Provider 预设填充 base_url 与默认模型。
    pub fn for_provider(provider: LlmProvider, secret_ref: impl Into<String>) -> Self {
        Self {
            provider,
            base_url: provider.base_url().to_string(),
            model: provider.default_model().to_string(),
            secret_ref: secret_ref.into(),
            temperature: DEFAULT_TEMPERATURE,
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            max_retries: DEFAULT_MAX_RETRIES,
            retry_backoff_ms: DEFAULT_RETRY_BACKOFF_MS,
        }
    }

    /// `POST {base_url}/chat/completions` 的完整地址；base_url 为空时返回空串，
    /// 由调用方报「配置错误」而不是发出一个非法请求。
    pub fn chat_completions_url(&self) -> String {
        let base = self.base_url.trim();
        if base.is_empty() {
            return String::new();
        }
        format!("{}/chat/completions", base.trim_end_matches('/'))
    }

    /// 第 `attempt` 次重试前的退避时长（毫秒）：`base × 2^attempt`，上限 4 秒。
    pub fn backoff_ms(&self, attempt: u32) -> u64 {
        let base = self.retry_backoff_ms;
        let capped_exponent = attempt.min(20);
        let delay = base.saturating_mul(1u64 << capped_exponent);
        delay.min(MAX_RETRY_BACKOFF_MS)
    }
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self::for_provider(LlmProvider::default(), String::new())
    }
}
