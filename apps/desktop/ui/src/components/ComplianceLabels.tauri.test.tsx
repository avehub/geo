/**
 * Tauri 运行时下的合规标签（AGENTS 规则 6 的界面侧）。
 *
 * Rust 生成的文章与 FAQ 已经跑过红线扫描，桌面端不应再挂
 * `article.review.complianceUnchecked` / `library.faq.complianceUnchecked`
 * 这两句「未执行合规扫描」。示范按钮与正文仍必须可用。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import ArticlePreviewDrawer from './ArticlePreviewDrawer';
import ArticleReviewTable from './ArticleReviewTable';
import FaqGenerateModal from './FaqGenerateModal';
import FaqTable from './FaqTable';
import type { Article, FaqItem } from '../api/types';
import zh from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'tauri' }));

const ARTICLE: Article = {
  id: 'article-1',
  project_id: 'project-1',
  direction_id: 'direction-1',
  template_id: 'template-1',
  schedule_id: null,
  source: 'manual',
  title: '示例文章',
  body_markdown: '# 标题\n\n正文',
  status: 'pending_review',
  word_count: 12,
  generated_at: '2026-10-01T00:00:00Z',
};

const FAQ: FaqItem = {
  id: 'faq-1',
  project_id: 'project-1',
  question: '示例问题',
  answer_markdown: '示例答案',
  category: '选型',
  intent: 'category_awareness',
  status: 'pending_review',
  source: 'generated',
  position: 0,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

describe('Tauri 运行时 · 文章/FAQ 合规标签', () => {
  it('文章评审表不挂演示合规标签，标题仍可见', () => {
    renderWithProviders(
      <ArticleReviewTable
        rows={[ARTICLE]}
        selectedIds={[]}
        directionTitleOf={() => '方向'}
        templateNameOf={() => '模板'}
        onSelectIds={() => undefined}
        onPreview={() => undefined}
      />,
    );

    expect(screen.getByText(ARTICLE.title)).toBeInTheDocument();
    expect(screen.queryByText(zh.article.review.complianceUnchecked)).toBeNull();
  });

  it('文章预览抽屉不挂演示合规标签，正文提示仍在', () => {
    renderWithProviders(
      <ArticlePreviewDrawer
        article={ARTICLE}
        directionTitle="方向"
        templateName="模板"
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByText(zh.article.review.complianceUnchecked)).toBeNull();
    expect(screen.getByText(zh.article.review.bodyHint)).toBeInTheDocument();
  });

  it('FAQ 表格展开行不挂演示合规标签，答案原文仍在', () => {
    const { container } = renderWithProviders(
      <FaqTable
        rows={[FAQ]}
        selectedRowKeys={[]}
        onSelectionChange={() => undefined}
        onStatusChange={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const expandIcon = container.querySelector('.ant-table-row-expand-icon');
    expect(expandIcon).not.toBeNull();
    fireEvent.click(expandIcon as HTMLElement);

    expect(screen.getByText(FAQ.answer_markdown)).toBeInTheDocument();
    expect(screen.queryByText(zh.library.faq.complianceUnchecked)).toBeNull();
  });

  it('FAQ 生成弹窗不挂演示提示与演示合规标签', () => {
    renderWithProviders(
      <FaqGenerateModal generating={false} onCancel={() => undefined} onGenerate={() => undefined} />,
    );

    expect(screen.queryByText(/演示模式/)).toBeNull();
    expect(screen.queryByText(zh.library.faq.complianceUnchecked)).toBeNull();
  });
});
