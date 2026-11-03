/**
 * `api/article-compose.ts`（文章导出组装，DR-86③ / DR-89）的单元测试。
 *
 * 闸门只有一道：**只有 `status === 'approved'` 的文章进 Markdown**（规则 6 的落点）。
 * 待审与打回的草稿不该被当成可交付内容贴出去；零条可交付 → `null`（界面据此置灰，
 * 照 `kb-compose.ts` / `library-compose.ts` 的既有口径）。文件名一律 ASCII。
 */
import { describe, expect, it } from 'vitest';

import type { TFunction } from 'i18next';

import { i18n } from '../i18n';
import { dateTimeText } from '../components/format';
import type { Article } from './types';
import {
  articleMarkdownFileName,
  composeArticleMarkdown,
  exportableArticles,
  isExportable,
} from './article-compose';

const t = i18n.getFixedT('zh-CN') as TFunction;
const PROJECT_ID = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';

function article(partial: Partial<Article> & Pick<Article, 'id'>): Article {
  return {
    project_id: PROJECT_ID,
    direction_id: 'd10ec7a0-0000-4000-8000-000000000001',
    template_id: '7e4b1a00-0000-4000-8000-000000000001',
    schedule_id: null,
    source: 'manual',
    title: partial.id,
    body_markdown: `正文 ${partial.id}`,
    status: 'approved',
    word_count: 800,
    generated_at: '2026-09-22T01:30:00Z',
    ...partial,
  };
}

describe('文件名与闸门', () => {
  it('文件名 ASCII、带项目 id、以 .md 结尾', () => {
    const name = articleMarkdownFileName(PROJECT_ID);

    expect(name).toBe(`geo-articles-${PROJECT_ID}.md`);
    expect(/^[\x20-\x7e]+$/.test(name)).toBe(true);
  });

  it('只有 approved 进产物；pending_review / rejected 一律拦下', () => {
    expect(isExportable(article({ id: 'a', status: 'approved' }))).toBe(true);
    expect(isExportable(article({ id: 'b', status: 'pending_review' }))).toBe(false);
    expect(isExportable(article({ id: 'c', status: 'rejected' }))).toBe(false);
  });

  it('exportableArticles 保持传入顺序（评审队列是 generated_at DESC）', () => {
    const kept = exportableArticles([
      article({ id: 'a', status: 'pending_review' }),
      article({ id: 'b' }),
      article({ id: 'c', status: 'rejected' }),
      article({ id: 'd' }),
    ]);

    expect(kept.map((row) => row.id)).toEqual(['b', 'd']);
  });
});

describe('composeArticleMarkdown', () => {
  it('零条可交付 → null（界面据此置灰，不导出空壳）', () => {
    expect(composeArticleMarkdown([], t, '文章册', '说明')).toBeNull();
    expect(
      composeArticleMarkdown([article({ id: 'a', status: 'pending_review' })], t, '文章册', '说明'),
    ).toBeNull();
  });

  it('产物结构：标题 + 说明 + 每篇一节（标题 / 正文 / 生成时间与字数），以换行结尾', () => {
    const markdown = composeArticleMarkdown(
      [
        article({ id: '第一篇', title: '选型说明', body_markdown: '工况 → 方案 → 结果', word_count: 1180 }),
        article({ id: '第二篇', title: '案例复盘', body_markdown: '验收数据', status: 'rejected' }),
      ],
      t,
      '文章册',
      '由稿得快 GEO 文章管理导出',
    );

    expect(markdown).not.toBeNull();
    const text = markdown as string;
    expect(text.startsWith('# 文章册\n')).toBe(true);
    expect(text).toContain('_由稿得快 GEO 文章管理导出_');
    expect(text).toContain('## 选型说明');
    expect(text).toContain('工况 → 方案 → 结果');
    expect(text).toContain(dateTimeText('2026-09-22T01:30:00Z'));
    expect(text).toContain('1180');
    // 打回的那篇一个字都不进产物。
    expect(text).not.toContain('案例复盘');
    expect(text).not.toContain('验收数据');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('英文侧同一份产物：节名与元信息行都换成 en 文案（语言相关的组装在前端）', () => {
    const english = i18n.getFixedT('en-US') as TFunction;
    const markdown = composeArticleMarkdown([article({ id: 'a', title: 'Sizing guide' })], english, 'Articles', 'Exported from GEO');

    expect(markdown).toContain('# Articles');
    expect(markdown).toContain('_Exported from GEO_');
    expect(markdown).toContain('## Sizing guide');
    expect(markdown).toMatch(/800 words/);
  });
});
