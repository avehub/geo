/**
 * M7 导出条的运行时差异：demo 只出 Markdown / HTML / CSV；桌面端额外出 PDF / XLSX。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ReportExportBar from './ReportExportBar';
import type { ReportDocument } from '../api/types';
import zh from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';
import { mockInvoke } from '../test/invoke-mock';

vi.mock('../api/runtime', () => ({ runtime: 'tauri' }));

const DOC: ReportDocument = {
  project_id: 'project-1',
  round_id: 'round-1',
  variant: 'executive',
  brand_name: 'Acme',
  round_label: 'Round 1',
  generated_at: '2026-10-01T08:30:00Z',
  headline: [],
  next_steps: [],
  sections: [],
  methodology: {
    round_label: 'Round 1',
    sample_size: 62,
    sample_size_grade: 'sufficient',
    collected_at: '2026-10-01T08:30:00Z',
    engines: ['doubao'],
    model_versions: ['model-1'],
    prompt_set_label: 'Core prompts',
    prompt_set_version: 1,
    metric_spec_version: '2026-09',
    repeat_count: 1,
  },
  white_label: null,
};

beforeEach(() => {
  mockInvoke.reset();
  mockInvoke.stubAlways('export_write_file', '/tmp/exported');
});

afterEach(() => {
  mockInvoke.reset();
});

describe('ReportExportBar · Tauri', () => {
  it('额外启用 PDF / XLSX，Word / PNG 仍置灰并说明后续提供', () => {
    renderWithProviders(<ReportExportBar doc={DOC} />);
    const bar = screen.getByText(zh.report.export.title).closest('.ant-card') as HTMLElement;

    for (const format of ['markdown', 'html', 'csv', 'pdf', 'xlsx'] as const) {
      expect(within(bar).getByRole('button', { name: new RegExp(zh.common.exportFormats[format]) })).toBeEnabled();
    }
    for (const format of ['docx', 'png'] as const) {
      expect(within(bar).getByRole('button', { name: new RegExp(zh.common.exportFormats[format]) })).toBeDisabled();
      expect(
        within(bar).getByText(zh.report.export.desktopPending.replace('{{format}}', zh.common.exportFormats[format])),
      ).toBeInTheDocument();
    }
    expect(
      within(bar).getByText(zh.report.export.desktopReady.replace('{{format}}', zh.common.exportFormats.pdf)),
    ).toBeInTheDocument();
    expect(
      within(bar).getByText(zh.report.export.desktopReady.replace('{{format}}', zh.common.exportFormats.xlsx)),
    ).toBeInTheDocument();
  });

  it('PDF 用 HTML 正文，文件名 .pdf，format=pdf', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportExportBar doc={DOC} />);

    await user.click(screen.getByRole('button', { name: new RegExp(zh.common.exportFormats.pdf) }));

    const args = mockInvoke.lastArgsOf('export_write_file');
    expect(args).toMatchObject({
      format: 'pdf',
      with_bom: false,
    });
    expect(String(args?.default_name)).toMatch(/^geo-report-executive-\d{8}-\d{4}\.pdf$/);
    expect(String(args?.content)).toContain('<!doctype html>');
    expect(String(args?.content)).toContain('Acme');
  });

  it('XLSX 用 CSV 正文，文件名 .xlsx，format=xlsx', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportExportBar doc={DOC} />);

    await user.click(screen.getByRole('button', { name: new RegExp(zh.common.exportFormats.xlsx) }));

    const args = mockInvoke.lastArgsOf('export_write_file');
    expect(args).toMatchObject({
      format: 'xlsx',
      with_bom: false,
    });
    expect(String(args?.default_name)).toMatch(/^geo-report-executive-\d{8}-\d{4}\.xlsx$/);
    expect(String(args?.content)).toContain('Acme');
    expect(String(args?.content)).not.toContain('<!doctype html>');
  });
});
