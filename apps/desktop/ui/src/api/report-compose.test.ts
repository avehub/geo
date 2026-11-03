/**
 * 报告导出文本的契约判据（子任务 B：报告 / 导出同源）。
 *
 * 这里不测排版细节，只钉四件会直接影响客户信任的事：
 * ① 预览与导出共用同一个时间格式化与同一份引擎词典（不出现 ISO 原文 / `doubao, deepseek`）；
 * ② 口径说明的**值**由同一个函数产出，预览与三种导出不可能各说一套；
 * ③ HTML 的 `lang` 跟随当前界面语言；
 * ④ 白标 Logo 在 Markdown / HTML / CSV 里都保留，HTML 里是真正的 `<img>`。
 */
import { describe, expect, it } from 'vitest';

import { composeReport, methodologyRows } from './report-compose';
import type { ReportDocument } from './types';
import { dateTimeText } from '../components/format';
import { i18n } from '../i18n';

const zh = () => i18n.getFixedT('zh-CN');
const en = () => i18n.getFixedT('en-US');

const DOC: ReportDocument = {
  project_id: 'demo-project-lanzhou',
  round_id: 'demo-round-retest',
  variant: 'white_label',
  brand_name: '澜舟',
  round_label: '复测',
  generated_at: '2026-10-01T04:00:00Z',
  headline: [
    { kind: 'metric', metric: 'brand_coverage', value: 0.55, unit: 'percent', delta: 13 },
  ],
  next_steps: ['补齐产品页的适用范围。'],
  sections: [
    {
      id: 'conclusion',
      blocks: [{ kind: 'paragraph', text: '复测后可见度提升。' }],
    },
  ],
  methodology: {
    round_label: '复测',
    sample_size: 60,
    sample_size_grade: 'sufficient',
    collected_at: '2026-09-23T02:12:00Z',
    engines: ['doubao', 'deepseek'],
    model_versions: ['doubao-seed-1.8', 'deepseek-chat'],
    prompt_set_label: '核心题库',
    prompt_set_version: 1,
    metric_spec_version: 'v1.0',
    repeat_count: 1,
  },
  white_label: {
    agency_name: '示例数字营销服务（苏州）有限公司',
    contact: 'geo@example-agency.example.com',
    logo_url: 'https://cdn.example.com/brand/logo.png',
  },
};

const NO_LOGO: ReportDocument = {
  ...DOC,
  white_label: { ...DOC.white_label!, logo_url: null },
};

/** 证据附录这种表格里的机器记号（引擎 id / 提及枚举 / 时间）也必须在预览与导出里同一套渲染。 */
const TABLE_DOC: ReportDocument = {
  ...DOC,
  variant: 'executive',
  // 口径区不含 doubao / metaso，避免「机器 id 只出现在表格里」这条断言被方法学区干扰。
  methodology: { ...DOC.methodology, engines: ['kimi'], model_versions: [] },
  sections: [
    {
      id: 'evidence',
      blocks: [
        {
          kind: 'table',
          column_keys: ['prompt_text', 'engine', 'collected_at', 'mention', 'rank', 'answer_excerpt'],
          rows: [['示例题目', 'doubao', '2026-09-23T02:12:00Z', 'mentioned', '2', '回答片段']],
        },
        {
          kind: 'table',
          column_keys: ['prompt_text', 'engine', 'collected_at', 'mention', 'rank', 'answer_excerpt'],
          rows: [['未提及题目', 'metaso', '2026-09-23T02:14:00Z', 'not_mentioned', '-', '另一段片段']],
        },
      ],
    },
  ],
};

describe('composeReport · 证据附录单元格', () => {
  it.each(['markdown', 'html', 'csv'] as const)(
    '%s 导出把引擎 id、提及枚举与 ISO 时间换成界面同款文案',
    (kind) => {
      const text = composeReport(TABLE_DOC, zh(), kind);
      expect(text).toContain('豆包');
      expect(text).toContain('秘塔搜索');
      expect(text).not.toContain('doubao');
      expect(text).not.toContain('metaso');
      expect(text).toContain('是');
      expect(text).toContain('否');
      expect(text).not.toContain('mentioned');
      expect(text).toContain(dateTimeText('2026-09-23T02:12:00Z'));
      expect(text).not.toContain('2026-09-23T02:12:00Z');
    },
  );

  it('en-US 导出的证据附录同样本地化', () => {
    const text = composeReport(TABLE_DOC, en(), 'markdown');
    expect(text).toContain('Doubao');
    expect(text).toContain('Yes');
    expect(text).toContain('No');
    expect(text).not.toContain('mentioned');
  });
});

describe('composeReport · 预览同源', () => {
  it('采集时间与引擎名使用界面上的同一份格式化 / 词典，不露出 ISO 与机器 id', () => {
    const markdown = composeReport(DOC, zh(), 'markdown');
    expect(markdown).toContain(dateTimeText(DOC.methodology.collected_at));
    expect(markdown).not.toContain(DOC.methodology.collected_at);
    expect(markdown).toContain('引擎: 豆包, DeepSeek');
    expect(markdown).not.toContain('doubao, deepseek');
  });

  it('口径说明的数字用同一个值函数（样本量分级与预览同形）', () => {
    const markdown = composeReport(DOC, zh(), 'markdown');
    expect(markdown).toContain('样本量: 60 · 样本充足');
  });

  it('三种导出都包含预览用的同一组口径标签与值', () => {
    const rows = methodologyRows(zh(), DOC);
    for (const kind of ['markdown', 'html', 'csv'] as const) {
      const text = composeReport(DOC, zh(), kind);
      for (const row of rows) {
        expect(text, `${kind} 缺少 ${row.key} 的标签`).toContain(row.label);
        expect(text, `${kind} 缺少 ${row.key} 的值`).toContain(row.value);
      }
    }
  });

  it('英文界面导出英文引擎名与英文口径标签', () => {
    const html = composeReport(DOC, en(), 'html');
    expect(html).toContain('Engines: Doubao, DeepSeek');
    expect(html).toContain('Collection finished at:');
  });
});

describe('composeReport · HTML lang', () => {
  it('中文界面写 zh-CN，英文界面写 en-US', () => {
    expect(composeReport(DOC, zh(), 'html')).toContain('<html lang="zh-CN">');
    expect(composeReport(DOC, en(), 'html')).toContain('<html lang="en-US">');
  });
});

describe('composeReport · 白标 Logo', () => {
  it('Markdown 保留 Logo 链接', () => {
    const markdown = composeReport(DOC, zh(), 'markdown');
    expect(markdown).toContain('![示例数字营销服务（苏州）有限公司](https://cdn.example.com/brand/logo.png)');
  });

  it('HTML 用真正的 img 标签嵌入，且 URL 做了属性转义', () => {
    const html = composeReport(DOC, zh(), 'html');
    expect(html).toContain('src="https://cdn.example.com/brand/logo.png"');
    expect(html).toContain('alt="示例数字营销服务（苏州）有限公司"');
    expect(html).toContain('<img ');

    const escaped = composeReport(
      { ...DOC, white_label: { ...DOC.white_label!, logo_url: 'https://x.example.com/a"b.png' } },
      zh(),
      'html',
    );
    expect(escaped).toContain('src="https://x.example.com/a&quot;b.png"');
  });

  it('CSV 保留 Logo 链接；没有 Logo 时不输出空行', () => {
    expect(composeReport(DOC, zh(), 'csv')).toContain(
      'Logo 链接,https://cdn.example.com/brand/logo.png',
    );
    expect(composeReport(NO_LOGO, zh(), 'csv')).not.toContain('Logo 链接');
  });
});
