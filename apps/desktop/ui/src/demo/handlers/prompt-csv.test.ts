/**
 * M2 的两条 CSV 命令（`prompt_set_export_csv` / `prompt_set_import_csv`）的行为测试。
 *
 * 与 `prompt.test.ts` 的分工：那份管 set 级与条目级的 9 条，本文件只管**序列化往返**。
 *
 * # 本文件钉住的几件容易想当然的事（简报 §H，全部有 Rust 行号）
 * - **导出不带 BOM**：`prompt_service.rs:668-673` 专门把 `csv_io.rs:127` 加的 BOM 剥掉，
 *   BOM 只在写盘层 `ipc/export.rs:16-22` 补（且幂等）。demo 这层就是 service 层的替身 ⇒ **不加**。
 * - **导入要容忍 BOM**：`csv_io.rs:134` `strip_prefix('\u{FEFF}')`（Excel 存下来的 CSV 往往带）。
 * - **导入是整包替换**：`prompt_service.rs:699-700` `reindex` + `replace_items`，不是追加。
 * - **空导入要拒**：`prompt_service.rs:689-697`，`params` 必须是 `{}`（契约登记的 params 是空数组），
 *   行错误装进 **`detail`**（`demoError` 的第三个参）。
 * - **`source` 从列里解析**，不是强制 `imported`：`csv_io.rs:243-249`（空才是 `imported`）。
 * - **表头缺列 = 整批被拒**（不是行错误）：`csv_io.rs:154`，列名逐个 trim、顺序不敏感、多列容忍。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { PROMPT_CSV_HEADER } from '../../api/constants';
import type { CsvImportResult, IpcErrorPayload, PromptSet } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_BASELINE_SET_ID, SEED_PILOT_SET_ID } from '../seed/prompt-sets';

const BOM = '\uFEFF';
const PILOT_COUNT = 28;
const HEADER_LINE = PROMPT_CSV_HEADER.join(',');

async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

/** 收成契约 DTO 本身（不自己描一份形状，免得 `params` 可选这类细节两头漂）。 */
function payloadOf(cause: unknown): IpcErrorPayload {
  if (!isIpcErrorPayload(cause)) throw new Error('expected an IpcErrorPayload');
  return cause;
}

/** 手工拼一份最小 CSV（表头 + 若干行），避免测试依赖导出的实现细节。 */
function csv(...rows: string[]): string {
  return [HEADER_LINE, ...rows].join('\n');
}

async function exportCsv(id: string = SEED_PILOT_SET_ID): Promise<string> {
  return demoInvoke<string>('prompt_set_export_csv', { id });
}

async function importCsv(payload: string, id: string = SEED_PILOT_SET_ID): Promise<CsvImportResult> {
  return demoInvoke<CsvImportResult>('prompt_set_import_csv', { id, payload });
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/prompt-csv · prompt_set_export_csv', () => {
  it('表头逐字等于共享常量，行数 = 条目数 + 1，且**不带 BOM**', async () => {
    const body = await exportCsv();
    const lines = body.split('\n').filter((line) => line !== '');

    expect(body.startsWith(BOM)).toBe(false);
    expect(lines[0]).toBe(HEADER_LINE);
    expect(lines).toHaveLength(PILOT_COUNT + 1);
  });

  it('含逗号与引号的文本走引号转义（复用 shared.toCsv，不自己拼串）', async () => {
    await demoInvoke('prompt_item_add', {
      set_id: SEED_PILOT_SET_ID,
      items: [{ text: '含, 逗号与 "引号" 的问法', intent: 'pricing_plan' }],
    });

    const body = await exportCsv();

    expect(body).toContain('"含, 逗号与 ""引号"" 的问法"');
  });

  it('不存在的题库报 prompt_set/not_found', async () => {
    const cause = await capture(() => exportCsv('00000000-0000-4000-8000-0000000000c3'));

    expect(payloadOf(cause).code).toBe('prompt_set/not_found');
  });
});

describe('demo/handlers/prompt-csv · 往返一致性', () => {
  it('导出 → 导入：条目数一致，text/intent/weight 逐条相等', async () => {
    const body = await exportCsv(SEED_BASELINE_SET_ID);
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_BASELINE_SET_ID });

    const result = await importCsv(body, SEED_BASELINE_SET_ID);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(before.items.length);
    expect(result.items.map((item) => [item.text, item.intent, item.weight])).toEqual(
      before.items.map((item) => [item.text, item.intent, item.weight]),
    );
    // tags 也要往返（分隔符拼/拆对称，否则多标签会静默合并）。
    expect(result.items.map((item) => item.tags)).toEqual(before.items.map((item) => item.tags));
  });

  it('导入后 content_hash 变了（占位口径，但内容变它就必须变）', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });

    await importCsv(csv('只剩一条,category_awareness,5,,,,1'));

    const after = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(after.content_hash).not.toBe(before.content_hash);
    expect(after.content_hash.startsWith('demo-')).toBe(true);
  });
});

describe('demo/handlers/prompt-csv · prompt_set_import_csv 的替换语义', () => {
  it('整包替换（不是追加），position 从 **0** 连续重排', async () => {
    const result = await importCsv(
      csv('第一条,category_awareness,4,,,,1', '第二条,pricing_plan,2,,,,1'),
    );

    expect(result.items).toHaveLength(2);
    const stored = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(stored.items).toHaveLength(2);
    expect(stored.items.map((item) => item.position)).toEqual([0, 1]);
    // 旧条目全部丢弃，内存库里也不留孤儿。
    expect(getDemoDb().promptItems.filter((item) => item.set_id === SEED_PILOT_SET_ID)).toHaveLength(2);
  });

  it('带 BOM 与不带 BOM 的同一份 CSV 导入结果逐字相等', async () => {
    const body = csv('带 BOM 也要能导,local_service,3,,,,1');

    const plain = await importCsv(body);
    resetDemoDb();
    const withBom = await importCsv(`${BOM}${body}`);

    expect(withBom.errors).toEqual([]);
    expect(withBom.items.map((item) => item.text)).toEqual(plain.items.map((item) => item.text));
  });
});

describe('demo/handlers/prompt-csv · 表头校验（整批拒，不是行错误）', () => {
  it('缺列报 validation/failed，value 是逗号连接的缺失列名', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_set_import_csv', {
        id: SEED_PILOT_SET_ID,
        payload: 'text,intent\n一条,pricing_plan',
      }),
    );

    const error = payloadOf(cause);
    expect(error.code).toBe('validation/failed');
    expect(error.params).toEqual({
      field: 'csv_header',
      reason: 'missing_header',
      value: 'weight, group_name, tags, source, repeat_count',
    });
    // 整批被拒 ⇒ 题库一条也没动。
    const stored = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(stored.items).toHaveLength(PILOT_COUNT);
  });

  it('列名带空格、顺序不同、多一列都算合法（对齐 csv crate 的 flexible 口径）', async () => {
    const result = await demoInvoke<CsvImportResult>('prompt_set_import_csv', {
      id: SEED_PILOT_SET_ID,
      payload: ' repeat_count , extra ,text,intent,weight,group_name,tags,source\n1,x,一条,pricing_plan,4,,,,',
    });

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it('空载荷 = 7 列全缺 ⇒ 同样报 missing_header', async () => {
    const cause = await capture(() => importCsv(''));

    expect(payloadOf(cause).params).toEqual({
      field: 'csv_header',
      reason: 'missing_header',
      value: PROMPT_CSV_HEADER.join(', '),
    });
  });
});

describe('demo/handlers/prompt-csv · 行错误与默认值', () => {
  it('text 为空 ⇒ required（params 为空），且 row 是物理行号（表头为第 1 行）', async () => {
    const result = await importCsv(csv('好行,pricing_plan,3,,,,1', ' ,category_awareness,3,,,,1'));

    expect(result.items).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 3, reason: 'required', params: {} }]);
  });

  it('intent / source / weight 非法 ⇒ invalid_format + {value:原始串}', async () => {
    // 先放一条合法行：否则「全部行都非法」会先撞上 empty_import，行错误就看不到了。
    const result = await importCsv(
      csv(
        '合法行,pricing_plan,3,,,,1',
        '意图不存在,not_an_intent,3,,,,1',
        '来源不存在,pricing_plan,3,,,not_a_source,1',
        '权重不是数,pricing_plan,abc,,,,1',
      ),
    );

    expect(result.items).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 3, reason: 'invalid_format', params: { value: 'not_an_intent' } },
      { row: 4, reason: 'invalid_format', params: { value: 'not_a_source' } },
      { row: 5, reason: 'invalid_format', params: { value: 'abc' } },
    ]);
  });

  it('未闭合的引号 ⇒ row_invalid + {value}（ASCII 开发者串，不上屏）', async () => {
    // 未闭合的引号会吞掉它之后的全部内容（csv crate 也是这个行为）⇒ 必须放最后一行。
    const result = await importCsv(
      csv('合法行,pricing_plan,3,,,,1', '"没有闭合的引号,pricing_plan,3,,,,1'),
    );

    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toBe('row_invalid');
    expect(result.errors[0]!.row).toBe(3);
    // `value` 装的是解析器的开发者诊断串（Rust 侧装 csv 库原文）：一律 ASCII，不进词典。
    expect(result.errors[0]!.params?.value).toMatch(/^[\x20-\x7e]+$/);
  });

  it('空列落默认值：weight 3 · repeat_count 1 · source imported · group_name null', async () => {
    const result = await importCsv(csv('只填必填项,brand_comparison,,,,,'));

    expect(result.errors).toEqual([]);
    const [item] = result.items;
    expect(item?.weight).toBe(3);
    expect(item?.repeat_count).toBe(1);
    expect(item?.source).toBe('imported');
    // 后端会把空分组回填成 `intent.label_zh()`（`csv_io.rs:269-273`）；demo 不镜像那张中文表（简报 H-8）。
    expect(item?.group_name).toBeNull();
  });

  it('source 列非空时**照列里的值**落库（不是一律 imported）', async () => {
    const result = await importCsv(csv('模板来的,pricing_plan,3,,,template,1'));

    expect(result.items[0]?.source).toBe('template');
  });

  it('tags 按分号切、逐个 trim、丢空串', async () => {
    const result = await importCsv(csv('带标签,pricing_plan,3,, 核心词 ; ;选型 ,,1'));

    expect(result.items[0]?.tags).toEqual(['核心词', '选型']);
  });
});

describe('demo/handlers/prompt-csv · 空导入拒绝', () => {
  it('全部行都非法且现有题库非空 ⇒ prompt_set/empty_import，params 为 {}，行错误进 detail', async () => {
    const cause = await capture(() => importCsv(csv(' ,pricing_plan,3,,,,1')));

    const error = payloadOf(cause);
    expect(error.code).toBe('prompt_set/empty_import');
    // 契约给这个 code 登记的 params 是**空数组** ⇒ 一个键都不能加。
    expect(error.params).toEqual({});
    expect(error.detail).toEqual([{ row: 2, reason: 'required', params: {} }]);
    // 原题库一条也没动。
    const stored = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(stored.items).toHaveLength(PILOT_COUNT);
  });

  it('现有题库本来就是空的 ⇒ 不拒绝（拒绝需要**两个**条件同时成立）', async () => {
    // “空题库”在命令面上**不可达**：`prompt_item_delete` 不许删空（一次最多 N-1 条），
    // “要清空请显式删除整个快照”是产品纪律。所以这里直接清内存库来造前提（白盒，不是走后门）。
    const db = getDemoDb();
    db.promptItems = db.promptItems.filter((item) => item.set_id !== SEED_PILOT_SET_ID);
    const emptied = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(emptied.items).toHaveLength(0);

    const result = await importCsv(csv(' ,pricing_plan,3,,,,1'));

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, reason: 'required', params: {} }]);
  });
});
