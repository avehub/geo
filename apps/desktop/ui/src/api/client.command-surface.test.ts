/**
 * 命令面契约（Plan C 前置门禁）：
 * `contracts/ipc-command-surface.json` 是「Rust 已注册」与「仍待落地」的唯一清单。
 *
 * 关系式（两侧合起来才是完整门禁）：
 * - 本文件：`IPC_COMMANDS` == `rust_registered` ∪ `pending`，且 `rust_registered` 的条数与
 *   `generate_handler![]` 相等（Rust 侧另有 `tests/contract_surface.rs` 逐条比对源码）；
 * - Rust 侧：`generate_handler![]` == `rust_registered`。
 *
 * 🔴 为什么不是直接全等：今天仍有 12 条 demo-only 命令，直接做全等会红。
 * allowlist 的意义是**只减不增**——每转正一条就从 `pending` 删除一条，差集永远等于台账里的待办。
 */
import { describe, expect, it } from 'vitest';

import surfaceJson from '../../../../../contracts/ipc-command-surface.json';
import { IPC_COMMANDS } from './client';

interface PendingCommand {
  command: string;
  ledger: string;
}

interface CommandSurface {
  note: string;
  rust_registered: string[];
  pending: PendingCommand[];
}

const surface = surfaceJson as CommandSurface;

describe('contracts/ipc-command-surface.json', () => {
  it('清单形状正确：rust_registered 非空、pending 非空、note 说明用途', () => {
    expect(Array.isArray(surface.rust_registered)).toBe(true);
    expect(surface.rust_registered.length).toBeGreaterThan(0);
    expect(Array.isArray(surface.pending)).toBe(true);
    expect(surface.pending.length).toBeGreaterThan(0);
    expect(surface.note.trim()).not.toBe('');
  });

  it('rust_registered 与 pending 都是精确清单：无重复、互不相交', () => {
    const rust = surface.rust_registered;
    const pending = surface.pending.map((entry) => entry.command);
    expect(new Set(rust).size, 'rust_registered 有重复').toBe(rust.length);
    expect(new Set(pending).size, 'pending 有重复').toBe(pending.length);

    const overlap = rust.filter((command) => pending.includes(command));
    expect(overlap, '同一条命令不能同时出现在两栏').toEqual([]);
  });

  it('两侧并集与 IPC_COMMANDS 完全相等（不多不少）', () => {
    const declared = [...surface.rust_registered, ...surface.pending.map((entry) => entry.command)];
    expect(new Set(IPC_COMMANDS), 'IPC_COMMANDS 与契约清单不一致').toEqual(new Set(declared));
    expect(IPC_COMMANDS).toHaveLength(105);
    expect(surface.rust_registered).toHaveLength(93);
    expect(surface.pending).toHaveLength(12);
  });

  it('每条待落地命令都带台账编号（形如 E-33），且编号在已知集合内', () => {
    const knownLedgers = new Set(['E-33', 'E-46', 'E-52', 'E-55', 'E-60', 'E-61', 'E-64', 'E-67']);
    for (const entry of surface.pending) {
      expect(entry.ledger, `${entry.command} 缺台账编号`).toMatch(/^E-\d+$/);
      expect(knownLedgers.has(entry.ledger), `${entry.command} 的台账编号不在已知集合：${entry.ledger}`).toBe(true);
    }
  });

  it('待落地命令按功能族与台账一致（防止复制粘贴时串号）', () => {
    const familyLedger: Array<[RegExp, string]> = [
      [/^(collection_|insight_|fact_check_|diagnosis_|action_|content_|report_)/, 'E-33'],
      [/^(app_environment|llm_models_list)$/, 'E-46'],
      [/^(keyword_|faq_)/, 'E-52'],
      [/^site_/, 'E-55'],
      [/^kb_/, 'E-60'],
      [/^article_/, 'E-64'],
      [/^search_/, 'E-67'],
    ];
    for (const entry of surface.pending) {
      const match = familyLedger.find(([pattern]) => pattern.test(entry.command));
      expect(match, `${entry.command} 不属于任何已知功能族`).toBeDefined();
      expect(entry.ledger, `${entry.command} 的台账应为 ${match![1]}`).toBe(match![1]);
    }
  });
});
