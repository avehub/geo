/**
 * `describeIpcError` 的行为契约（Plan A Task 7）。
 *
 * 后端只回「稳定 code + 语言中立 params」，人读的句子一律由词典按当前语言渲染
 * （AGENTS 规则 7 / spec §4.2）。本文件钉住裁定的每一条**行为**：
 * B-2 `params` 接到类上、B-3 `upstream/*` 共享包装键、B-4 raw passthrough、
 * B-6 红线词的两条独立泄漏面、B-7 `llm/transport` 的可操作指引、
 * B-8 `crawler/network` 能插 `status`、B-9 `validation/failed` 的槽位组合、
 * B-10 固定回退阶梯；结构面的断言（词典完整性）在 `src/i18n/dictionary.test.ts`。
 *
 * 语言切换用 `i18n.getFixedT(...)` 而不是 `initI18n`：它不动全局单例，
 * 所以不需要复位语言（`src/test/setup.ts` 的 `beforeEach` 也仍会把全局拨回 zh-CN）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { IpcRequestError } from './client';
import { describeIpcError } from './errors';

const zh = () => i18n.getFixedT('zh-CN');
const en = () => i18n.getFixedT('en-US');

/** 造一个 IPC 错误。`message` 默认写成紧凑日志串——它是后端真实的兜底形态。 */
function ipcError(
  code: string,
  params: Record<string, string> = {},
  message = `${code} reason=x`,
): IpcRequestError {
  return new IpcRequestError({ code, params, message });
}

/** 静音并捕获 console.warn：只有「故意测未命中」的用例才应该看到它。 */
function captureWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B-2 · IpcRequestError.params', () => {
  it('带 params 构造时原样 round-trip', () => {
    const error = new IpcRequestError({
      code: 'validation/failed',
      params: { field: 'brand_name', reason: 'required' },
      message: 'validation/failed field=brand_name reason=required',
    });

    expect(error.params).toEqual({ field: 'brand_name', reason: 'required' });
  });

  it('不带 params 构造时是空对象而不是 undefined，调用方不必处处判空', () => {
    const error = new IpcRequestError({ code: 'llm/rate_limited', message: 'llm/rate_limited' });

    expect(error.params).toBeDefined();
    expect(error.params).toEqual({});
  });
});

describe('B-10 · describeIpcError 的回退阶梯', () => {
  it('拿到的不是 IpcRequestError 时回落 common.unknownError', () => {
    const unknownKey = '操作未成功，请稍后重试';

    expect(describeIpcError(new Error('boom'), zh())).toBe(unknownKey);
    expect(describeIpcError('boom', zh())).toBe(unknownKey);
    expect(describeIpcError(null, zh())).toBe(unknownKey);
    expect(describeIpcError(undefined, en())).toBe('Something went wrong. Please try again later.');
  });

  it('code 未命中词典时 console.warn 带上 code，并回落到后端 message', () => {
    const warn = captureWarn();
    const error = ipcError('store/sqlx', {}, '数据库读写失败');

    expect(describeIpcError(error, zh())).toBe('数据库读写失败');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('store/sqlx');
  });

  it('命中词典时不 console.warn（噪音只属于未命中那一条路径）', () => {
    const warn = captureWarn();

    describeIpcError(ipcError('llm/missing_secret'), zh());
    describeIpcError(ipcError('validation/failed', { field: 'brand_name', reason: 'required' }), en());

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('B-3 · upstream/* 只用一条共享包装键', () => {
  const params = { upstream_code: 'llm/server', upstream: '503 from provider' };

  it('zh 与 en 都渲染成「上游服务返回错误：<原文>」', () => {
    expect(describeIpcError(ipcError('upstream/llm/server', params), zh())).toBe(
      '上游服务返回错误：503 from provider',
    );
    expect(describeIpcError(ipcError('upstream/llm/server', params), en())).toBe(
      'Upstream service error: 503 from provider',
    );
  });

  it('缺 upstream 时按阶梯回退到 upstream_code', () => {
    const text = describeIpcError(ipcError('upstream/llm/server', { upstream_code: 'llm/server' }), zh());

    expect(text).toBe('上游服务返回错误：llm/server');
  });

  it('两个键都缺时按阶梯回退到 message；三者全空才 console.warn', () => {
    const warn = captureWarn();

    // message 为空串时，client.ts 的构造子会兜成固定串（那句中文明文归 Task 9 收口），
    // 所以这一级仍有内容可包装——不断言它的字面值，只断言阶梯走到了 message。
    const noMessage = new IpcRequestError({ code: 'upstream/llm/server', params: {}, message: '' });
    expect(describeIpcError(noMessage, zh())).toBe(`上游服务返回错误：${noMessage.message}`);
    expect(warn).not.toHaveBeenCalled();

    // 三者都空（message 只有空白）才落到最后一级：warn 一声 + 原样返回 message
    const blank = new IpcRequestError({ code: 'upstream/llm/server', params: {}, message: '   ' });
    expect(describeIpcError(blank, zh())).toBe(blank.message);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('upstream/llm/server');
  });

  it('里层 code 没有 params 时（rate_limited）仍走包装文案，且不是裸 code', () => {
    const error = ipcError('upstream/llm/rate_limited', {}, 'upstream/llm/rate_limited');
    const text = describeIpcError(error, zh());

    expect(text).toContain('上游服务');
    expect(text).not.toBe('upstream/llm/rate_limited');
    expect(describeIpcError(error, en())).toContain('Upstream service error');
  });

  it('渲染结果不残留占位符，也不把里层参数名当文案露出来', () => {
    for (const t of [zh(), en()]) {
      const text = describeIpcError(ipcError('upstream/crawler/network', params), t);

      expect(text).not.toContain('{{');
      expect(text).not.toContain('}}');
      expect(text).not.toContain('status');
      expect(text).not.toContain('upstream_code');
    }
  });
});

describe('B-9 · validation/failed 的槽位组合', () => {
  it('zh「品牌名不能为空」/ en "Brand name is required"（计划正文的验收例）', () => {
    const error = ipcError('validation/failed', { field: 'brand_name', reason: 'required' });

    expect(describeIpcError(error, zh())).toBe('品牌名不能为空');
    expect(describeIpcError(error, en())).toBe('Brand name is required');
  });

  it('too_long 插上 limit（反向哨兵：数字必须出现）', () => {
    const error = ipcError('validation/failed', {
      field: 'brand_name',
      reason: 'too_long',
      limit: '120',
    });

    expect(describeIpcError(error, zh())).toBe('品牌名超过 120 字上限');
    expect(describeIpcError(error, en())).toBe('Brand name exceeds the 120-character limit');
  });

  it('out_of_range 缺 value 时不追加片段、也不留空洞', () => {
    const error = ipcError('validation/failed', {
      field: 'tags',
      reason: 'out_of_range',
      expected: '<=20',
    });

    expect(describeIpcError(error, zh())).toBe('标签需在 <=20 范围内');
    expect(describeIpcError(error, en())).toBe('Tags must be within <=20');
  });

  it('out_of_range 带 value 时追加可选片段（expected 整串插入，不解析）', () => {
    const error = ipcError('validation/failed', {
      field: 'ids',
      reason: 'out_of_range',
      expected: '<3',
      value: '5',
    });

    expect(describeIpcError(error, zh())).toBe('选中条目需在 <3 范围内（5）');
    expect(describeIpcError(error, en())).toBe('Selected items must be within <3 (5)');
  });

  it('B-4 · field 查不到词典时原样显示，不猜也不拆路径', () => {
    const error = ipcError('validation/failed', { field: 'mystery_field', reason: 'required' });

    expect(describeIpcError(error, zh())).toBe('mystery_field不能为空');
  });

  it('B-4 · reason 查不到词典时原样显示（raw passthrough）', () => {
    const error = ipcError('data/invalid', { reason: 'missing field `brand_name`' });

    expect(describeIpcError(error, zh())).toBe('数据格式有误：missing field `brand_name`');
  });
});

describe('B-6 · 红线词的两条独立泄漏面', () => {
  const banned = '国家级';

  it('路径 1：validation/failed + not_allowed 的 value 一个字都不出现', () => {
    const error = ipcError('validation/failed', {
      field: 'content',
      reason: 'not_allowed',
      value: `最好的、${banned}`,
    });

    for (const t of [zh(), en()]) {
      const text = describeIpcError(error, t);

      expect(text).not.toContain(banned);
      expect(text).not.toContain('最好的');
      expect(text).not.toBe('');
    }
    expect(describeIpcError(error, zh())).toBe('内容不被允许，请改写后再提交');
  });

  it('路径 2：compliance/violation 的 terms 一个字都不出现', () => {
    const error = ipcError('compliance/violation', { terms: `${banned}、最佳` });

    for (const t of [zh(), en()]) {
      const text = describeIpcError(error, t);

      expect(text).not.toContain(banned);
      expect(text).not.toContain('最佳');
      expect(text).not.toBe('');
    }
  });

  it('反向哨兵：不是一刀切藏掉所有 value——limit 与 content-type 照常显示', () => {
    const blocked = ipcError('crawler/blocked', {
      url: 'https://a.example/spec.pdf',
      reason: 'not_allowed',
      value: 'application/pdf',
    });

    expect(describeIpcError(blocked, zh())).toContain('application/pdf');
    expect(describeIpcError(blocked, en())).toContain('application/pdf');
  });
});

describe('B-4 / G-2 · io/failed 等 raw passthrough', () => {
  it('io/failed 插上 OS 原文（含路径），文案不写成「导出失败」', () => {
    const error = ipcError('io/failed', { reason: 'Permission denied (os error 13): /tmp/a.csv' });
    const text = describeIpcError(error, zh());

    expect(text).toContain('Permission denied (os error 13): /tmp/a.csv');
    expect(text).not.toContain('导出失败');
    expect(describeIpcError(error, en())).toContain('Permission denied (os error 13)');
  });

  it('llm/transport 的未知 reason 原样显示，不编键', () => {
    const error = ipcError('llm/transport', { reason: 'tls handshake alert' });

    expect(describeIpcError(error, zh())).toBe('连接模型服务失败：tls handshake alert');
  });
});

describe('B-7 · llm/transport 的三条 reason 是可操作指引', () => {
  const cases: Array<[string, string, string]> = [
    ['network', '代理', 'proxy'],
    ['timeout', '超时', 'timed out'],
    ['other', '日志', 'logs'],
  ];

  it.each(cases)('reason=%s 在 zh 下给出下一步动作', (reason, keyword) => {
    const text = describeIpcError(ipcError('llm/transport', { reason }), zh());

    expect(text).toContain(keyword);
    expect(text).not.toContain('{{');
    expect(text).not.toBe(reason);
  });

  it.each(cases)('reason=%s 在 en 下给出下一步动作', (reason, _keyword, enKeyword) => {
    const text = describeIpcError(ipcError('llm/transport', { reason }), en());

    expect(text.toLowerCase()).toContain(enKeyword);
  });
});

describe('F-2 · field 下标归一化', () => {
  it('competitors[0].name / competitors[7].website / core_pages[1] 都渲染成人类可读字段名', () => {
    const inputs: Array<[string, string, string]> = [
      ['competitors[0].name', '竞品名称', 'Competitor name'],
      ['competitors[7].website', '竞品官网', 'Competitor website'],
      ['core_pages[1]', '核心页面', 'Core page'],
    ];

    for (const [field, zhLabel, enLabel] of inputs) {
      const error = ipcError('validation/failed', { field, reason: 'required' });
      const zhText = describeIpcError(error, zh());
      const enText = describeIpcError(error, en());

      expect(zhText).toContain(zhLabel);
      expect(enText).toContain(enLabel);
      for (const text of [zhText, enText]) {
        expect(text).not.toContain('[');
        expect(text).not.toContain(']');
        expect(text).not.toMatch(/[0-9]/);
      }
    }
  });

  it('单数口径 competitor.name 与复数口径 competitors.name 都能渲染', () => {
    for (const field of ['competitor.name', 'competitors.name']) {
      expect(describeIpcError(ipcError('validation/failed', { field, reason: 'required' }), zh())).toBe(
        '竞品名称不能为空',
      );
    }
  });
});

describe('F-2 · crawler/empty 的 skipped 扁平串', () => {
  it('skipped 为空串时不渲染「跳过的页面」，也不留悬空分隔符', () => {
    const error = ipcError('crawler/empty', { domain: 'https://a.example/', skipped: '' });
    const text = describeIpcError(error, zh());

    expect(text).toBe('抓取 https://a.example/ 后没有得到任何可用页面');
    expect(text).not.toContain('跳过');
    expect(text).not.toMatch(/[；;，,]$/);
    expect(describeIpcError(error, en())).not.toContain('skipped');
  });

  it('三个记号各按词典翻译，url 保留，未知记号原样显示', () => {
    const error = ipcError('crawler/empty', {
      domain: 'https://a.example/',
      skipped:
        'https://a.example/news total_timeout; https://a.example/robots.txt robots_disallowed; https://a.example/x fetch_failed; https://a.example/y mystery_token',
    });
    const text = describeIpcError(error, zh());

    expect(text).toContain('https://a.example/news（总时长预算用尽）');
    expect(text).toContain('https://a.example/robots.txt（robots.txt 不允许抓取）');
    expect(text).toContain('https://a.example/x（抓取或解析失败）');
    expect(text).toContain('https://a.example/y（mystery_token）');
    expect(text).not.toContain('{{');
  });
});

describe('B-8 · crawler/network 能插 status', () => {
  it('带 status 与 url 时都插进去，且不留空洞', () => {
    const error = ipcError('crawler/network', {
      reason: 'http_status',
      status: '503',
      url: 'https://a.example/news',
    });

    expect(describeIpcError(error, zh())).toBe(
      '抓取网页失败：上游返回了非 2xx 状态码（HTTP 503），页面 https://a.example/news',
    );
    expect(describeIpcError(error, en())).toContain('HTTP 503');
  });

  it('url / status 都缺（连接期失败）时只渲染 reason，不残留占位符', () => {
    const error = ipcError('crawler/network', { reason: 'dns error: no such host' });
    const text = describeIpcError(error, zh());

    expect(text).toBe('抓取网页失败：dns error: no such host');
    expect(text).not.toContain('{{');
    expect(text).not.toContain('HTTP');
  });
});

describe('{kind}/not_found 家族', () => {
  it('kind 被翻译成人类可读名词，id 原样保留', () => {
    const error = ipcError('project/not_found', { kind: 'project', id: 'nope' });

    expect(describeIpcError(error, zh())).toBe('项目不存在（ID：nope）');
    expect(describeIpcError(error, en())).toBe('The project was not found (ID: nope)');
  });

  it('未知 kind 走 raw passthrough', () => {
    const error = ipcError('prompt_set/not_found', { kind: 'mystery_kind', id: 'x' });

    expect(describeIpcError(error, zh())).toBe('mystery_kind不存在（ID：x）');
  });
});
