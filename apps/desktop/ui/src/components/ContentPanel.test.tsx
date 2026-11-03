import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ContentPanel from './ContentPanel';
import type { GeneratedContent } from '../api/types';
import zh from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

function content(overrides: Partial<GeneratedContent> = {}): GeneratedContent {
  return {
    id: 'content-1',
    project_id: 'project-1',
    action_id: null,
    template_id: 'template-1',
    title: 'Draft',
    body_markdown: '# Draft',
    status: 'pending_review',
    compliance_checked: false,
    export_formats: ['markdown', 'html'],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function renderPanel(item: GeneratedContent) {
  return renderWithProviders(
    <ContentPanel
      contents={[item]}
      templates={[]}
      actions={[]}
      onGenerateFromTemplate={() => undefined}
    />,
  );
}

describe('ContentPanel · 导出闸门（规则 6）', () => {
  it('待审 / 已退回的文稿可以预览，但导出按钮置灰并说明原因', async () => {
    const user = userEvent.setup();
    renderPanel(content({ status: 'pending_review' }));

    await user.click(screen.getByRole('button', { name: zh.action.contents.preview }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).getByRole('button', { name: zh.common.exportFormats.markdown })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: zh.common.exportFormats.html })).toBeDisabled();
    expect(within(drawer).getByText(zh.action.export.onlyApproved)).toBeInTheDocument();
  });

  it('审核通过后导出按钮解禁（同一份文稿不因预览而改变状态）', async () => {
    const user = userEvent.setup();
    renderPanel(content({ status: 'approved' }));

    await user.click(screen.getByRole('button', { name: zh.action.contents.preview }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).getByRole('button', { name: zh.common.exportFormats.markdown })).toBeEnabled();
    expect(within(drawer).getByRole('button', { name: zh.common.exportFormats.html })).toBeEnabled();
    expect(within(drawer).queryByText(zh.action.export.onlyApproved)).toBeNull();
  });
});
