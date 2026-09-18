/**
 * `contracts/error-codes.json` 是前后端**共享**的错误码真值源（spec §4.2 / Plan A Task 1）：
 * 后端只回 `code + params`，文案由前端词典按 locale 渲染，所以「后端会发出哪些 code」
 * 必须是一份清单，两侧都拿它做完整性断言。
 *
 * Rust 侧的对应断言在 `apps/desktop/src-tauri/src/error.rs` 的
 * `catalog_*` 三个用例里（用 `include_str!` 读同一个文件）。
 * 本文件只管**形状与导入**：Task 7 才会在这里补「每个 code 在 zh/en 词典里都有条目」。
 */
import { describe, expect, it } from 'vitest';

// 清单在仓库根的 `contracts/`，从 `apps/desktop/ui/src/i18n/` 上去是 5 层。
// Vite 的 root 是 `apps/desktop/ui`，仓库根有 `.git`，因此该路径落在
// Vite 的 workspace allow 范围内，可以直接以相对路径导入（无需 /@fs/）。
import catalogJson from '../../../../../contracts/error-codes.json';

/** 清单条目的形状，与 Rust 侧断言的字段一一对应。 */
interface ErrorCodeEntry {
  code: string;
  params: string[];
  note: string;
}

const catalog: { codes: ErrorCodeEntry[] } = catalogJson;

/** 小写命名空间，至少一段斜杠：`validation/failed`、`upstream/llm/server`。 */
const CODE_SHAPE = /^[a-z_]+(?:\/[a-z_]+)+$/;
/** param 名一律 snake_case，语言中立。 */
const PARAM_SHAPE = /^[a-z][a-z_]*$/;

describe('contracts/error-codes.json', () => {
  it('能作为 JSON 模块导入，codes 是非空数组', () => {
    expect(Array.isArray(catalog.codes)).toBe(true);
    expect(catalog.codes.length).toBeGreaterThan(0);
  });

  it('每条都有非空 code、params 数组与非空 note', () => {
    for (const entry of catalog.codes) {
      expect(entry.code, `code 要是非空字符串：${JSON.stringify(entry)}`).toMatch(CODE_SHAPE);
      expect(Array.isArray(entry.params), `${entry.code} 的 params 必须是数组`).toBe(true);
      for (const param of entry.params) {
        expect(param, `${entry.code} 的 param 名要是 snake_case`).toMatch(PARAM_SHAPE);
      }
      expect(entry.note, `${entry.code} 缺 note`).not.toBe('');
      expect(typeof entry.note, `${entry.code} 的 note 要是字符串`).toBe('string');
    }
  });

  it('code 不重复，且按升序排列便于 review diff', () => {
    const codes = catalog.codes.map((entry) => entry.code);
    expect(new Set(codes).size, '清单里有重复 code').toBe(codes.length);
    expect(codes, '清单要按 code 升序排列').toEqual([...codes].sort());
  });

  it('后端已有发射点的代表 code 都在清单里（与 Rust 侧同一批用例）', () => {
    const known = new Set(catalog.codes.map((entry) => entry.code));
    const expected = [
      'validation/failed',
      'project/not_found',
      'entity_card/not_found',
      'prompt_set/not_found',
      'prompt_item/not_found',
      'competitor/not_found',
      'state/conflict',
      'config/invalid',
      'data/invalid',
      'io/failed',
      'llm/missing_secret',
      'crawler/timeout',
      'compliance/violation',
      'prompt_set/empty_import',
      'upstream/llm/server',
      'upstream/crawler/timeout',
    ];
    for (const code of expected) {
      expect(known.has(code), `${code} 不在 contracts/error-codes.json 里`).toBe(true);
    }
  });

  it('前端专用的 ipc code 已预留（Rust 侧暂无发射点，属预期）', () => {
    const known = new Set(catalog.codes.map((entry) => entry.code));
    // ipc/unknown 是 IpcRequestError 在 payload.code 为空串时的兜底（api/client.ts）
    for (const code of [
      'ipc/internal',
      'ipc/invoke_failed',
      'ipc/unknown',
      'ipc/unknown_command',
    ]) {
      expect(known.has(code), `${code} 不在 contracts/error-codes.json 里`).toBe(true);
    }
  });
});
