/**
 * 远程内容 12 条命令的 demo 契约（Task 9）。
 *
 * 只钉**不会漂的语义**：来源标记、降级可见、legal/notices 没有内置兜底、
 * 未知规则包回 `remote/not_found`。具体文案与版本号属于种子数据，不在这里断言
 * （否则每次快照更新都要改测试）。
 */
import { describe, expect, it } from 'vitest';

import { demoBackend } from '../demo/backend';
import type { IpcErrorPayload } from './types';
import type { RemoteJsonItem, RemoteTextItem } from './types-remote';

const call = (cmd: keyof typeof demoBackend, args: Record<string, unknown> = {}) =>
  demoBackend[cmd](args);

describe('remote_* demo 契约', () => {
  it('status 如实说明"公钥未配置 + 全是内置"', async () => {
    const status = (await call('remote_status')) as {
      public_key_configured: boolean;
      degraded: boolean;
      items: unknown[];
      builtin_versions: Array<{ kernel?: string }>;
    };
    expect(status.public_key_configured).toBe(false);
    expect(status.degraded).toBe(true);
    // 没有远程缓存：items 为空，内置版本必须非空（否则设置页只能显示一张空表）
    expect(status.items).toEqual([]);
    expect(status.builtin_versions.length).toBeGreaterThan(0);
  });

  it('sync 不假装成功：demo 里恒为 unavailable', async () => {
    const report = (await call('remote_sync')) as { status: string; degraded: boolean };
    expect(report.status).toBe('unavailable');
    expect(report.degraded).toBe(true);
  });

  it('JSON 产物全部标 builtin + degraded', async () => {
    const commands = [
      'remote_rulepack_list',
      'remote_provider_presets',
      'remote_compliance_terms',
      'remote_privacy_facts',
    ] as const;
    for (const cmd of commands) {
      const item = (await call(cmd)) as RemoteJsonItem;
      expect(item.source, cmd).toBe('builtin');
      expect(item.degraded, cmd).toBe(true);
      expect(item.value, cmd).not.toBeNull();
    }
  });

  it('legal / notices 没有内置兜底 —— 必须是 source=none 且 value 为空', async () => {
    for (const cmd of ['remote_legal_index', 'remote_notice_list'] as const) {
      const item = (await call(cmd)) as RemoteJsonItem;
      expect(item.source, cmd).toBe('none');
      expect(item.value, cmd).toBeNull();
      expect(item.degraded, cmd).toBe(true);
    }
    const doc = (await call('remote_legal_get', {
      doc_id: 'privacy_policy',
      locale: 'zh-CN',
    })) as RemoteTextItem;
    expect(doc.source).toBe('none');
    expect(doc.text).toBeNull();
  });

  it('规则包：已知引擎返回正文，未知引擎回 remote/not_found', async () => {
    const pack = (await call('remote_rulepack_get', {
      engine_code: 'baidu_ziyan',
    })) as RemoteJsonItem;
    expect(pack.value).not.toBeNull();

    const err = await Promise.resolve()
      .then(() => call('remote_rulepack_get', { engine_code: 'no_such_engine' }))
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(err).toMatchObject({
      code: 'remote/not_found',
    } satisfies Partial<IpcErrorPayload>);
  });

  it('endpoint 配置与 status 同源', async () => {
    const config = (await call('remote_endpoint_config')) as {
      base_url: string;
      default_base_url: string;
    };
    expect(config.base_url).toBe(config.default_base_url);
  });
});
