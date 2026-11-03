/**
 * `api/kb-compose.ts`（导出组装，DR-72 续）的单元测试。
 *
 * M1.2b 后闸门只剩一道（DR-73）：**只有 `status === 'approved'` 的行进产物**。
 * 同步块退役 ⇒ 不再有 `field_status === 'disputed'` 那一支，也不再有 synced 行混进导出。
 * 其余照旧：零条可交付 → `null`（界面置灰）；Markdown 与 JSON 两种产物；文件名 ASCII。
 */
import { describe, expect, it } from 'vitest';

import type { TFunction } from 'i18next';

import { i18n } from '../i18n';
import {
  composeKbJson,
  composeKbMarkdown,
  exportableRows,
  isExportable,
  kbJsonFileName,
  kbMarkdownFileName,
  type KbJsonPack,
} from './kb-compose';
import type { KbRow } from '../components/kb-view';

const t = i18n.getFixedT('zh-CN') as TFunction;

function row(partial: Partial<KbRow> & Pick<KbRow, 'id'>): KbRow {
  return {
    module: 'brand',
    kind: 'statement',
    scenario: null,
    title: partial.id,
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

describe('闸门', () => {
  it('只有 approved 进产物；pending_review / rejected 一律拦下', () => {
    expect(isExportable(row({ id: 'a', status: 'approved' }))).toBe(true);
    expect(isExportable(row({ id: 'b', status: 'pending_review' }))).toBe(false);
    expect(isExportable(row({ id: 'c', status: 'rejected' }))).toBe(false);
  });

  it('导入来源的行同样只看审核态（source 不参与闸门）', () => {
    expect(isExportable(row({ id: 'd', source: 'imported', status: 'approved' }))).toBe(true);
    expect(isExportable(row({ id: 'e', source: 'imported', status: 'pending_review' }))).toBe(false);
  });

  it('exportableRows 保持顺序', () => {
    const kept = exportableRows([
      row({ id: 'a', status: 'pending_review' }),
      row({ id: 'b' }),
      row({ id: 'c', status: 'rejected' }),
    ]);
    expect(kept.map((item) => item.id)).toEqual(['b']);
  });
});

describe('composeKbMarkdown', () => {
  it('零条可交付 → null（界面据此置灰）', () => {
    expect(composeKbMarkdown([row({ id: 'a', status: 'pending_review' })], t, 'T', 'N')).toBeNull();
    expect(composeKbMarkdown([], t, 'T', 'N')).toBeNull();
  });

  it('statement 走引用块、模块按 taxonomy v2 的标签分节', () => {
    const md = composeKbMarkdown(
      [
        row({ id: 'claim', module: 'selling_point', body: 'one line' }),
        row({ id: 'note', module: 'sales_script', kind: 'text', body: 'plain' }),
      ],
      t,
      '品牌知识库',
      'note line',
    );
    expect(md).toContain('# 品牌知识库');
    expect(md).toContain('## 产品卖点');
    expect(md).toContain('## 销售话术');
    expect(md).toContain('> one line');
    expect(md).toContain('plain');
  });

  it('link 行输出裸地址、媒体行输出带标题的链接', () => {
    const md = composeKbMarkdown(
      [
        row({ id: 'site', kind: 'link', url: 'https://a.example.com' }),
        row({ id: 'pic', kind: 'image', url: 'https://a.example.com/x.png' }),
      ],
      t,
      'T',
      'N',
    );
    expect(md).toContain('<https://a.example.com>');
    expect(md).toContain('[pic](https://a.example.com/x.png)');
  });
});

describe('composeKbJson', () => {
  it('零条可交付 → null', () => {
    expect(composeKbJson([row({ id: 'a', status: 'pending_review' })], t, 'p1')).toBeNull();
  });

  it('🔴 溯源字段只有 source / scenario / verified_at（同步块字段已退役）', () => {
    const json = composeKbJson(
      [row({ id: 'a', module: 'sales_script', scenario: 'sales_quote' })],
      t,
      'p1',
    );
    expect(json).not.toBeNull();
    const pack = JSON.parse(json as string) as KbJsonPack;
    expect(pack.schema).toBe('geo.knowledge_pack/v1');
    expect(pack.project_id).toBe('p1');
    const item = pack.modules[0].items[0];
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'kind', 'title', 'body', 'url', 'mime', 'tags', 'status', 'source', 'scenario', 'verified_at'].sort(),
    );
    expect(item.scenario).toBe('sales_quote');
  });

  it('待审核条目一个字都不进产物', () => {
    const json = composeKbJson(
      [row({ id: 'keep' }), row({ id: 'drop', status: 'pending_review', title: 'secret draft' })],
      t,
      'p1',
    );
    expect(json).not.toContain('secret draft');
    const pack = JSON.parse(json as string) as KbJsonPack;
    expect(pack.modules[0].items.map((item) => item.id)).toEqual(['keep']);
  });
});

describe('文件名', () => {
  it('一律 ASCII（下载属性里出现中文会被部分浏览器丢掉）', () => {
    expect(kbMarkdownFileName('p1')).toMatch(/^geo-knowledge-p1\.md$/);
    expect(kbJsonFileName('p1')).toMatch(/^geo-knowledge-p1\.json$/);
  });
});
