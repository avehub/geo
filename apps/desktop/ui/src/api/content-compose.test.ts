/**
 * 文稿导出的最小契约：HTML 的 `lang` 必须跟随当前界面语言。
 *
 * 正文本身是数据（Markdown 原样进 `<pre>`），这里只钉导出壳的元信息，
 * 防止英文界面导出的文件仍声明 `lang="zh-CN"`。
 */
import { describe, expect, it } from 'vitest';

import { composeContent } from './content-compose';
import type { GeneratedContent } from './types';

const CONTENT: GeneratedContent = {
  id: 'demo-content-001',
  project_id: 'demo-project-lanzhou',
  action_id: 'demo-act-001',
  template_id: 'demo-template-001',
  title: 'Dust collector selection guide',
  body_markdown: '# Guide\n\nBody text.',
  status: 'approved',
  compliance_checked: true,
  export_formats: ['markdown', 'html'],
  created_at: '2026-10-01T04:00:00Z',
  updated_at: '2026-10-01T04:00:00Z',
};

describe('composeContent · HTML lang', () => {
  it('跟随传入的界面语言', () => {
    expect(composeContent(CONTENT, 'html', 'zh-CN')).toContain('<html lang="zh-CN">');
    expect(composeContent(CONTENT, 'html', 'en-US')).toContain('<html lang="en-US">');
  });

  it('Markdown 导出仍是原样正文', () => {
    expect(composeContent(CONTENT, 'markdown', 'en-US')).toBe(CONTENT.body_markdown);
  });
});
