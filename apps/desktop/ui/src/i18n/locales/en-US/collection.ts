import type { ResourceBundle } from '../../resources';

/**
 * M3 multi-engine collection (en-US). Keys must match zh-CN exactly (`ResourceBundle['collection']`):
 * a missing or extra key fails `tsc -b` (R-G).
 *
 * 🔴 Enum labels mirror the stable ids verbatim; components look them up through
 * `src/i18n/enum-label.ts`, which falls back to the id itself (never to Chinese).
 */
const collection: ResourceBundle['collection'] = {
  title: 'Multi-engine Collection',
  subtitle: '7 engines x 3 channels, with full raw evidence retention',
  sampleOnly:
    'Demo data keeps only a few sample tasks and evidence records per round, not the full collection result.',
  staticNote:
    'Success rates, latency and token usage are preset static values in demo mode; the frontend does not recompute them.',

  board: {
    rounds: 'Collection rounds',
    usage: 'Usage board',
    start: 'Queue a round',
    open: 'View queue and evidence',
    empty: 'No collection rounds yet. Queue one to get started.',
  },

  round: {
    label: 'Round',
    promptSet: 'Prompt library',
    promptSetVersion: 'Prompt library version',
    engines: 'Engine scope',
    repeatCount: 'Repeat sampling',
    plannedQueries: 'Planned queries',
    completedQueries: 'Completed',
    failedQueries: 'Failed',
    successRate: 'Success rate',
    startedAt: 'Started at',
    finishedAt: 'Finished at',
    grade: 'Sample size grade',
    metricSpec: 'Metric spec',
    notes: 'Round notes',
    notStarted:
      'Queued and waiting to run. Demo mode does not call any engine, so this round stays in the queued state.',
    running: 'Collection is still running; the numbers below will keep changing.',
    repeatNote:
      'Key prompts were sampled {{times}} times, so ratio metrics should be read as a range rather than a single point.',
  },

  statuses: {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    partial: 'Partially complete',
    failed: 'Failed',
  },

  taskStatuses: {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    skipped: 'Skipped',
  },

  engines: {
    doubao: 'Doubao',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    qwen: 'Qwen',
    yuanbao: 'Tencent Yuanbao',
    baidu_ai: 'Baidu AI Search',
    metaso: 'Metaso Search',
  },

  channels: {
    official_api: 'Official API',
    browser_automation: 'Browser automation',
    gateway: 'Gateway aggregation',
  },

  failureReasons: {
    rate_limited: 'Rate limited',
    timeout: 'Timeout',
    blocked: 'Blocked',
    login_required: 'Login required',
    empty_answer: 'Empty answer',
    transport: 'Transport error',
  },

  sourceTypes: {
    owned_page: 'Owned page',
    baike: 'Encyclopedia entry',
    news_media: 'News media',
    zhihu: 'Zhihu',
    xiaohongshu: 'Xiaohongshu',
    ecommerce: 'E-commerce platform',
    official_doc: 'Official document',
    forum: 'Forum',
    other: 'Other',
  },

  engineRuns: {
    title: 'Per-engine execution',
    engine: 'Engine',
    channel: 'Channel',
    model: 'Model version',
    planned: 'Planned',
    succeeded: 'Succeeded',
    failed: 'Failed',
    avgLatency: 'Average latency',
    promptTokens: 'Prompt tokens',
    completionTokens: 'Completion tokens',
    empty: 'No engine runs recorded for this round yet.',
    browserNote:
      'The browser automation channel has no token accounting, and its latency is markedly higher than the official API.',
  },

  tasks: {
    title: 'Task queue',
    prompt: 'Prompt',
    intent: 'Intent',
    engine: 'Engine',
    status: 'Status',
    attempt: 'Attempts',
    failureReason: 'Failure reason',
    finishedAt: 'Finished at',
    latency: 'Latency',
    retry: 'Retry',
    retryOk: 'Retry finished; the evidence record and its insight were stored',
    retryUnavailable: 'Demo data has no preset retry outcome for this task',
    viewRecord: 'View evidence',
    empty: 'No tasks in this round yet.',
  },

  records: {
    title: 'Raw evidence',
    prompt: 'Prompt',
    intent: 'Intent',
    engine: 'Engine',
    model: 'Model version',
    mentioned: 'This brand',
    mentionedYes: 'Mentioned',
    mentionedNo: 'Not mentioned',
    rank: 'Recommendation rank',
    sentiment: 'Sentiment',
    citations: 'Citations',
    collectedAt: 'Collected at',
    latency: 'Latency',
    status: 'Status',
    open: 'View evidence',
    empty: 'No evidence matches the current filters.',
    filterEngine: 'Engine',
    filterIntent: 'Intent',
    filterMentioned: 'Mentioned',
    filterStatus: 'Status',
    filterAll: 'All',
  },

  evidence: {
    title: 'Evidence detail',
    answer: 'Full answer',
    citations: 'Citations',
    domain: 'Cited domain',
    sourceType: 'Source type',
    screenshot: 'Page screenshot',
    noScreenshot:
      'Demo data contains no screenshots; the real backend stores a screenshot alongside each answer.',
    noCitations: 'This answer returned no citations.',
    model: 'Model version',
    channel: 'Collection channel',
    collectedAt: 'Collected at',
    latency: 'Latency',
    tokens: 'Token usage',
    repeatIndex: 'Sample {{index}}',
    failed: 'This task did not produce an answer',
  },

  usage: {
    title: 'Usage board',
    round: 'Round',
    queries: 'Queries',
    promptTokens: 'Prompt tokens',
    completionTokens: 'Completion tokens',
    totalTokens: 'Total tokens',
    totalQueries: 'Total queries',
    quotaQueries: 'Query hard quota',
    quotaTokens: 'Token hard quota',
    quotaNotSet: 'No quota set',
    quotaExceeded: 'The hard quota was exceeded, so collection was paused automatically.',
    quotaProgress: '{{used}} of {{quota}} used',
    empty: 'No usage data yet.',
    note: 'Cost estimation is out of MVP scope: this board tracks queries and tokens only.',
  },

  start: {
    title: 'Queue a round',
    promptSet: 'Prompt library',
    engines: 'Engine scope',
    repeatCount: 'Repeat sampling',
    label: 'Round name',
    labelPlaceholder: 'Leave empty to reuse the prompt library name',
    submit: 'Queue',
    queued: 'Queued: {{label}}',
    engineRequired: 'Select at least one engine',
    demoNotice:
      'Demo mode sends no requests: the new round stays queued and its task list is empty.',
    liveNotice:
      'This will call the configured official APIs for real: Doubao / DeepSeek / Kimi / Qwen / Baidu. Yuanbao and Metaso have no official chat API and will be marked as skipped.',
  },

  matrix: {
    title: 'Engine × intent coverage',
    note: 'Each cell is mentions / samples. Counts only; no scoring or ranking.',
    empty: 'No records to summarise in this round.',
    cell: '{{mentioned}} / {{total}}',

    rate: 'Mention rate',
    legend0: '0%',
    legendLow: '1–33%',
    legendMid: '34–66%',
    legendHigh: '67%+',
  },
};

export default collection;
