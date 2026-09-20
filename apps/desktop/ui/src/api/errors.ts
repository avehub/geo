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
 * 4. 未命中 → `console.warn`（带上 code，契约漂移要吵出来）后回落 `error.message`
 *    （回落前抹掉 `terms=` / `value=` 段，见下面的红线③）。
 *
 * Task 7b 在第 ③ 级的**出口**追加了一道质量闸门（裁定 B-1③；不改上面 4 级的顺序与语义）：
 * 渲染结果过 `problemsOf()` 不合格 ⇒ `console.warn` 后回落 `common.unknownError`。
 * 判据与 `src/i18n/dictionary.test.ts` 的门禁**共用 `src/api/error-text.ts` 里同一个函数**，
 * 所以不会再出现「门禁绿、界面露洞」（Task 7 的 R-1 就是这个错位）。
 * 它刻意**不**回落 `error.message`：那是紧凑日志串（`{code} {k}={v}…`），比空洞更糟。
 * 它也不去救第 ④ 级——词典 miss 是契约漂移，该吵出来，不该被通用文案盖住。
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
 * # 红线（裁定 B-6 / B-3 / AGENTS 规则 6）
 *
 * 广告法红线词有**三条**互相独立的泄漏面，本模块一条都不放过：
 *
 * 1. `compliance/violation` 的 `terms`——词典模板不含 `{{terms}}`，由
 *    `src/i18n/dictionary.test.ts` 双向钉住；
 * 2. `reason=not_allowed` 的 `value`——`compliance.rs:93` 把命中的红线词装在这里。
 *    这一条走 **allowlist**（`MAY_ECHO_VALUE`，fail-closed）：只有逐个核过语义、确认
 *    `value` 装的是可操作数据的 reason 才允许回显，其余一律不送进插值；
 * 3. 第 ④ 级回落的 `error.message`——后端紧凑串逐字含全部 params（`error.rs` 的
 *    `with_params`），所以 miss 回退前要把 `terms=` / `value=` 段抹成 `***`。
 *
 * 反面（allowlist 存在的理由，不是「一刀切藏掉所有 value」）：`crawler/blocked` 的 `value`
 * 是 content-type、`out_of_range` 的 `value` 是实际数值、`missing_model` 的 `value` 是
 * provider 的稳定 id——都属**该显示**的数据。`crawler/blocked` 走 code 级模板插值，
 * 其余走 `errors.fragments.param_value` 片段。
 *
 * 词典值一律当**纯文本**用：`interpolation.escapeValue` 是关掉的（React 自己会转义），
 * 所以任何调用方都不得把返回值塞进 `dangerouslySetInnerHTML`（`src/i18n/index.ts` 的 R-I）。
 */
import type { TFunction } from 'i18next';

import type { TranslationKey } from '../i18n/resources';
import { IpcRequestError } from './client';
import { problemsOf } from './error-text';

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
 * CSV 行错误族的**合成 code**（Task 8 · 裁定 B-5 / G-2）。
 *
 * `CsvRowError` 不是 `IpcError`：它是 `{row, reason, params}`，**没有 code**，而
 * `describeIpcError` 第一件事就是 `instanceof` 分流 ⇒ 直接喂进去只会得到 `common.unknownError`。
 * 但它的 reason 词表需要的是**同一套**阶梯（code 级覆写优先 → 目录级兜底 → raw passthrough
 * → allowlist 决定要不要追加 `value`），所以借 `REASON_SCOPES` 挂一个合成 code 复用
 * `renderReason`，而不是在 `CsvToolbar.tsx` 里重写第二份——那会造出第二个、更弱的泄漏面
 * （allowlist 与回退阶梯各存两份，将来改一份忘另一份，漏掉的正是广告法红线守卫）。
 *
 * `csv/row` **不在** `contracts/error-codes.json` 的 43 码里，后端也发不出来，
 * 因此不可能与 `describeIpcError` 的主路撞上，既有 4 级阶梯语义一行未动。
 */
const CSV_ROW_CODE = 'csv/row';

/**
 * CSV 行错误的 code 级词表前缀。键住在 `prompt` namespace 而不是 `errors`：
 * ① `locales/{zh-CN,en-US}/errors.ts` 不在 Task 8 的写集内（简报 §C）；
 * ② `src/i18n/dictionary.test.ts` 的「结构闭合」用例把 `errors` 下的叶子钉成六类，
 *    多一个 `errors.csv.*` 当场就是"不属于任何一类的键"。
 * CSV 导入导出本来只有题库页这一个 surface，语义也更贴。
 */
const CSV_REASONS_PREFIX = 'prompt.csv.reasons.';

/** 行错误的外壳（zh `第 {{row}} 行：{{detail}}` / en `Row {{row}}: {{detail}}`）。 */
const CSV_ROW_KEY: TranslationKey = 'prompt.csv.rowError';

/**
 * code 级的 reason 词表：`llm/transport` 的三条 reason（`network` / `timeout` / `other`）
 * **不在** `error.rs` 的目录表里，所以不能塞进 `errors.reasons.*`——那会让「reasons 键集
 * == 目录键集」这条守卫失真（B-1）。它们的文案要求见 B-7：必须是可操作指引。
 */
const REASON_SCOPES: Record<string, string> = {
  'llm/transport': TRANSPORT_PREFIX,
  // 见上面 CSV_ROW_CODE 的注释：合成 code，只被 describeCsvRowError 用到。
  [CSV_ROW_CODE]: CSV_REASONS_PREFIX,
};

/**
 * **可以**把 `params.value` 送进插值的 reason（allowlist，fail-closed；裁定 B-3 / 复审 I-2）。
 *
 * 前身是一份 denylist（`NEVER_ECHO_VALUE = {'not_allowed'}`），方向错了：后端将来新加一个
 * reason 并给它塞 `value`，denylist 会**默认回显**。翻成 allowlist 之后默认**不显示**——
 * 丢信息，但不泄红线词，这正是广告法该选的失败方向。
 *
 * 成员是**逐 reason 核过发射点**定的，不是把 denylist 取反：
 *
 * | reason | `value` 装什么 | 依据的发射点 |
 * | --- | --- | --- |
 * | `invalid_url` | 用户填的网址/域名 | `asset.rs:108`/`:117`、`entity_card_service.rs:299` |
 * | `invalid_id` | 原始 ID 串 | `ids.rs:42`、`prompt_service.rs:558` |
 * | `invalid_format` | 形状判据的原始输入 | `entity_card.rs:420`/`:430`/`:444`、`csv_io.rs:216`-`:248` |
 * | `out_of_range` | 实际数量/数值 | `prompt_service.rs:167`/`:173`/`:631`、`settings_service.rs:397` |
 * | `missing_header` | 缺失的列名列表 | `csv_io.rs:154`-`:155` |
 * | `row_invalid` | csv 库的行级原文 | `csv_io.rs:167`-`:171` |
 * | `unknown_provider` | 用户填的 provider 串 | `settings_service.rs:282` |
 * | `missing_base_url` | `Provider::as_str()` 稳定 id | `geo-llm/src/client.rs:214`-`:215` |
 * | `missing_model` | `Provider::as_str()` 稳定 id | `geo-llm/src/client.rs:218`-`:219` |
 * | `parse_failed` | serde / csv 库原文 | `project_transfer.rs:81`、`csv_io.rs:141` |
 * | `unknown_field` | 未知字段名 | `entity_card.rs:441`/`:476` |
 * | `write_failed` | io 库原文 | `csv_io.rs:108`/`:121`/`:281`-`:318` |
 * | `duplicate` | sqlx 驱动原文（唯一约束） | `geo-store/src/error.rs:199`-`:203` |
 * | `secret_unavailable` | 已 `redact` 的钥匙串原文 | `geo-store/src/error.rs:210`-`:213`（变体注释明写不得含密钥） |
 *
 * **不在**表里的 9 个 reason：`required` / `empty` / `too_long` / `too_short` /
 * `json_not_found` / `missing_choices` / `http_status` / `validation_failed` 的目录
 * 配套参数里**没有 `value`**（`geo-llm/tests/chat_json.rs:114` 明写 `validation_failed`
 * 的 params 只有 `{reason}`），列进来只会白开一个口子；`not_allowed` 是唯一会装红线词的
 * reason（`compliance.rs:93`），**永远不进表**——代价是 `asset.rs:110` 那条用同一个 reason
 * 装 URL scheme 的站点被一并抑制（复审 M-3），根因在后端的 reason 重载，已记成 micro-task。
 *
 * **Task 8 必须复用这张表**：`csv_io.rs:81`-`:85` 的 `RowFailure::from_geo` 把 compliance 的
 * `value`=命中词原样搬进 `CsvRowError.params`，`CsvToolbar` 渲染它是同一条泄漏面的第二次出现。
 * 用下面的 `mayEchoParamValue()`，不要另抄一份。
 */
export const MAY_ECHO_VALUE: ReadonlySet<string> = new Set([
  'duplicate',
  'invalid_format',
  'invalid_id',
  'invalid_url',
  'missing_base_url',
  'missing_header',
  'missing_model',
  'out_of_range',
  'parse_failed',
  'row_invalid',
  'secret_unavailable',
  'unknown_field',
  'unknown_provider',
  'write_failed',
]);

/**
 * 这个 reason 的 `params.value` 能不能回显给用户（fail-closed）。
 * 导出给 Task 8 的 `CsvToolbar` 共用，见 `MAY_ECHO_VALUE` 的注释。
 */
export function mayEchoParamValue(reason: string): boolean {
  return MAY_ECHO_VALUE.has(reason);
}

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
 * 追加与否由 allowlist `MAY_ECHO_VALUE` 决定（fail-closed，B-3）——不在表里的 reason
 * 一律不追加，`not_allowed` 的红线词因此永远上不了屏。
 */
function renderReason(t: TFunction, code: string, params: Readonly<Record<string, string>>): string {
  const reason = params.reason ?? '';
  if (reason === '') return '';

  const scope = REASON_SCOPES[code] ?? REASONS_PREFIX;
  const text =
    render(t, `${scope}${reason}`, params) ?? render(t, `${REASONS_PREFIX}${reason}`, params) ?? reason;

  if (!mayEchoParamValue(reason)) return text;
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
 * miss 回退前把后端紧凑串里的敏感段抹掉（红线③，裁定 F-2h①）。
 *
 * 后端 `IpcError::with_params`（`apps/desktop/src-tauri/src/error.rs:68`-`:90`）把 message
 * 拼成 `"{code} {k}={v} …"`（键按 BTreeMap 排序），**逐字含全部 params**。词典 miss 时第 ④ 级
 * 会把它原样端上屏，于是 `terms=国家级…` 经这条路上屏——这是 B-6 没数到的第三条泄漏面。
 * 只抹 `terms=` / `value=` 两个键：前者恒装红线词，后者在 `not_allowed` 下装红线词。
 *
 * 保留匹配到的前导空白（用捕获组回填），免得把 `code terms=x` 变成 `code  terms=***`
 * 反而制造出「连续两个空格」这种新问题。
 */
function redactCompactMessage(message: string): string {
  return message.replace(/(^|\s)(terms|value)=[^\s]*/g, (_match, lead: string, key: string) => `${lead}${key}=***`);
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
    // 前端自身的异常（TypeError、queryFn 里映射代码抛错、CSV 组装抛错）走到这里。
    // 用户看到的是通用文案，所以日志是**唯一**的排障线索——第 ③ 级 miss 会 warn，
    // 这一级不 warn 就成了「通用 toast + 日志零痕迹」（复审 M-5，且相对 BASE 是回归）。
    console.warn('[geo-i18n] non-IpcRequestError surfaced to UI:', error);
    // 词典里连这个键都没有属于不可能状态（index.test.ts 钉着），真发生就露 key 而不是空白
    return render(t, UNKNOWN_ERROR_KEY, {}) ?? UNKNOWN_ERROR_KEY;
  }
  if (error.code.startsWith(UPSTREAM_PREFIX)) return describeUpstream(error, t);

  const params = error.params;
  const values = composeValues(t, error.code, params);
  const main = render(t, `errors.${error.code}`, values);
  if (main === null) {
    console.warn('[geo-i18n] no dictionary entry for error code:', error.code);
    return redactCompactMessage(error.message);
  }

  const segments = CODE_SEGMENTS[error.code];
  const text =
    renderSegments(t, segments?.prefix, params, values) +
    main +
    renderSegments(t, segments?.suffix, params, values);

  // 质量闸门（B-1③）：第 ③ 级的**出口**检查，不改上面 4 级的顺序与语义。
  // 判据与 `src/i18n/dictionary.test.ts` 的门禁共用 `error-text.ts` 同一个函数。
  const problems = problemsOf(text);
  if (problems.length > 0) {
    console.warn('[geo-i18n] rendered error text is not presentable, falling back:', {
      code: error.code,
      problems,
    });
    return render(t, UNKNOWN_ERROR_KEY, {}) ?? UNKNOWN_ERROR_KEY;
  }
  return text;
}


/**
 * `CsvRowError` 的结构子集（`src/api/types.ts` 里 `CsvImportResult['errors']` 的元素）。
 *
 * 刻意**不**复用 `IpcRequestError`：它是个 class，`describeIpcError` 靠 `instanceof` 分流，
 * 而 CSV 行错误既没有 `code` 也不需要走那条阶梯。这里只认它真正有的三个字段。
 */
export interface CsvRowErrorLike {
  /** CSV 物理行号（表头为第 1 行）。 */
  row: number;
  /** `crates/geo-domain/src/error.rs` 目录表里的 reason key。 */
  reason: string;
  /** 该 reason 的配套参数；旧载荷可能整份缺失，读取处一律兜底成空对象。 */
  params?: Readonly<Record<string, string>>;
}

/**
 * 把一条 CSV 行错误渲染成当前语言的**一整行**（含「第 N 行」这个外壳）。
 *
 * 阶梯与 `describeIpcError` 的第 ③ 级同构，只是入口形状不同：
 *
 * 1. **CSV 族 code 级覆写优先**：查 `prompt.csv.reasons.<reason>`；
 * 2. **查不到才回落共享的 `errors.reasons.<reason>`**；
 * 3. 两边都查不到 ⇒ **raw passthrough**（原样显示 reason 记号，不静默变成兜底文案）；
 * 4. `params.value` 要不要追加由**同一份** `mayEchoParamValue()` allowlist 决定
 *    （fail-closed）——`not_allowed` 不在表里，所以命中的广告法红线词永远上不了屏，
 *    而 `invalid_format` 的 `value` 是用户填的原始单元格内容，照常显示；
 * 5. 出口过 Task 7b 那道**质量闸门**：`problemsOf()` 不合格 ⇒ `console.warn` 后回落
 *    `common.unknownError`，绝不把 `第 3 行：` 这种悬空外壳端给用户。
 *
 * 外壳也走词典（裁定 B-5）：zh 是「第 N 行：…」，en 是 `Row N: …`，语序不同，
 * 所以**不许**在组件里做字符串拼接。
 *
 * @param t 组件里 `useTranslation()` 拿到的那个 `t`；不要把结果缓存到 state 之外。
 */
export function describeCsvRowError(error: CsvRowErrorLike, t: TFunction): string {
  const reason = typeof error.reason === 'string' ? error.reason : '';

  // 顶层 `reason` 提升进 values：`CsvRowError.reason` 是**独立字段**，不在 params 里
  // （只有合规那一支因为原样透传 `GeoError::params()` 才恰好也带一个同名键）。
  // 不提升就喂不进 `renderReason`——它读的是 `params.reason`，而 `required` 这类 reason
  // 的 params 是**空 map**，照搬只会渲染成空串再被闸门打回兜底文案。
  const values = composeValues(t, CSV_ROW_CODE, { ...error.params, reason });
  const detail = values.reason;

  const text = render(t, CSV_ROW_KEY, { row: String(error.row), detail }) ?? detail;

  const problems = problemsOf(text);
  if (problems.length > 0) {
    console.warn('[geo-i18n] rendered CSV row error is not presentable, falling back:', {
      row: error.row,
      reason,
      problems,
    });
    return render(t, UNKNOWN_ERROR_KEY, {}) ?? UNKNOWN_ERROR_KEY;
  }
  return text;
}
