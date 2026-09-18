//! Task 9 验收：Provider 预设、计价与调用配置。
//!
//! 这里以「外部使用者」的视角只调用公开 API，顺带保证 prelude 之外的
//! `geo_llm::provider` 路径也可用。

use geo_llm::provider::{LlmConfig, LlmProvider, Pricing, Usage};

/// spec FR-L1 的预设表：Provider → (base_url, 默认模型)。
const PRESETS: [(LlmProvider, &str, &str); 6] = [
    (
        LlmProvider::DeepSeek,
        "https://api.deepseek.com/v1",
        "deepseek-chat",
    ),
    (
        LlmProvider::Moonshot,
        "https://api.moonshot.cn/v1",
        "moonshot-v1-8k",
    ),
    (
        LlmProvider::VolcengineArk,
        "https://ark.cn-beijing.volces.com/api/v3",
        "doubao-1-5-pro-32k-250115",
    ),
    (
        LlmProvider::AliBailian,
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen-plus",
    ),
    (
        LlmProvider::BaiduQianfan,
        "https://qianfan.baidubce.com/v2",
        "ernie-4.0-8k-latest",
    ),
    (
        LlmProvider::TencentHunyuan,
        "https://api.hunyuan.cloud.tencent.com/v1",
        "hunyuan-turbos",
    ),
];

fn usage(prompt: u32, completion: u32) -> Usage {
    Usage {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
    }
}

#[test]
fn preset_base_urls_and_default_models_match_spec() {
    for (provider, base_url, model) in PRESETS {
        assert_eq!(provider.base_url(), base_url);
        assert_eq!(provider.default_model(), model);
    }
}

#[test]
fn custom_provider_has_empty_preset_and_must_be_overridden() {
    assert!(LlmProvider::Custom.base_url().is_empty());
    assert!(LlmProvider::Custom.default_model().is_empty());

    let mut config = LlmConfig::for_provider(LlmProvider::Custom, "keyring://llm/custom");
    assert!(
        config.chat_completions_url().is_empty(),
        "缺 base_url 时应由调用方报配置错误，而不是发出非法请求"
    );

    config.base_url = "https://llm.example.com/v1/".to_string();
    config.model = "my-model".to_string();
    assert_eq!(
        config.chat_completions_url(),
        "https://llm.example.com/v1/chat/completions"
    );
}

#[test]
fn cost_cny_sums_input_and_output_by_million_tokens() {
    let pricing = Pricing::new(1.0, 2.0, 0.5);
    let cost = pricing.cost_cny(&usage(1_000_000, 500_000));
    assert!((cost - 2.0).abs() < 1e-9, "1M×1.0 + 0.5M×2.0 应为 2.0 元");
}

#[test]
fn cost_cny_rounds_to_cent() {
    let pricing = Pricing::new(1.0, 2.0, 0.5);
    // 0.005 元 → 进位到 1 分
    assert!((pricing.cost_cny(&usage(5_000, 0)) - 0.01).abs() < 1e-9);
    // 0.001234 + 0.011356 = 0.01259 → 0.01
    assert!((pricing.cost_cny(&usage(1_234, 5_678)) - 0.01).abs() < 1e-9);
    // 0.12 + 0.06 = 0.18，整分不应出现浮点长尾
    assert!((pricing.cost_cny(&usage(120_000, 30_000)) - 0.18).abs() < 1e-9);
    assert_eq!(pricing.cost_cny(&usage(0, 0)), 0.0);
}

#[test]
fn provider_serde_is_snake_case_and_matches_as_str() {
    assert_eq!(LlmProvider::all().len(), 7);
    for provider in LlmProvider::all() {
        assert_eq!(
            serde_json::to_string(&provider).unwrap(),
            format!("\"{}\"", provider.as_str())
        );
        assert_eq!(LlmProvider::parse(provider.as_str()), Some(provider));
        assert!(!provider.label_zh().is_empty());
    }
    assert_eq!(
        serde_json::from_str::<LlmProvider>("\"tencent_hunyuan\"").unwrap(),
        LlmProvider::TencentHunyuan
    );
}

#[test]
fn parse_tolerates_alias_spellings() {
    assert_eq!(LlmProvider::parse("deepseek"), Some(LlmProvider::DeepSeek));
    assert_eq!(LlmProvider::parse("DeepSeek"), Some(LlmProvider::DeepSeek));
    assert_eq!(LlmProvider::parse("kimi"), Some(LlmProvider::Moonshot));
    assert_eq!(LlmProvider::parse("ark"), Some(LlmProvider::VolcengineArk));
    assert_eq!(
        LlmProvider::parse("qianfan"),
        Some(LlmProvider::BaiduQianfan)
    );
    assert_eq!(
        LlmProvider::parse("hunyuan"),
        Some(LlmProvider::TencentHunyuan)
    );
    assert_eq!(LlmProvider::parse("不存在的厂商"), None);
    assert_eq!(LlmProvider::parse(""), None);
}

#[test]
fn preset_pricing_is_positive_and_custom_is_unknown() {
    for provider in LlmProvider::all() {
        let pricing = provider.pricing();
        if provider == LlmProvider::Custom {
            assert_eq!(pricing, Pricing::default(), "自定义 Provider 单价未知");
            continue;
        }
        assert!(pricing.input_per_mtok > 0.0, "{provider:?} 缺少输入定价");
        assert!(pricing.output_per_mtok > 0.0, "{provider:?} 缺少输出定价");
        assert!(
            pricing.cache_hit_per_mtok <= pricing.input_per_mtok,
            "{provider:?} 缓存命中价不应高于输入价"
        );
    }
}

#[test]
fn for_provider_fills_preset_and_retry_defaults() {
    let config = LlmConfig::for_provider(LlmProvider::Moonshot, "keyring://llm/moonshot");
    assert_eq!(config.provider, LlmProvider::Moonshot);
    assert_eq!(config.base_url, "https://api.moonshot.cn/v1");
    assert_eq!(config.model, "moonshot-v1-8k");
    assert_eq!(config.secret_ref, "keyring://llm/moonshot");
    assert!((0.0..=1.0).contains(&config.temperature));
    assert!(config.timeout_secs >= 10);
    assert_eq!(config.max_retries, 3);
    assert_eq!(config.retry_backoff_ms, 300);
    assert_eq!(
        config.chat_completions_url(),
        "https://api.moonshot.cn/v1/chat/completions"
    );
}

#[test]
fn default_config_uses_deepseek_preset_without_secret() {
    let config = LlmConfig::default();
    assert_eq!(config.provider, LlmProvider::DeepSeek);
    assert!(config.secret_ref.is_empty());
    assert_eq!(config, LlmConfig::for_provider(LlmProvider::DeepSeek, ""));
}

#[test]
fn backoff_grows_exponentially_and_caps_at_four_seconds() {
    let config = LlmConfig::default();
    assert_eq!(config.backoff_ms(0), 300);
    assert_eq!(config.backoff_ms(1), 600);
    assert_eq!(config.backoff_ms(2), 1_200);
    assert_eq!(config.backoff_ms(3), 2_400);
    assert_eq!(config.backoff_ms(4), 4_000);
    assert_eq!(config.backoff_ms(30), 4_000, "退避有上限，不会溢出");
}
