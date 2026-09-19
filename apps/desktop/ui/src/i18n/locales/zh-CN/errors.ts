/**
 * 错误码文案（zh-CN）。后端只回「稳定 `code` + 语言中立 `params`」，人读的句子全在这里
 * （AGENTS 规则 7 / spec §4.2 / `crates/geo-domain/src/error.rs` 的目录注释）。
 *
 * 键的组织（每类都被 `src/i18n/dictionary.test.ts` 双向钉住，多一个野键就红）：
 *
 * 1. **code 级模板**：键名逐字等于 `contracts/error-codes.json` 里的 code（`upstream/*` 除外，
 *    见最后的 `upstream.wrapper`）。
 * 2. `reasons.*`：`crates/geo-domain/src/error.rs` 目录表里的 23 个 reason key。这一层是
 *    **共享回退模板**，会被 `validation/failed`（`{{field}}{{reason}}` 槽位组合）与
 *    `llm/* / crawler/* / io|data|config|state` 等「上下文：{{reason}}」两种句式复用，
 *    所以措辞一律写成**谓语**，不带主语。
 * 3. `transport.*`：`llm/transport` 专属的三条 reason（`network` / `timeout` / `other`）。
 *    它们**不在**目录表里，因此不能塞进 `reasons.*`（那会让「reasons 键集 == 目录键集」
 *    这条断言失真）；又因为 Task 4 把上游原文收缩成只进日志，这三条是「测试连接」失败时
 *    用户能看到的**全部**诊断，必须写成可操作指引（裁定 B-7 / R-C3）。
 * 4. `kinds.*`：`{kind}/not_found` 的 kind 取值（壳侧 `NOT_FOUND_KINDS`，5 个）。
 * 5. `skip_tokens.*`：`crawler/empty` 的 `skipped` 里那三个稳定记号。
 * 6. `fragments.*`：**可选**参数的独立片段键。主模板里只写「该组合保证发出」的占位符，
 *    可选信息（`value` / `crawler/network` 的 `url`、`status` / `crawler/empty` 的 `skipped`）
 *    由组合器按需追加——i18next 默认 `skipOnVariables: true`，缺值时会把 `{{value}}`
 *    **原样**留给用户，那是最坏的失败形态（裁定 B-5）。
 *
 * 两条**不得复述**的红线（裁定 B-6 / AGENTS 规则 6）：`compliance/violation` 的模板不含
 * `{{terms}}`，`reasons.not_allowed` 不含 `{{value}}`——两者装的都是命中的广告法红线词，
 * 文案只说「需改写」。反面：`crawler/blocked` 的 `value` 是 content-type，属该显示的数据，
 * 所以它走 code 级模板直接插值。
 */
const errors = {
  'competitor/not_found': '{{kind}}不存在（ID：{{id}}）',
  'compliance/violation': '内容包含广告法禁用表述，请改写后再提交',
  'config/invalid': '配置无效：{{reason}}',
  'crawler/blocked': '已拒收该页面（{{url}}）：内容类型 {{value}} 不在允许范围内',
  'crawler/decode': '页面内容解析失败：{{reason}}',
  'crawler/empty': '抓取 {{domain}} 后没有得到任何可用页面',
  'crawler/invalid_url': '链接{{reason}}',
  'crawler/network': '抓取网页失败：{{reason}}',
  'crawler/timeout': '抓取超时：{{url}}',
  'crawler/too_large': '页面超过大小上限（{{limit}} 字节）：{{url}}',
  'data/invalid': '数据格式有误：{{reason}}',
  'entity_card/not_found': '{{kind}}不存在（ID：{{id}}）',
  'io/failed': '文件或数据库读写失败：{{reason}}',
  'ipc/internal': '内部错误，请重试；如果反复出现，请把日志发给开发者',
  'ipc/invoke_failed': '调用 {{cmd}} 失败：{{reason}}',
  'ipc/unknown': '未知错误（命令 {{cmd}}）：{{reason}}',
  'ipc/unknown_command': '不支持的操作：{{cmd}}',
  'llm/bad_response': '模型响应异常：{{reason}}',
  'llm/config': '模型服务配置有问题：{{reason}}',
  'llm/deserialize': '模型输出不符合预期结构：{{reason}}',
  'llm/missing_secret': '还没有配置 API Key，请先在「设置」里填写并保存',
  'llm/rate_limited': '上游限流（429），请稍后重试，或调低请求频率',
  'llm/server': '上游返回错误状态码 {{status}}',
  'llm/transport': '连接模型服务失败：{{reason}}',
  'project/not_found': '{{kind}}不存在（ID：{{id}}）',
  'prompt_item/not_found': '{{kind}}不存在（ID：{{id}}）',
  'prompt_set/empty_import': 'CSV 里没有可导入的有效条目，题库未改动',
  'prompt_set/not_found': '{{kind}}不存在（ID：{{id}}）',
  'state/conflict': '数据状态冲突：{{reason}}',
  'validation/failed': '{{field}}{{reason}}',

  reasons: {
    required: '不能为空',
    empty: '是空的，至少需要一项内容',
    too_long: '超过 {{limit}} 字上限',
    too_short: '不足 {{limit}} 字下限',
    invalid_url: '不是合法网址',
    invalid_id: '不是合法 ID',
    invalid_format: '格式不正确',
    duplicate: '存在重复项',
    out_of_range: '需在 {{expected}} 范围内',
    not_allowed: '不被允许，请改写后再提交',
    missing_header: '缺少必需的列',
    row_invalid: '这一行无法读取',
    unknown_provider: '不可用，请从列表里重新选择',
    missing_base_url: '缺少服务地址 base_url',
    missing_model: '缺少模型名',
    parse_failed: '无法解析',
    json_not_found: '模型输出里找不到合法 JSON',
    missing_choices: '上游响应缺少 choices，可能被网关拦截',
    http_status: '上游返回了非 2xx 状态码',
    unknown_field: '指向了未知字段',
    validation_failed: '未通过字段校验',
    write_failed: '写入失败',
    secret_unavailable: '系统钥匙串读写失败',
  },

  transport: {
    network: '网络不可达，请检查代理、VPN、DNS 与证书设置',
    timeout: '上游响应超时，请稍后重试，或调低并发与频控设置',
    other: '连接失败，请查看日志与上游网关状态',
  },

  kinds: {
    project: '项目',
    entity_card: '实体卡',
    prompt_set: '题库',
    prompt_item: '题目',
    competitor: '竞品',
  },

  skip_tokens: {
    total_timeout: '总时长预算用尽',
    robots_disallowed: 'robots.txt 不允许抓取',
    fetch_failed: '抓取或解析失败',
  },

  fragments: {
    param_value: '（{{value}}）',
    crawler_network_status: '（HTTP {{status}}）',
    crawler_network_url: '，页面 {{url}}',
    crawler_empty_skipped: '；跳过的页面：{{skipped}}',
    skipped_item: '{{url}}（{{token}}）',
    list_separator: '；',
  },

  upstream: {
    wrapper: '上游服务返回错误：{{upstream}}',
  },
};

export default errors;
