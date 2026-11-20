/**
 * P3-01（2026-11-07 测试报告）回归守卫：`index.html` 必须声明 favicon，
 * 且指向的图标文件真实存在。
 *
 * 背景：原先 `index.html` 没有 `<link rel="icon">`，浏览器回落请求 `/favicon.ico`
 * 得到 404，demo（`mise run web`）每次加载都在控制台留一条错误。这条守卫钉住两件事：
 * ① link 还在；② 它指向的文件没被删（只钉 link 不钉文件，删了 svg 照样绿）。
 */
import { describe, expect, it } from 'vitest';

import { readRepoFile } from '../test/repo-file';

describe('index.html 的 favicon', () => {
  const html = readRepoFile('apps', 'desktop', 'ui', 'index.html');

  it('声明了 rel="icon"，浏览器不再回落请求 /favicon.ico', () => {
    const match = html.match(/<link[^>]*rel="icon"[^>]*>/);
    expect(match, 'index.html 缺少 <link rel="icon">').not.toBeNull();
    const href = match?.[0].match(/href="([^"]+)"/)?.[1];
    expect(href, 'icon link 必须有 href').toBeTruthy();
    expect(href?.startsWith('/'), 'icon 走 public/ 的绝对路径').toBe(true);
  });

  it('link 指向的图标文件真实存在', () => {
    const href = html.match(/<link[^>]*rel="icon"[^>]*href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    const name = href?.replace(/^\//, '') ?? '';
    const body = readRepoFile('apps', 'desktop', 'ui', 'public', name);
    expect(body.length).toBeGreaterThan(0);
  });
});
