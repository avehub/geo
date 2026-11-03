/**
 * 素材导出组装的判据（spec DR-44）。
 *
 * 钉三件事：① CSV 的转义与表头；② JSON-LD **只收已采用**、零条时回 `null`；
 * ③ 文件名一律 ASCII（中文文件名在 `download` 属性里会掉）。
 */
import { describe, expect, it } from 'vitest';

import {
  KEYWORD_CSV_HEADER,
  adoptedFaqCount,
  composeFaqJsonLd,
  composeKeywordCsv,
  faqJsonLdFileName,
  keywordCsvFileName,
} from './library-compose';
import type { FaqItem, KeywordItem } from './types';

const PROJECT_ID = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';

function keyword(patch: Partial<KeywordItem> = {}): KeywordItem {
  return {
    id: 'demo-kw-001',
    project_id: PROJECT_ID,
    text: '工业除尘器',
    kind: 'core',
    intent: 'category_awareness',
    monthly_volume: 8100,
    difficulty: 62,
    priority: 5,
    status: 'approved',
    note: null,
    source: 'manual',
    position: 0,
    created_at: '2026-09-11T02:10:00Z',
    updated_at: '2026-09-16T09:05:00Z',
    ...patch,
  };
}

function faq(patch: Partial<FaqItem> = {}): FaqItem {
  return {
    id: 'demo-faq-001',
    project_id: PROJECT_ID,
    question: '布袋除尘器和滤筒除尘器怎么选？',
    answer_markdown: '按粉尘性质选。',
    category: '选型',
    intent: 'purchase_recommendation',
    status: 'approved',
    source: 'manual',
    position: 0,
    created_at: '2026-09-11T03:05:00Z',
    updated_at: '2026-09-16T08:40:00Z',
    ...patch,
  };
}

describe('api/library-compose · 关键词 CSV', () => {
  it('表头固定 8 列（按规格，不含 source），值按列序落位；null 落成空单元格', () => {
    // 规格 `2026-09-30-keyword-faq-library-design.md:142` 固定的 8 列。
    expect(KEYWORD_CSV_HEADER).toEqual([
      'text',
      'kind',
      'intent',
      'priority',
      'monthly_volume',
      'difficulty',
      'status',
      'note',
    ]);
    const csv = composeKeywordCsv([keyword(), keyword({ text: '除尘器售后服务', monthly_volume: null, difficulty: null, note: '待补指标' })]);
    const lines = csv.split('\n');

    expect(lines[0]).toBe(KEYWORD_CSV_HEADER.join(','));
    expect(lines[1]).toBe('工业除尘器,core,category_awareness,5,8100,62,approved,');
    expect(lines[2]).toBe('除尘器售后服务,core,category_awareness,5,,,approved,待补指标');
    // 末行带换行（csv crate 的默认行为）
    expect(csv.endsWith('\n')).toBe(true);
    expect(lines.at(-1)).toBe('');
  });

  it('含逗号/引号/换行的单元格加引号，内部引号翻倍', () => {
    const csv = composeKeywordCsv([
      keyword({ text: '除尘器, 风机' }),
      keyword({ note: '他说"要加钱"\n第二行' }),
    ]);

    expect(csv).toContain('"除尘器, 风机"');
    expect(csv).toContain('"他说""要加钱""\n第二行"');
  });

  it('空清单只有表头一行', () => {
    expect(composeKeywordCsv([])).toBe(`${KEYWORD_CSV_HEADER.join(',')}\n`);
  });

  it('文件名是 ASCII（中文文件名在 download 属性里会掉）', () => {
    expect(keywordCsvFileName(PROJECT_ID)).toBe(`geo-keywords-${PROJECT_ID}.csv`);
    expect(keywordCsvFileName(PROJECT_ID)).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('api/library-compose · FAQPage JSON-LD', () => {
  it('🔴 只收已采用的条目：pending_review 与 rejected 一律不进 mainEntity', () => {
    const json = composeFaqJsonLd([
      faq({ id: 'a', question: '已采用的问题？' }),
      faq({ id: 'b', question: '待审的问题？', status: 'pending_review' }),
      faq({ id: 'c', question: '已退回的问题？', status: 'rejected' }),
    ]);

    expect(json).not.toBeNull();
    const parsed = JSON.parse(json as string) as Record<string, unknown>;
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('FAQPage');
    const entities = parsed.mainEntity as { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[];
    expect(entities).toHaveLength(1);
    expect(entities[0]['@type']).toBe('Question');
    expect(entities[0].name).toBe('已采用的问题？');
    expect(entities[0].acceptedAnswer['@type']).toBe('Answer');
    expect(entities[0].acceptedAnswer.text).toBe('按粉尘性质选。');
  });

  it('零条可用 ⇒ null（界面据此置灰按钮，而不是导出一份空壳）', () => {
    expect(composeFaqJsonLd([])).toBeNull();
    expect(composeFaqJsonLd([faq({ status: 'pending_review' }), faq({ status: 'rejected' })])).toBeNull();
  });

  it('答案按 Markdown 原文进 text，且换行与引号被 JSON 正确转义', () => {
    const json = composeFaqJsonLd([
      faq({ answer_markdown: '第一行\n- 他说"这样"\n- 第二项' }),
    ]) as string;

    expect(json).toContain('\\n');
    expect(JSON.parse(json).mainEntity[0].acceptedAnswer.text).toBe('第一行\n- 他说"这样"\n- 第二项');
    // 缩进 2 空格：产物是要贴进官网源码给人看的
    expect(json).toContain('\n  "@context"');
  });

  it('adoptedFaqCount 与 composeFaqJsonLd 同一个筛选口径', () => {
    const rows = [faq({ id: 'a' }), faq({ id: 'b', status: 'pending_review' }), faq({ id: 'c' })];
    expect(adoptedFaqCount(rows)).toBe(2);
    expect(JSON.parse(composeFaqJsonLd(rows) as string).mainEntity).toHaveLength(2);
    expect(adoptedFaqCount([])).toBe(0);
  });

  it('文件名是 ASCII', () => {
    expect(faqJsonLdFileName(PROJECT_ID)).toBe(`geo-faq-${PROJECT_ID}.jsonld`);
    expect(faqJsonLdFileName(PROJECT_ID)).toMatch(/^[\x20-\x7e]+$/);
  });
});
