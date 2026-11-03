/**
 * 文章的**导出文本**组装（M6，spec `2026-10-10-kb-redesign-and-article-studio-design.md` DR-86③ / DR-89）。
 *
 * 与 `kb-compose.ts` / `library-compose.ts` / `report-compose.ts` 同族：导出物在**前端**组装
 * （标题与说明是界面文案，必须走词典，AGENTS 规则 7），落盘走既有的 `export_write_file`
 * + `LibraryExportModal`（🔴 不新增导出命令）。
 *
 * # 🔴 闸门：只有 `status === 'approved'` 的文章进产物（规则 6）
 * `pending_review` 意味着「AI 生成、还没人看过」，`rejected` 意味着「人看过、打回了」——
 * 两者都不该被当成交付内容贴出去。零条可用时返回 `null`，界面据此置灰按钮并说明原因
 * （照 FAQ / 知识册那两处的既有口径），不导出一份空壳。
 *
 * # 🔴 正文按 Markdown **原文**进文件
 * 不做 Markdown → HTML 渲染（与 `library-compose.ts` 对 JSON-LD `text` 那一支同一个取舍：
 * 不引解析器）。要出富文本由 Plan C 在 Rust 侧渲染。
 */
import type { TFunction } from 'i18next';

import { dateTimeText } from '../components/format';
import type { Article } from './types';

/** 文件名一律 ASCII（下载属性里出现中文会被部分浏览器丢掉，`kb-compose.ts` 同一条纪律）。 */
export function articleMarkdownFileName(projectId: string): string {
  return `geo-articles-${projectId}.md`;
}

/** 这一篇能不能进交付物（见文件头那道闸门）。 */
export function isExportable(article: Article): boolean {
  return article.status === 'approved';
}

/** 过完闸门的文章；零条时调用方要置灰按钮。顺序保持传入顺序（评审队列是 `generated_at DESC`）。 */
export function exportableArticles(articles: readonly Article[]): Article[] {
  return articles.filter(isExportable);
}

/**
 * Markdown 文章册。零条可交付时返回 `null`。
 *
 * 结构：`# 标题` → `_说明_` → 每篇一节（`## 文章标题` + 正文原文 + 一行生成时间与字数）。
 * 那一行元信息用词典键拼（`article.export.metaLine`）：语言相关的词一律不在这里硬写。
 */
export function composeArticleMarkdown(
  articles: readonly Article[],
  t: TFunction,
  title: string,
  note: string,
): string | null {
  const kept = exportableArticles(articles);
  if (kept.length === 0) return null;

  const parts: string[] = [`# ${title}`, `_${note}_`];
  for (const article of kept) {
    parts.push(
      [
        `## ${article.title}`,
        article.body_markdown,
        `_${t('article.export.metaLine', {
          time: dateTimeText(article.generated_at),
          words: article.word_count,
        })}_`,
      ].join('\n\n'),
    );
  }
  return `${parts.join('\n\n')}\n`;
}
