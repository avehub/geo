/**
 * `components/kb-import.ts`（DR-81 导入草稿组装）的单元测试。
 *
 * 证五件事：
 * ① 实体卡七字段的映射表（模块 / 形式 / 空值跳过）；
 * ② 状态映射：`official` → approved，其余 → pending_review；项目来源恒 pending_review；
 * ③ 项目侧三组（竞品 / 渠道资产 / 行业地域标签画像）；
 * ④ 标题查词典（zh / en 两侧都要是人话，不是裸 key）；
 * ⑤ `toImportDrafts` 带 `source: 'imported'` 且状态随行。
 */
import { describe, expect, it } from 'vitest';

import type { EntityCard, FieldStatus, ProjectDetail } from '../api/types';
import { i18n } from '../i18n';
import { buildImportRows, toImportDrafts } from './kb-import';

const ZH = i18n.getFixedT('zh-CN');
const EN = i18n.getFixedT('en-US');

function card(fields: Partial<EntityCard['fields']>, status: Record<string, FieldStatus> = {}): EntityCard {
  return {
    project_id: 'p1',
    fields: {
      standard_name: '',
      aliases: [],
      founded_year: null,
      qualifications: [],
      products: [],
      service_regions: [],
      contact: { phone: null, email: null, address: null },
      ...fields,
    },
    field_status: status,
    source: { crawled_pages: [], llm_provider: null, llm_model: null, generated_at: null },
    completeness: 1,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

function detail(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: {
      id: 'p1',
      name: 'demo project',
      brand_name: 'demo',
      aliases: [],
      website: null,
      region: 'jiangsu',
      language: 'zh_cn',
      industry: 'b2b_manufacturing',
      industry_label: 'B2B manufacturing',
      tags: ['tag-a'],
      status: 'active',
      archived_at: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    entity_card: null,
    competitors: [],
    assets: [],
    prompt_set_count: 0,
    ...partial,
  };
}

describe('实体卡映射', () => {
  it('七字段逐字映射；空值跳过', () => {
    const rows = buildImportRows(
      detail({
        entity_card: card({
          standard_name: 'Suzhou Lanzhou Co.',
          aliases: ['LZ', 'Lanzhou'],
          founded_year: 2019,
          qualifications: ['ISO 9001'],
          products: [{ name: 'bag filter', params: ['x'], note: null }],
          service_regions: ['Jiangsu'],
          contact: { phone: '0512', email: null, address: null },
        }),
      }),
      ZH,
      '、',
    ).filter((row) => row.group === 'entity');
    expect(rows.map((row) => row.key)).toEqual([
      'entity:standard_name',
      'entity:aliases',
      'entity:founded_year',
      'entity:qualifications',
      'entity:products[0]',
      'entity:service_regions',
      'entity:contact',
    ]);
    expect(rows.map((row) => row.module)).toEqual([
      'brand',
      'brand',
      'brand',
      'qualification',
      'product',
      'audience',
      'brand',
    ]);
    expect(rows[1].body).toBe('LZ、Lanzhou');
    expect(rows[2].body).toBe('2019');
    expect(rows[4].title).toBe('bag filter');
  });

  it('空卡一行都不进口', () => {
    const rows = buildImportRows(detail({ entity_card: card({}) }), ZH, '、');
    expect(rows.filter((row) => row.group === 'entity')).toEqual([]);
  });

  it('标题查词典：zh / en 都是人话（不是裸 key）', () => {
    const withName = detail({ entity_card: card({ standard_name: 'X' }) });
    const zh = buildImportRows(withName, ZH, '、')[0];
    const en = buildImportRows(withName, EN, ', ')[0];
    expect(zh.title).toBe('标准名');
    expect(en.title).toBe('Standard name');
  });
});

describe('状态映射（DR-81）', () => {
  it('official → approved；pending / disputed / 项目来源 → pending_review', () => {
    const rows = buildImportRows(
      detail({
        entity_card: card(
          { standard_name: 'X', aliases: ['a'], qualifications: ['q'] },
          { standard_name: 'official', aliases: 'disputed' },
        ),
        competitors: [{ id: 'c1', project_id: 'p1', name: 'Rival', aliases: [], website: null, note: null, position: 0, created_at: '2026-09-01T00:00:00Z' }],
      }),
      ZH,
      '、',
    );
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get('entity:standard_name')?.status).toBe('approved');
    expect(byKey.get('entity:aliases')?.status).toBe('pending_review');
    expect(byKey.get('entity:qualifications')?.status).toBe('pending_review');
    expect(byKey.get('project:competitors[0]')?.status).toBe('pending_review');
  });
});

describe('项目侧映射', () => {
  it('竞品 / 渠道资产 / 画像三组；空值跳过', () => {
    const rows = buildImportRows(
      detail({
        competitors: [
          { id: 'c1', project_id: 'p1', name: 'Rival', aliases: ['R'], website: 'https://r.example.com', note: 'low price', position: 0, created_at: '2026-09-01T00:00:00Z' },
        ],
        assets: [
          { id: 'a1', project_id: 'p1', kind: 'owned_page', url: 'https://p.example.com', title: 'official page', note: null, created_at: '2026-09-01T00:00:00Z' },
        ],
      }),
      ZH,
      '、',
    ).filter((row) => row.group === 'project');
    expect(rows.map((row) => row.key)).toEqual([
      'project:competitors[0]',
      'project:assets[0]',
      'project:profile',
    ]);
    expect(rows[0].module).toBe('competitor');
    expect(rows[0].kind).toBe('link');
    expect(rows[0].url).toBe('https://r.example.com');
    expect(rows[0].body).toBe('R\nlow price');
    expect(rows[1].module).toBe('media');
    expect(rows[2].module).toBe('audience');
    expect(rows[2].body).toContain('B2B manufacturing');
    expect(rows[2].body).toContain('tag-a');
  });

  it('没有实体卡也没有项目内容时回空清单（Modal 显示 empty 文案）', () => {
    const rows = buildImportRows(
      { ...detail(), project: { ...detail().project, industry_label: null, tags: [] , region: ''} },
      ZH,
      '、',
    );
    expect(rows).toEqual([]);
  });
});

describe('toImportDrafts', () => {
  it('草稿带 source imported 与随行状态；scenario 恒 null', () => {
    const rows = buildImportRows(
      detail({ entity_card: card({ standard_name: 'X' }, { standard_name: 'official' }) }),
      ZH,
      '、',
    );
    const drafts = toImportDrafts(rows.filter((row) => row.group === 'entity'));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].source).toBe('imported');
    expect(drafts[0].status).toBe('approved');
    expect(drafts[0].scenario).toBeNull();
    expect(drafts[0].module).toBe('brand');
  });
});
