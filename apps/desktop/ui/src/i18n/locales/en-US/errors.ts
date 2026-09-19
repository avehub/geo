import type { ResourceBundle } from '../../resources';

/**
 * 错误码文案（en-US）。键集与结构和 zh-CN 侧**逐键对齐**：文件顶部的
 * `: ResourceBundle['errors']` 标注是唯一抓得到「en 多出来的键」的一层
 * （组合层的右值来自变量，TS 不做 excess property check），改写时**不要删掉它**。
 *
 * 与 zh-CN 的唯一结构性差异是 `validation/failed` 的槽位模板：zh 是 `{{field}}{{reason}}`
 * （中文不加空格），en 是 `{{field}} {{reason}}`——空格属于词典该管的事（裁定 B-9）。
 */
const errors: ResourceBundle['errors'] = {
  'competitor/not_found': 'The {{kind}} was not found (ID: {{id}})',
  'compliance/violation':
    'The content uses expressions prohibited by advertising rules; please revise it before submitting',
  'config/invalid': 'Invalid configuration: {{reason}}',
  'crawler/blocked': 'This page was rejected ({{url}}): the content type {{value}} is not accepted',
  'crawler/decode': 'Failed to read the page content: {{reason}}',
  'crawler/empty': 'No usable pages were found on {{domain}}',
  // F-2g：`url` 是本 code 保证发出的 param，理由同 zh-CN 侧的注释。
  'crawler/invalid_url': 'The link {{reason}}: {{url}}',
  'crawler/network': 'Fetching the page failed: {{reason}}',
  'crawler/timeout': 'Fetching timed out: {{url}}',
  'crawler/too_large': 'The page is larger than the {{limit}}-byte limit: {{url}}',
  'data/invalid': 'Invalid data: {{reason}}',
  'entity_card/not_found': 'The {{kind}} was not found (ID: {{id}})',
  'io/failed': 'A file or database operation failed: {{reason}}',
  'ipc/internal':
    'Internal error. Please try again; if it keeps happening, share the logs with the developer',
  'ipc/invoke_failed': 'The call to {{cmd}} failed: {{reason}}',
  'ipc/unknown': 'Unknown error (command {{cmd}}): {{reason}}',
  'ipc/unknown_command': 'Unsupported operation: {{cmd}}',
  'llm/bad_response': 'Unexpected model response: {{reason}}',
  'llm/config': 'There is a problem with the model provider configuration: {{reason}}',
  'llm/deserialize': 'The model output does not match the expected structure: {{reason}}',
  'llm/missing_secret': 'No API key is configured yet. Add one under Settings and save it',
  'llm/rate_limited':
    'The upstream provider is rate limiting requests (429). Please retry later or lower the request rate',
  'llm/server': 'The upstream provider returned status {{status}}',
  'llm/transport': 'Could not reach the model provider: {{reason}}',
  'project/not_found': 'The {{kind}} was not found (ID: {{id}})',
  'prompt_item/not_found': 'The {{kind}} was not found (ID: {{id}})',
  'prompt_set/empty_import':
    'The CSV has no valid rows to import, so the prompt set was left unchanged',
  'prompt_set/not_found': 'The {{kind}} was not found (ID: {{id}})',
  'state/conflict': 'A data state conflict occurred: {{reason}}',
  'validation/failed': '{{field}} {{reason}}',

  reasons: {
    required: 'is required',
    empty: 'is empty and needs at least one item',
    too_long: 'exceeds the {{limit}}-character limit',
    too_short: 'is shorter than the {{limit}}-character minimum',
    invalid_url: 'is not a valid URL',
    invalid_id: 'is not a valid ID',
    invalid_format: 'has an invalid format',
    duplicate: 'contains duplicates',
    // F-2c：与 zh 侧同步改措辞，`expected` 落在括号里当附注。
    out_of_range: 'is outside the allowed range ({{expected}})',
    // F-2d：不能写死 `revise the content`——`asset.rs:110` 用同一个 reason 装 URL scheme，
    // 那时被拒的是一个链接不是 content（复审 M-3）。根因是后端把 `not_allowed` 重载成
    // 「协议/取值/内容」三种语义，已记成 Plan A 之后的 micro-task（改用 `invalid_format`）。
    not_allowed: 'is not accepted; please revise and submit again',
    missing_header: 'is missing a required column',
    row_invalid: 'this row cannot be read',
    unknown_provider: 'is not available; please pick one from the list',
    missing_base_url: 'is missing its base URL',
    missing_model: 'is missing a model name',
    parse_failed: 'could not be parsed',
    json_not_found: 'no valid JSON was found in the model output',
    missing_choices: 'the upstream response has no choices; a gateway may have intercepted it',
    http_status: 'the upstream provider returned a non-2xx status',
    unknown_field: 'points to an unknown field',
    validation_failed: 'failed field validation',
    write_failed: 'could not be written',
    secret_unavailable: 'the system keychain could not be accessed',
  },

  transport: {
    network: 'the network is unreachable, so check the proxy, VPN, DNS and certificate settings',
    timeout:
      'the upstream provider timed out, so retry later or lower the concurrency and rate limit settings',
    other: 'the connection failed, so check the logs and the status of the upstream gateway',
  },

  kinds: {
    project: 'project',
    entity_card: 'entity card',
    prompt_set: 'prompt set',
    prompt_item: 'prompt item',
    competitor: 'competitor',
  },

  skip_tokens: {
    total_timeout: 'total time budget exhausted',
    robots_disallowed: 'disallowed by robots.txt',
    fetch_failed: 'fetch or extraction failed',
  },

  fragments: {
    param_value: ' ({{value}})',
    crawler_network_status: ' (HTTP {{status}})',
    crawler_network_url: ', page {{url}}',
    crawler_empty_skipped: '; skipped pages: {{skipped}}',
    skipped_item: '{{url}} ({{token}})',
    list_separator: '; ',
  },

  upstream: {
    wrapper: 'Upstream service error: {{upstream}}',
  },
};

export default errors;
