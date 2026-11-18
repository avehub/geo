/**
 * 远程内容（数据面）的 demo 种子 = **编译期内置快照的镜像**。
 *
 * 🔴 这里的数据只服务于浏览器 demo（没有 Rust、没有网络）。它刻意与
 * `crates/geo-domain/data/remote-builtin/` 同形，让设置页"远程内容"一节在 demo 里
 * 也能展示「内置 vN」而不是空表。
 *
 * 🔴 种子绝对确定：一个 `Date.now()` 都不许有（同 `src/demo/seed/**` 的既有约定）。
 */

/** 内置快照的生成时间（与 `builtin-manifest.json` 同一时刻，用于"内置版本"展示）。 */
export const REMOTE_SEED_GENERATED_AT = '2026-11-17T07:15:41.568Z';

/** 内置快照的版本表（键序与后端 `ItemKey::ALL` 一致）。 */
export const REMOTE_BUILTIN_VERSIONS: Array<{ key: string; version: number }> = [
  { key: 'release', version: 9738 },
  { key: 'engines', version: 1794899741530 },
  { key: 'providers', version: 1794899741530 },
  { key: 'rate_limits', version: 1794899741443 },
  { key: 'rulepacks', version: 1794899741151 },
  { key: 'templates', version: 1794897557765 },
  { key: 'compliance', version: 12 },
  { key: 'privacy', version: 1794897558860 },
];

export const REMOTE_RELEASE = {
  version: '9.9.9738',
  notes: '演示版内置快照：不联网也能跑通关于页与更新提示。',
  pub_date: '2026-11-17T07:15:39.642Z',
  platforms: {},
};

export const REMOTE_PROVIDERS = {
  schema_version: 1,
  version: 1794899741530,
  generated_at: '2026-11-17T07:15:41.530Z',
  presets: [
    {
      code: 'deepseek',
      display_name: 'DeepSeek',
      protocol: 'openai_compat',
      base_url: 'https://api.deepseek.com/v1',
      default_model: 'deepseek-chat',
      timeout_ms: 60000,
      temperature: null,
      note_zh: null,
      sort: 1,
    },
    {
      code: 'moonshot',
      display_name: 'Moonshot',
      protocol: 'openai_compat',
      base_url: 'https://api.moonshot.cn/v1',
      default_model: 'moonshot-v1-8k',
      timeout_ms: 60000,
      temperature: null,
      note_zh: null,
      sort: 2,
    },
  ],
};

export const REMOTE_RULEPACKS = {
  schema_version: 1,
  version: 1794899741151,
  generated_at: '2026-11-17T07:15:41.151Z',
  packs: [
    {
      engine_code: 'baidu_ziyan',
      version: 1,
      path: 'rulepacks/baidu_ziyan@1.json',
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      min_app_version: '0.2.0',
      max_app_version: null,
    },
  ],
};

/** 百度 AI 引用页的声明式规则包（demo 只用于展示"规则长什么样"）。 */
export const REMOTE_RULEPACK_BAIDU = {
  schema_version: 1,
  engine_code: 'baidu_ziyan',
  version: 1,
  start_url: 'https://ziyuan.baidu.com/aiflow/index',
  page_classifiers: [
    {
      kind: 'ai_citation',
      match: { title_contains: ['百度搜索资源平台'], url_contains: ['/aiflow/'] },
    },
  ],
  table_rules: [
    {
      kind: 'keyword_table',
      columns: [
        { header_match: ['关键词'], field: 'query', type: 'text' },
        { header_match: ['AI引用量'], field: 'citations', type: 'integer' },
        { header_match: ['AI曝光量'], field: 'impressions', type: 'integer' },
        { header_match: ['AI点击量'], field: 'clicks', type: 'integer' },
        { header_match: ['AI点击率'], field: 'ctr', type: 'percent' },
      ],
    },
  ],
  pagination: { kind: 'none' },
};

export const REMOTE_COMPLIANCE = {
  schema_version: 1,
  version: 12,
  generated_at: '2026-11-17T06:39:18.106Z',
  terms: [
    { term: '保证排名', category: 'absolute', severity: 'block', locale: 'zh-CN' },
    { term: '包上首页', category: 'absolute', severity: 'block', locale: 'zh-CN' },
  ],
};

export const REMOTE_PRIVACY = {
  schema_version: 1,
  version: 1794897558860,
  generated_at: '2026-11-17T06:39:18.860Z',
  facts: [
    {
      kind: 'outbound_trigger',
      action_zh: '新建项目 → 自动建档',
      action_en: null,
      data_leaving_zh: 'HTTP GET 到您的官网',
      recipient_zh: '您的官网服务器',
      periodic: 0,
      channel_scope: 'all',
      sort: 10,
    },
  ],
};

export const REMOTE_TEMPLATES = {
  schema_version: 1,
  version: 1794897557765,
  generated_at: '2026-11-17T06:39:17.765Z',
  packs: [],
};

export const REMOTE_ENGINES = {
  schema_version: 1,
  version: 1794899741530,
  generated_at: '2026-11-17T07:15:41.530Z',
  engines: [
    {
      code: 'baidu_ziyan',
      display_name_zh: '百度 AI 搜索',
      display_name_en: null,
      channel_type: 'browser_automation',
      priority: 'P0',
      enabled: 1,
      free_quota_hint_zh: null,
      known_limits_zh: '需用户自行登录；MSIX 版不含本通道',
      data_export_region: 0,
      default_off: 0,
      sort: 5,
    },
  ],
};

export const REMOTE_RATE_LIMITS = {
  schema_version: 1,
  version: 1794899741443,
  generated_at: '2026-11-17T07:15:41.443Z',
  note_zh: '建议值，客户端本地设置优先',
  baselines: [
    { engine_code: 'baidu_ziyan', requests_per_minute: 10, min_interval_ms: 3000, retry_max: 3 },
  ],
};
