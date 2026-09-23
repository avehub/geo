/**
 * `src/components/ProxyForm.tsx` 的占位提示走词典（#54，15c-1 §8-2 折入）。
 *
 * 与 `#47`（向导官网占位）/ `#25`（自定义接口地址占位）**同性质**：值全 ASCII
 * ⇒ 两遍 CJK 残留扫描结构上看不见它，但它确实会上屏。
 *
 * ⚠ 值**逐字搬进词典、不改文案**：加「例如：」这种前缀属改文案，按 AGENTS 规则 8
 * 要先在 demo 定稿并经产品负责人点头。
 *
 * 🔴 判据的另一半在 `i18n/no-hardcoded-strings.test.ts`：那里的 placeholder 例外表
 * **因为这一条而清空**（例外表是精确计数 ⇒ 谁再往组件里塞字面量，那边立刻红）。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import enUS from '../i18n/locales/en-US';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';
import ProxyForm from './ProxyForm';

/** 前端生产源码全集（测试文件排除）：值只许活在词典里。 */
const UI_SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function renderForm(locale?: 'en-US'): void {
  renderWithProviders(
    <ProxyForm value={{ enabled: true, url: '' }} onChange={() => undefined} />,
    locale === undefined ? undefined : { locale },
  );
}

describe('#54 · ProxyForm 的代理地址占位提示走词典', () => {
  it('两侧同批加键、值逐字等于搬进词典前的那个字面量', () => {
    expect(zhCN.settings.proxy.placeholder).toBe('http://127.0.0.1:7890');
    expect(enUS.settings.proxy.placeholder).toBe('http://127.0.0.1:7890');
  });

  it('zh-CN：界面上渲染的就是词典那句，组件源码里不再有那个字面量', () => {
    renderForm();

    expect(screen.getByPlaceholderText(zhCN.settings.proxy.placeholder)).toBeInTheDocument();
    expect(UI_SOURCES['./ProxyForm.tsx']).not.toContain('placeholder="http://127.0.0.1:7890"');
  });

  it('en-US：同一个占位提示也在（AGENTS 规则 7，zh/en 同批）', () => {
    renderForm('en-US');

    expect(screen.getByPlaceholderText(enUS.settings.proxy.placeholder)).toBeInTheDocument();
  });

  it('代理关掉时不渲染输入框（占位提示也就不会上屏）', () => {
    renderWithProviders(<ProxyForm value={null} onChange={() => undefined} />);

    expect(screen.queryByPlaceholderText(zhCN.settings.proxy.placeholder)).not.toBeInTheDocument();
  });
});
