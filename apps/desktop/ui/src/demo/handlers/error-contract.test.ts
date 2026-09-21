/**
 * demo 发出的错误 payload 与 `contracts/error-codes.json` 的**契约钉法**（Task 12 · 简报 §B-10）。
 *
 * # 为什么需要它
 * `demoError` **刻意不校验** `code` 与 `params`（校验要把契约表复制进前端 ⇒ 必漂），
 * 所以「params 键集写错了」这件事从前只靠复审席肉眼抓。M1 开始大量发
 * `validation/failed` / `*_not_found`，这里给它一个**机械执行者**。
 *
 * # 两层口径（简报 A-11，🔴 不是 `types.ts` 旧 JSDoc 说的「键集必须完全一致」）
 * ① **对契约（词表）**：发出的每个 `params` 键必须 ∈ 该 code 在契约里登记的 `params` 数组
 *    （**子集**关系。例：`validation/failed` 登记 5 个键，真实后端自己就只发 2~3 个）；
 * ② **对发射点（真值表）**：**精确键集**以 Rust 那一个发射点为准 —— A-4（domain 三种）、
 *    A-5（format_version / payload）、A-6（field_path 四种）、A-11（三个 not_found 都必带 `kind`）。
 *
 * # 怎么收集「demo 发出的每个 code」（非空洞的关键）
 * **不**正则扫源码（脆）。把 M1 + M2 的每条错误路径都**真的触发一遍**，catch 到 payload 后逐条比对
 * ⇒「发出去的」与「被钉的」是同一批对象。最后那条总扫用例还会断言收集到的 code 集合
 * **正好是** M1 会用到的那 4 个，证明触发面没有漏。
 *
 * ⚠ 本文件**不许**降级成「只断言 code 存在」，也**不许**为了过测试去改 `contracts/**`（禁改）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import catalogJson from '../../../../../../contracts/error-codes.json';
import { PROMPT_CSV_HEADER } from '../../api/constants';
import { isIpcErrorPayload } from '../../api/types';
import type { IpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_COMPETITOR_IDS, SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { SEED_PILOT_SET_ID } from '../seed/prompt-sets';

/** 清单条目的形状（照抄 `src/i18n/error-codes.test.ts` 的既有写法，不加 cast）。 */
interface ErrorCodeEntry {
  code: string;
  params: string[];
  note: string;
}

const catalog: { codes: ErrorCodeEntry[] } = catalogJson;

const MISSING_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
const MISSING_ROW_ID = '00000000-0000-4000-8000-0000000000bb';
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
const VALID_DOMAIN = 'https://demo.example.com';

interface Scenario {
  /** 用例名（ASCII：本目录非注释 CJK 必须为 0）。 */
  name: string;
  cmd: string;
  args: () => Record<string, unknown>;
  code: string;
  /** A-4 / A-5 / A-6 / A-11 真值表里那一行的**精确键集**。 */
  keys: string[];
}

const NOT_FOUND_KEYS = ['id', 'kind'];
const VALIDATION_2 = ['field', 'reason'];
const VALIDATION_3 = ['field', 'reason', 'value'];
/** `prompt_item_delete` 的「不许删空」那一支：`expected` 装 `<N`、`value` 装请求条数。 */
const VALIDATION_4 = ['expected', 'field', 'reason', 'value'];
/** `prompt_set/empty_import` 在契约里登记的 params 是**空数组** ⇒ 一个键都不许加。 */
const VALIDATION_0: string[] = [];

/** 小样本题库的全部条目 id（造「一次删光」这个前提用）。 */
function allPilotItemIds(): string[] {
  return getDemoDb()
    .promptItems.filter((item) => item.set_id === SEED_PILOT_SET_ID)
    .map((item) => item.id);
}

/** 一份表头合法、但唯一数据行 `text` 为空的 CSV（⇒ 0 条可导入）。 */
const EMPTY_IMPORT_CSV = `${PROMPT_CSV_HEADER.join(',')}\n ,pricing_plan,3,,,,1`;

const SCENARIOS: Scenario[] = [
  // ---- project/not_found：{kind:'project', id} 两个键都要（A-11）----
  {
    name: 'project_get on a missing project',
    cmd: 'project_get',
    args: () => ({ id: MISSING_PROJECT_ID }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'project_update on a missing project',
    cmd: 'project_update',
    args: () => ({ project: { ...getDemoDb().projects[0], id: MISSING_PROJECT_ID } }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'project_archive on a missing project',
    cmd: 'project_archive',
    args: () => ({ id: MISSING_PROJECT_ID, archived: true }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'project_export on a missing project',
    cmd: 'project_export',
    args: () => ({ id: MISSING_PROJECT_ID }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'project_export_competitors_csv on a missing project',
    cmd: 'project_export_competitors_csv',
    args: () => ({ id: MISSING_PROJECT_ID }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'project_export_assets_csv on a missing project',
    cmd: 'project_export_assets_csv',
    args: () => ({ id: MISSING_PROJECT_ID }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'entity_card_autobuild on a missing project (project check precedes domain check)',
    cmd: 'entity_card_autobuild',
    args: () => ({ project_id: MISSING_PROJECT_ID, domain: VALID_DOMAIN }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'competitor_upsert on a missing project',
    cmd: 'competitor_upsert',
    args: () => ({
      project_id: MISSING_PROJECT_ID,
      draft: { name: 'Rival A', aliases: [], website: null, note: null },
      id: null,
    }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'asset_add on a missing project',
    cmd: 'asset_add',
    args: () => ({
      project_id: MISSING_PROJECT_ID,
      kind: 'other',
      url: 'https://x.example.com',
      title: null,
      note: null,
    }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- competitor/not_found：{kind:'competitor', id} ----
  {
    name: 'competitor_upsert with an unknown competitor id',
    cmd: 'competitor_upsert',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: { name: 'Rival A', aliases: [], website: null, note: null },
      id: MISSING_ROW_ID,
    }),
    code: 'competitor/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'competitor_reorder with an id owned by another project',
    cmd: 'competitor_reorder',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [SEED_ACTIVE_COMPETITOR_IDS[0], MISSING_ROW_ID],
    }),
    code: 'competitor/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- entity_card/not_found：id 传的是 project_id（契约 note 明写）----
  {
    name: 'entity_card_update_field on a project without a card',
    cmd: 'entity_card_update_field',
    args: () => ({
      project_id: SEED_ARCHIVED_PROJECT_ID,
      path: 'price_range',
      value: 'POA',
      status: 'official',
      note: null,
    }),
    code: 'entity_card/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- validation/failed · domain（A-4 真值表，逐字抄自 Rust 契约测试）----
  {
    name: 'autobuild with a blank domain emits only field+reason',
    cmd: 'entity_card_autobuild',
    args: () => ({ project_id: SEED_ACTIVE_PROJECT_ID, domain: '   ' }),
    code: 'validation/failed',
    keys: VALIDATION_2,
  },
  {
    name: 'autobuild with a non-domain emits field+reason+value',
    cmd: 'entity_card_autobuild',
    // Rust 契约测试用的是中文输入；本目录非注释 CJK 必须为 0 ⇒ 换成同分支的 ASCII 输入。
    args: () => ({ project_id: SEED_ACTIVE_PROJECT_ID, domain: 'localhost' }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },
  {
    name: 'autobuild with a disallowed scheme emits value=scheme only',
    cmd: 'entity_card_autobuild',
    args: () => ({ project_id: SEED_ACTIVE_PROJECT_ID, domain: 'ftp://x.example' }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },

  // ---- validation/failed · field_path（A-6 真值表的四种情形）----
  {
    name: 'update_field with a blank path emits only field+reason',
    cmd: 'entity_card_update_field',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: '   ',
      value: 'x',
      status: 'official',
      note: null,
    }),
    code: 'validation/failed',
    keys: VALIDATION_2,
  },
  {
    name: 'update_field with a non-numeric subscript emits value=that chunk',
    cmd: 'entity_card_update_field',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'products[x].name',
      value: 'x',
      status: 'official',
      note: null,
    }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },
  {
    name: 'update_field with a leading subscript emits value=the whole path',
    cmd: 'entity_card_update_field',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: '[0].name',
      value: 'x',
      status: 'official',
      note: null,
    }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },
  {
    name: 'update_field with a root outside ALL_FIELDS emits value=that root',
    cmd: 'entity_card_update_field',
    args: () => ({
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'nope',
      value: 'x',
      status: 'official',
      note: null,
    }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },

  // ---- validation/failed · 导入（A-5）----
  {
    name: 'project_import with a mismatched format_version',
    cmd: 'project_import',
    args: () => ({ payload: '{"format_version":"v0","project":{}}' }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },
  {
    name: 'project_import with a payload that is not JSON',
    cmd: 'project_import',
    args: () => ({ payload: '{not json' }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },

  // ---- M2：prompt_set/not_found 五个发射点都必带 kind（A-11）----
  {
    name: 'prompt_set_get on a missing prompt set',
    cmd: 'prompt_set_get',
    args: () => ({ id: MISSING_ROW_ID }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_set_rename on a missing prompt set',
    cmd: 'prompt_set_rename',
    args: () => ({ id: MISSING_ROW_ID, label: 'x' }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_set_delete on a missing prompt set',
    cmd: 'prompt_set_delete',
    args: () => ({ id: MISSING_ROW_ID }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_set_dedupe on a missing prompt set',
    cmd: 'prompt_set_dedupe',
    args: () => ({ id: MISSING_ROW_ID }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_set_export_csv on a missing prompt set',
    cmd: 'prompt_set_export_csv',
    args: () => ({ id: MISSING_ROW_ID }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  // 导入那侧 requirePromptSet 先跑：题库不存在时**一份 CSV 都不解析**（空载荷也不报缺表头）。
  {
    name: 'prompt_set_import_csv on a missing prompt set',
    cmd: 'prompt_set_import_csv',
    args: () => ({ id: MISSING_ROW_ID, payload: '' }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_item_add on a missing prompt set',
    cmd: 'prompt_item_add',
    args: () => ({ set_id: MISSING_ROW_ID, items: [{ text: 'x', intent: 'pricing_plan' }] }),
    code: 'prompt_set/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- M2：prompt_item/not_found 两个发射点 ----
  {
    name: 'prompt_item_update on a missing item',
    cmd: 'prompt_item_update',
    args: () => ({
      item: { id: MISSING_ROW_ID, set_id: SEED_PILOT_SET_ID, text: 'x', intent: 'pricing_plan' },
    }),
    code: 'prompt_item/not_found',
    keys: NOT_FOUND_KEYS,
  },
  {
    name: 'prompt_item_delete with an id outside the set',
    cmd: 'prompt_item_delete',
    args: () => ({ set_id: SEED_PILOT_SET_ID, ids: [MISSING_ROW_ID] }),
    code: 'prompt_item/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- M2：生成命令经 requireProject，报的是 project/not_found ----
  {
    name: 'prompt_set_generate on a missing project',
    cmd: 'prompt_set_generate',
    args: () => ({ project_id: MISSING_PROJECT_ID, options: {} }),
    code: 'project/not_found',
    keys: NOT_FOUND_KEYS,
  },

  // ---- M2：validation/failed 的四个发射点（键集分别是 2 / 2 / 2 / 4 个）----
  {
    name: 'prompt_set_rename with a blank label',
    cmd: 'prompt_set_rename',
    args: () => ({ id: SEED_PILOT_SET_ID, label: '   ' }),
    code: 'validation/failed',
    keys: VALIDATION_2,
  },
  {
    name: 'prompt_item_add with an empty items array',
    cmd: 'prompt_item_add',
    args: () => ({ set_id: SEED_PILOT_SET_ID, items: [] }),
    code: 'validation/failed',
    keys: VALIDATION_2,
  },
  {
    name: 'prompt_item_delete with an empty ids array',
    cmd: 'prompt_item_delete',
    args: () => ({ set_id: SEED_PILOT_SET_ID, ids: [] }),
    code: 'validation/failed',
    keys: VALIDATION_2,
  },
  {
    name: 'prompt_item_delete that would empty the whole set',
    cmd: 'prompt_item_delete',
    args: () => ({ set_id: SEED_PILOT_SET_ID, ids: allPilotItemIds() }),
    code: 'validation/failed',
    keys: VALIDATION_4,
  },
  {
    name: 'prompt_set_import_csv with a missing header column',
    cmd: 'prompt_set_import_csv',
    args: () => ({ id: SEED_PILOT_SET_ID, payload: 'text,intent\nx,pricing_plan' }),
    code: 'validation/failed',
    keys: VALIDATION_3,
  },

  // ---- M2：空导入拒绝，params 必须是空对象（契约登记的是空数组）----
  {
    name: 'prompt_set_import_csv where every row fails',
    cmd: 'prompt_set_import_csv',
    args: () => ({ id: SEED_PILOT_SET_ID, payload: EMPTY_IMPORT_CSV }),
    code: 'prompt_set/empty_import',
    keys: VALIDATION_0,
  },
];

/** 触发一条错误路径并交出 payload；路径没报错就是本文件自己的缺陷（不许静默绿）。 */
async function emit(scenario: Scenario): Promise<IpcErrorPayload> {
  const cause: unknown = await demoInvoke(scenario.cmd, scenario.args()).then(
    () => null,
    (error: unknown) => error,
  );
  expect(cause, `${scenario.name}: expected a rejection`).not.toBeNull();
  expect(isIpcErrorPayload(cause), `${scenario.name}: expected IpcErrorPayload`).toBe(true);
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  return cause;
}

function vocabularyOf(code: string): string[] {
  const entry = catalog.codes.find((item) => item.code === code);
  expect(entry, `${code} must be registered in contracts/error-codes.json`).toBeDefined();
  return entry?.params ?? [];
}

beforeEach(() => {
  resetDemoDb();
});

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers · 错误契约第 2 层：发射点的精确键集（A-4 / A-5 / A-6 / A-11）', () => {
  it.each(SCENARIOS)('$name', async (scenario) => {
    const payload = await emit(scenario);

    expect(payload.code).toBe(scenario.code);
    // 精确键集：多一个少一个都算违约（词典插值会出空洞 / 或塞进契约外的键）。
    expect(Object.keys(payload.params ?? {}).sort()).toEqual([...scenario.keys].sort());
  });
});

describe('demo/handlers · 错误契约第 1 层：发出的键必须落在契约词表里', () => {
  it('五个 not_found 都带 kind，且 kind 恒为契约 note 里写死的那个值', async () => {
    const expectations: [string, string, string][] = [
      ['project_get', 'project', MISSING_PROJECT_ID],
      ['entity_card_update_field', 'entity_card', SEED_ARCHIVED_PROJECT_ID],
      ['competitor_upsert', 'competitor', MISSING_ROW_ID],
      ['prompt_set_get', 'prompt_set', MISSING_ROW_ID],
      ['prompt_item_delete', 'prompt_item', MISSING_ROW_ID],
    ];
    const argsOf: Record<string, () => Record<string, unknown>> = {
      project_get: () => ({ id: MISSING_PROJECT_ID }),
      // ⚠ 契约 note 明写：这条的 `id` 传的是 **project_id**，不是卡自己的 id。
      entity_card_update_field: () => ({
        project_id: SEED_ARCHIVED_PROJECT_ID,
        path: 'price_range',
        value: 'x',
        status: 'official',
        note: null,
      }),
      competitor_upsert: () => ({
        project_id: SEED_ACTIVE_PROJECT_ID,
        draft: { name: 'Rival A', aliases: [], website: null, note: null },
        id: MISSING_ROW_ID,
      }),
      prompt_set_get: () => ({ id: MISSING_ROW_ID }),
      // ⚠ 这一支报的是**条目**不存在（id 是 prompt_item 的），不是题库不存在。
      prompt_item_delete: () => ({ set_id: SEED_PILOT_SET_ID, ids: [MISSING_ROW_ID] }),
    };

    for (const [cmd, kind, id] of expectations) {
      const scenario = SCENARIOS.find((item) => item.name.includes(cmd));
      expect(scenario, `scenario for ${cmd}`).toBeDefined();
      const payload = await emit({
        name: cmd,
        cmd,
        args: argsOf[cmd],
        code: `${kind}/not_found`,
        keys: NOT_FOUND_KEYS,
      });

      expect(payload.params).toEqual({ kind, id });
    }
  });

  it('总扫：把每条错误路径全部触发一遍，逐条比对契约词表，并证明触发面没有漏', async () => {
    // 条数写死在这里而不是标题里：将来加一条路径必须同时改这个数，改不动就是没真的加。
    expect(SCENARIOS).toHaveLength(37);
    const payloads = await Promise.all(SCENARIOS.map((scenario) => emit(scenario)));

    expect(payloads).toHaveLength(SCENARIOS.length);
    const codes = [...new Set(payloads.map((payload) => payload.code))].sort();
    // 触发面自查：M1 + M2 会用到的 code 就这 7 个（A-11 的表 + M2 的两个 not_found 与空导入），
    // 少了说明本文件有路径没真的触发。
    expect(codes).toEqual([
      'competitor/not_found',
      'entity_card/not_found',
      'project/not_found',
      'prompt_item/not_found',
      'prompt_set/empty_import',
      'prompt_set/not_found',
      'validation/failed',
    ]);

    for (const payload of payloads) {
      // ① code 必须在契约里（43 条冻结清单）。
      const vocabulary = vocabularyOf(payload.code);
      const params = payload.params ?? {};
      // ② 发出的每个键都 ∈ 该 code 登记的词表（**子集**，不是相等）。
      for (const key of Object.keys(params)) {
        expect(vocabulary, `${payload.code} does not register param "${key}"`).toContain(key);
      }
      // params 的值一律是字符串（DTO 是 Record<string, string>）。
      for (const value of Object.values(params)) {
        expect(typeof value).toBe('string');
      }
      // message 是语言中立的紧凑串：以 code 开头、不含 CJK（AGENTS 规则 7）。
      expect(payload.message.startsWith(payload.code)).toBe(true);
      expect(payload.message).not.toMatch(CJK);
      // 键按字典序拼接（与后端 IpcError::with_params 的 BTreeMap 排序同构）。
      const expectedMessage = Object.keys(params)
        .sort()
        .reduce((acc, key) => `${acc} ${key}=${params[key]}`, payload.code);
      expect(payload.message).toBe(expectedMessage);
    }

    // 词表本身没被本轮改动（contracts/** 禁改）：validation/failed 仍是那 5 个键。
    expect(vocabularyOf('validation/failed')).toEqual([
      'expected',
      'field',
      'limit',
      'reason',
      'value',
    ]);
  });

  it('每条错误路径都不许改动库（失败的调用没有副作用）', async () => {
    // `structuredClone` + `toEqual` 而不是 `JSON.stringify` 比对：后者会丢掉值为 `undefined` 的键、
    // 也分不清 `Date` 与它的字符串形态 ⇒ 一旦 Task 14 往库里塞非纯 JSON 的值，这条哨兵会**静默变弱**。
    const before = structuredClone(getDemoDb());

    for (const scenario of SCENARIOS) {
      await emit(scenario);
    }

    expect(getDemoDb()).toEqual(before);
  });
});
