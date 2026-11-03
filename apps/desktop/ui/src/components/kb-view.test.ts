/**
 * `components/kb-view.ts`（M1.2b 界面行模型）的单元测试。
 *
 * 同步块退役后这里证四件事：
 * ① `toKbRows` 的字段改名与顺序保持；
 * ② `groupByModule` 按 `KB_MODULE_VALUES` 的序、空模块不回；
 * ③ `groupByScenario` 按 `KB_SCENARIO_VALUES` 的序、`scenario === null` 进垫底桶（DR-75 / DR-78）；
 * ④ `isMediaKind` / `isScriptModule` 两个渲染分叉的判据。
 */
import { describe, expect, it } from 'vitest';

import type { KbEntry } from '../api/types';
import {
  groupByModule,
  groupByScenario,
  isMediaKind,
  isScriptModule,
  toKbRows,
  type KbRow,
} from './kb-view';

function entry(partial: Partial<KbEntry> & Pick<KbEntry, 'id' | 'module'>): KbEntry {
  return {
    project_id: 'p1',
    kind: 'statement',
    title: partial.id ?? 'x',
    body_markdown: 'body',
    url: null,
    mime: null,
    tags: [],
    status: 'approved',
    source: 'manual',
    scenario: null,
    verified_at: null,
    position: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...partial,
  };
}

function row(partial: Partial<KbRow> & Pick<KbRow, 'id' | 'module'>): KbRow {
  return {
    kind: 'statement',
    scenario: null,
    title: partial.id ?? 'x',
    body: 'body',
    url: null,
    mime: null,
    tags: [],
    status: 'approved',
    source: 'manual',
    verifiedAt: null,
    updatedAt: '2026-09-01T00:00:00Z',
    position: 0,
    ...partial,
  };
}

describe('toKbRows', () => {
  it('字段改名 snake → camel，顺序保持传入序', () => {
    const rows = toKbRows([
      entry({ id: 'a', module: 'brand', verified_at: '2026-09-02T00:00:00Z', position: 3 }),
      entry({ id: 'b', module: 'tone', body_markdown: 'zh', position: 1 }),
    ]);
    expect(rows.map((item) => item.id)).toEqual(['a', 'b']);
    expect(rows[0].verifiedAt).toBe('2026-09-02T00:00:00Z');
    expect(rows[1].body).toBe('zh');
  });

  it('tags 是拷贝不是引用：改行不影响条目', () => {
    const source = entry({ id: 'a', module: 'brand', tags: ['x'] });
    const [first] = toKbRows([source]);
    first.tags.push('y');
    expect(source.tags).toEqual(['x']);
  });
});

describe('groupByModule', () => {
  it('模块序 = KB_MODULE_VALUES 的序；空模块不回；组内 position ASC', () => {
    const groups = groupByModule([
      row({ id: 't2', module: 'tone', position: 5 }),
      row({ id: 't1', module: 'tone', position: 2 }),
      row({ id: 'b1', module: 'brand', position: 9 }),
    ]);
    expect(groups.map((group) => group.module)).toEqual(['brand', 'tone']);
    expect(groups[1].rows.map((item) => item.id)).toEqual(['t1', 't2']);
  });
});

describe('groupByScenario', () => {
  it('场景序 = KB_SCENARIO_VALUES 的序；null 进垫底桶', () => {
    const groups = groupByScenario([
      row({ id: 'loose', module: 'sales_script', scenario: null }),
      row({ id: 'quote', module: 'sales_script', scenario: 'sales_quote' }),
      row({ id: 'first', module: 'sales_script', scenario: 'sales_first_contact' }),
    ]);
    expect(groups.map((group) => group.scenario)).toEqual([
      'sales_first_contact',
      'sales_quote',
      null,
    ]);
  });

  it('空场景桶在没有 null 行时不出现', () => {
    const groups = groupByScenario([
      row({ id: 'a', module: 'support_script', scenario: 'support_presale' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].scenario).toBe('support_presale');
  });
});

describe('渲染分叉判据', () => {
  it('媒体三档 / 话术两模块', () => {
    expect(isMediaKind('image')).toBe(true);
    expect(isMediaKind('video')).toBe(true);
    expect(isMediaKind('file')).toBe(true);
    expect(isMediaKind('statement')).toBe(false);
    expect(isMediaKind('link')).toBe(false);
    expect(isScriptModule('sales_script')).toBe(true);
    expect(isScriptModule('support_script')).toBe(true);
    expect(isScriptModule('brand')).toBe(false);
  });
});
