# fixtures/llm — LLM 录制响应

本目录存放 **OpenAI 兼容的录制响应**，供离线测试回放使用（`geo-llm` 的测试永不触网，
见 `AGENTS.md` 硬性规则 2）。所有内容为虚构的品牌「宏宇泵业」样本数据，
竞品为「南方泵业」「凯泉泵业」「格兰富」。

## 文件结构约定

1. **单条响应**：文件内容就是一个 `chat.completion` 响应体，
   业务 JSON 放在 `choices[0].message.content` 里，且 **content 是字符串**
   （字符串内容才是实体卡 / 题库的 JSON），与真实模型返回一致。
2. **顺序响应**：`{"responses": [<响应 1>, <响应 2>, ...]}`，
   用于「首次输出不可用、修复重试后成功」这类需要多次回放的场景。
   `FixtureTransport::from_dir` 会按调用顺序播放，播完后停在最后一条。

## fixture key 约定

`FixtureTransport::from_dir(dir)` 以 **文件名（去掉 `.json`）作为 key**，
key 的计算方式是 `geo_llm::fixture_key(url, body)`，
即 `sha256(url + body)` 的前 16 位十六进制。未命中时返回
`fixture miss: <key>`，照着提示补一个 `<key>.json` 即可。

本目录采用语义化命名（便于人工阅读），因此测试里有两种用法：

- 直接读取文件内容，断言它能被 `geo_domain` 的模型解析（契约测试）；
- 通过 `FixtureTransport::from_map({ fixture_key(url, body) => 文件内容 })`
  挂到指定 key 上，走完整的 `LlmClient` 调用链。

## 文件清单

| 文件 | 内容 | 消费方 |
|---|---|---|
| `entity_card.json` | 品牌实体卡（`EntityFields`），必填 10 项全填，`completeness = 1.0` | M1 自动建档（`chat_json::<EntityFields>`） |
| `entity_card_invalid_then_ok.json` | 顺序响应：第 1 条被截断（`finish_reason: length`），第 2 条为合法 JSON | 结构化输出的修复重试 |
| `prompt_expand.json` | 31 条 `{text, intent}` 意图扩写，覆盖全部 7 类意图，口语化问法 | M2 题库生成（LLM 扩写） |
| `prompt_rewrite.json` | 26 条 `{original, rewritten}` 书面问法 → 口语化改写 | M2 题库生成（口语化改写） |

`intent` 取值必须是 `geo_domain::IntentCategory` 的 7 个 snake_case 值：
`category_awareness`、`purchase_recommendation`、`brand_comparison`、
`pricing_plan`、`local_service`、`after_sales_reputation`、`professional_long_tail`。

## 内容纪律

- 全中文；prompt 文本口语化（「哪个好」「靠谱吗」「多少钱」「是不是智商税」），单条 ≤ 300 字。
- **不得出现** `crates/geo-domain/data/adlaw_terms.txt` 里的绝对化用语
  （保证排名 / 霸屏 / 第一 / 最佳 / 最优 / 唯一 / 顶级 / 100% / 永久 等）。
- 实体卡必填字段至少填 8 项，保证下游 `completeness() >= 0.8`。
- 契约测试在 `crates/geo-llm/tests/fixtures.rs`，改完 fixture 跑
  `mise exec -- cargo test -p geo-llm` 即可校验。

## 重录

真实录制需要在有 API Key 的环境手动执行（spec FR-L5 规划的
`scripts/record-fixtures.sh`，脚本不参与测试、不进 CI）。重录后请保持
`content` 为字符串的包裹形态，并重新跑一遍契约测试与合规扫描。
