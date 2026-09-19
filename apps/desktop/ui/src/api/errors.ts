/**
 * 错误文案渲染：`code + params` → 当前语言的人话（Plan A Task 7）。
 *
 * 后端**不产出自然语言**（`crates/geo-domain/src/error.rs` 的模块注释、spec §4.2、AGENTS 规则 7）：
 * IPC 只回稳定 `code` + 语言中立 `params`，句子由本模块从 `src/i18n` 词典里按当前语言取。
 * 页面因此不再各自维护 `describeError`，而是统一调 `describeIpcError(error, t)`。
 *
 * # 回退阶梯（裁定 B-10，固定，不自创）
 *
 * 1. `error` 不是 `IpcRequestError` → `common.unknownError`；
 * 2. `upstream/*` 一族 → 共享包装键 `errors.upstream.wrapper`（B-3）；
 * 3. `errors.<code>` 命中 → 按下面的「组合」渲染；
 * 4. 未命中 → `console.warn`（带上 code，契约漂移要吵出来）后回落 `error.message`。
 *
 * # 组合：主模板 + 槽位预渲染 + 可选片段
 *
 * - **槽位预渲染**：`field` / `reason` / `kind` / `skipped` 这四个 params 装的是**机器记号**，
 *   插进模板前先各自查一次词典；查不到就**原样显示**（raw passthrough，裁定 B-4——
 *   `io/failed` 的 OS 原文、`data/invalid` 的 serde 原文、动态 field 都不可能穷举）。
 *   `validation/failed` 的 zh `{{field}}{{reason}}` / en `{{field}} {{reason}}` 就是靠这一层
 *   拼出「品牌名不能为空」/「Brand name is required」（B-9，中英空格不同由词典管）。
 * - **可选片段**：主模板里只写「后端保证发出」的占位符，可选参数（`value`、
 *   `crawler/network` 的 `url`/`status`、`crawler/empty` 的 `skipped`）由 `CODE_SEGMENTS`
 *   按需追加。理由是 i18next 默认 `skipOnVariables: true`：变量缺失时会把 `{{value}}`
 *   **原样**留给用户——门禁全绿、界面露花括号，是最坏的失败形态（B-5）。
 * - **空值兜底**：即便如此，`render()` 仍会把「模板里出现、params 里缺失」的占位符填空串。
 *   契约被违反时（旧后端、手造 payload）用户看到的是信息偏少的一句话，而不是 `{{limit}}`。
 *
 * # 红线（裁定 B-6 / AGENTS 规则 6）
 *
 * 广告法红线词有两条互相独立的泄漏面，本模块都不回显：`compliance/violation` 的 `terms`
 * 与 `validation/failed` + `reason=not_allowed` 的 `value`（`NEVER_ECHO_VALUE`）。
 * 词典模板同样不含 `{{terms}}` / `{{value}}`，由 `src/i18n/dictionary.test.ts` 双向钉住。
 * 反面：`crawler/blocked` 的 `value` 是 content-type，属**该显示**的数据，走 code 级模板插值。
 *
 * 词典值一律当**纯文本**用：`interpolation.escapeValue` 是关掉的（React 自己会转义），
 * 所以任何调用方都不得把返回值塞进 `dangerouslySetInnerHTML`（`src/i18n/index.ts` 的 R-I）。
 */
import type { TFunction } from 'i18next';

import type { TranslationKey } from '../i18n/resources';
import { IpcRequestError } from './client';

/** 写死的 key 一律用 `TranslationKey` 标注：拼错在 `tsc -b` 就红（§H-2 的补偿手段）。 */
const UNKNOWN_ERROR_KEY: TranslationKey = 'common.unknownError';
const UPSTREAM_WRAPPER_KEY: TranslationKey = 'errors.upstream.wrapper';
const PARAM_VALUE_FRAGMENT: TranslationKey = 'errors.fragments.param_value';
const SKIPPED_ITEM_KEY: TranslationKey = 'errors.fragments.skipped_item';
const LIST_SEPARATOR_KEY: TranslationKey = 'errors.fragments.list_separator';

const UPSTREAM_PREFIX = 'upstream/';
const REASONS_PREFIX = 'errors.reasons.';
const TRANSPORT_PREFIX = 'errors.transport.';
const KINDS_PREFIX = 'errors.kinds.';
const SKIP_TOKENS_PREFIX = 'errors.skip_tokens.';
const FIELDS_PREFIX = 'fields.';

/**
 * code 级的 reason 词表：`llm/transport` 的三条 reason（`network` / `timeout` / `other`）
 * **不在** `error.rs` 的目录表里，所以不能塞进 `errors.reasons.*`——那会让「reasons 键集
 * == 目录键集」这条守卫失真（B-1）。它们的文案要求见 B-7：必须是可操作指引。
 */
const REASON_SCOPES: Record<string, string> = {
  'llm/transport': TRANSPORT_PREFIX,
};

/** 永不回显 `value` 的 reason：它装的是命中的广告法红线词（B-6 路径 1）。 */
const NEVER_ECHO_VALUE: ReadonlySet<string> = new Set(['not_allowed']);

/** 可选参数 → 独立片段键（B-5）。`prefix` 在主模板前拼，`suffix` 在后拼。 */
interface Segment {
  param: string;
  key: TranslationKey;
}

const CODE_SEGMENTS: Record<string, { prefix?: Segment[]; suffix?: Segment[] }> = {
  // `CrawlerError::params()` 里 url / status 都是 `Option`，有值才插键 ⇒ 都不能进主模板
  'crawler/network': {
    suffix: [
      { param: 'status', key: 'errors.fragments.crawler_network_status' },
      { param: 'url', key: 'errors.fragments.crawler_network_url' },
    ],
  },
  // `skipped` 一页都没跳过时是空串 ⇒ 整段不渲染，不留悬空分隔符（F-2）
  'crawler/empty': {
    suffix: [{ param: 'skipped', key: 'errors.fragments.crawler_empty_skipped' }],
  },
};

/** 模板里的 `{{name}}`（容忍 i18next 的 `{{name, formatter}}` 写法）。 */
function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^},]+?)\s*(?:,[^}]*)?\}\}/g)].map((match) => match[1]);
}

/**
 * 查表用的 options：`nsSeparator: false` 是**必需**的，不是风格选择。
 *
 * 本模块的 key 有一半是从后端 param 值拼出来的（`errors.reasons.<reason>`、
 * `fields.<field>`），而那些值可能是任意原文——OS 报错 `dns error: no such host`、
 * serde 消息、URL。i18next 默认 `nsSeparator: ':'`，带冒号的 key 会被切成
 * 「命名空间:键」，未命中时返回的是**冒号后面那半截**（实测 `' no such host'`），
 * 于是 `t(key) === key` 的 miss 判据失效，用户看到的是一段被截断的垃圾。
 * 关掉 ns 分隔符后，同样的 key 原样返回，miss 判据才成立（单 namespace 本来也不需要它）。
 */
const LOOKUP_OPTIONS = { nsSeparator: false } as const;

/**
 * 渲染一条模板；词典里没有这个 key 时返回 `null`。
 *
 * i18next 未命中会把 **key 原样**返回，所以 `t(key) === key` 就是 miss 信号——
 * 本模块只依赖注入进来的 `t`，不去摸 i18n 单例（页面传 `useTranslation().t`，
 * 测试传 `i18n.getFixedT(...)`，行为一致）。
 *
 * 第二个作用是 B-5 的兜底：模板里出现、但 params 里缺失的占位符一律填空串，
 * 免得 i18next 的 `skipOnVariables` 把 `{{value}}` 原样端给用户。
 */
function render(t: TFunction, key: string, values: Record<string, string>): string | null {
  const template: unknown = t(key, LOOKUP_OPTIONS);
  if (typeof template !== 'string' || template === '' || template === key) return null;

  const filled: Record<string, string> = {};
  for (const name of placeholdersOf(template)) filled[name] = values[name] ?? '';

  const rendered: unknown = t(key, { ...LOOKUP_OPTIONS, ...filled });
  return typeof rendered === 'string' ? rendered : null;
}

function firstNonEmpty(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.trim() !== '') return candidate;
  }
  return '';
}

/**
 * `field` → 人类可读字段名。查表前先做**下标归一化**：`competitors[0].name` 与
 * `competitors[7].name` 共用一个词条（裁定 F-2）。这是唯一允许的动态 field 处理逻辑
 * ——只去掉 `[数字]`，不解析路径、不拆前缀；归一化后仍查不到就原样显示（B-4）。
 */
function renderField(t: TFunction, raw: string): string {
  if (raw === '') return '';
  return render(t, `${FIELDS_PREFIX}${raw.replace(/\[\d+\]/g, '')}`, {}) ?? raw;
}

/** `kind` → 名词（`{kind}/not_found` 家族）；未知 kind 原样显示。 */
function renderKind(t: TFunction, raw: string): string {
  if (raw === '') return '';
  return render(t, `${KINDS_PREFIX}${raw}`, {}) ?? raw;
}

/**
 * `reason` → 谓语短语。查表顺序：code 级词表（`llm/transport`）→ 目录词表 → 原样显示。
 *
 * `value` 用**可选片段**追加而不是写进主模板：目录给 `out_of_range` 登记了 `expected` 与
 * `value`，但 `competitors` / `aliases` / `tags` 三处不发 `value`（§F-2 / N-3 记账）。
 * `not_allowed` 例外——它的 `value` 是红线词，永远不追加（B-6）。
 */
function renderReason(t: TFunction, code: string, params: Readonly<Record<string, string>>): string {
  const reason = params.reason ?? '';
  if (reason === '') return '';

  const scope = REASON_SCOPES[code] ?? REASONS_PREFIX;
  const text =
    render(t, `${scope}${reason}`, params) ?? render(t, `${REASONS_PREFIX}${reason}`, params) ?? reason;

  if (NEVER_ECHO_VALUE.has(reason)) return text;
  if ((params.value ?? '') === '') return text;
  return `${text}${render(t, PARAM_VALUE_FRAGMENT, params) ?? ''}`;
}

/**
 * `crawler/empty` 的 `skipped` 是扁平串：`"{url} {记号}"` 至多 3 条用 `"; "` 连接，
 * 一页都没跳过时是**空串**（F-2）。记号查 `errors.skip_tokens.*`，未知记号原样显示；
 * 连接符也走词典（zh `；` / en `; `），代码里不留自然语言。
 */
function renderSkipped(t: TFunction, raw: string): string {
  if (raw.trim() === '') return '';

  const separator = render(t, LIST_SEPARATOR_KEY, {}) ?? '; ';
  return raw
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const cut = item.lastIndexOf(' ');
      const url = cut === -1 ? item : item.slice(0, cut);
      const token = cut === -1 ? '' : item.slice(cut + 1);
      if (url === '' || token === '') return url === '' ? token : url;
      const label = render(t, `${SKIP_TOKENS_PREFIX}${token}`, {}) ?? token;
      return render(t, SKIPPED_ITEM_KEY, { url, token: label }) ?? `${url} ${label}`;
    })
    .join(separator);
}

/** 把机器记号型的 params 预渲染成人话，其余（url / status / limit / id …）原样透传。 */
function composeValues(
  t: TFunction,
  code: string,
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  const values: Record<string, string> = { ...params };
  if (values.field !== undefined) values.field = renderField(t, values.field);
  if (values.kind !== undefined) values.kind = renderKind(t, values.kind);
  if (values.reason !== undefined) values.reason = renderReason(t, code, params);
  if (values.skipped !== undefined) values.skipped = renderSkipped(t, values.skipped);
  return values;
}

function renderSegments(
  t: TFunction,
  segments: Segment[] | undefined,
  params: Readonly<Record<string, string>>,
  values: Record<string, string>,
): string {
  if (segments === undefined) return '';
  return segments
    .filter((segment) => (params[segment.param] ?? '') !== '')
    .map((segment) => render(t, segment.key, values) ?? '')
    .join('');
}

/**
 * `upstream/*` 一族（13 条 code）共用一条包装键（B-3）。
 *
 * **不要**拿里层 code 的模板渲染：两族 params 不相交（`upstream/*` 是
 * `upstream_code` + `upstream`，里层如 `llm/server` 是 `status`），套里层模板会留下空占位符。
 * 取值顺序：`upstream` → `upstream_code` → `error.message`；三者都空才 `console.warn` 回落。
 */
function describeUpstream(error: IpcRequestError, t: TFunction): string {
  const params = error.params;
  const upstream = firstNonEmpty(params.upstream, params.upstream_code, error.message);
  if (upstream === '') {
    console.warn('[geo-i18n] upstream error without upstream/upstream_code/message:', error.code);
    return error.message;
  }
  return render(t, UPSTREAM_WRAPPER_KEY, { upstream }) ?? error.message;
}

/**
 * 把一个 IPC 错误渲染成当前语言的一句话。
 *
 * @param error 通常是 `IpcRequestError`；别的（普通 `Error`、字符串、`null`）走 ①。
 * @param t 组件里 `useTranslation()` 拿到的那个 `t`——语言切换时它会跟着变，
 *   所以调用方**不要**把结果缓存到 state 之外，也不要在模块顶层求值。
 */
export function describeIpcError(error: unknown, t: TFunction): string {
  if (!(error instanceof IpcRequestError)) {
    // 词典里连这个键都没有属于不可能状态（index.test.ts 钉着），真发生就露 key 而不是空白
    return render(t, UNKNOWN_ERROR_KEY, {}) ?? UNKNOWN_ERROR_KEY;
  }
  if (error.code.startsWith(UPSTREAM_PREFIX)) return describeUpstream(error, t);

  const params = error.params;
  const values = composeValues(t, error.code, params);
  const main = render(t, `errors.${error.code}`, values);
  if (main === null) {
    console.warn('[geo-i18n] no dictionary entry for error code:', error.code);
    return error.message;
  }

  const segments = CODE_SEGMENTS[error.code];
  return (
    renderSegments(t, segments?.prefix, params, values) +
    main +
    renderSegments(t, segments?.suffix, params, values)
  );
}
