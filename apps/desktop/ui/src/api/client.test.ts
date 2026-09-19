import { describe, expect, it } from 'vitest';

import * as client from './client';
import { describeIpcError } from './errors';
import { i18n } from '../i18n';
import { makeProject } from '../test/fixtures';
import { mockInvoke } from '../test/invoke-mock';

const project = {
  id: 'p-1',
  name: '宏宇泵业 GEO',
  brand_name: '宏宇泵业',
  aliases: ['宏宇'],
  website: 'https://www.hongyu-pump.example',
  region: '浙江杭州',
  language: 'zh_cn',
  industry: 'b2b_manufacturing',
  industry_label: null,
  tags: ['水泵'],
  status: 'active',
  archived_at: null,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
};

describe('api/client', () => {
  it('projectList 在 mock invoke 下返回项目数组', async () => {
    mockInvoke.stub('project_list', () => [project]);

    const result = await client.projectList({ include_archived: false });

    expect(result).toHaveLength(1);
    expect(result[0].brand_name).toBe('宏宇泵业');
    expect(mockInvoke.callsOf('project_list')).toHaveLength(1);
    expect(mockInvoke.lastArgsOf('project_list')).toEqual({ filter: { include_archived: false } });
  });

  // fixture 用契约内的真实形状（复审 F-2h②）：`store/sqlx` 后端零发射点
  // （`StoreError::Sqlx` 映射成 `state/conflict` 或 `io/failed`，`geo-store/src/error.rs:146`-`:152`），
  // 拿它当 fixture 会让「后端报错」这条路径永远走词典 miss，页面级错误渲染等于没测。
  it('后端返回 IpcError 时抛出带稳定 code、params 与紧凑 message 的 Error', async () => {
    mockInvoke.stub(
      'project_list',
      {
        code: 'io/failed',
        params: { reason: 'Permission denied (os error 13)' },
        message: 'io/failed reason=Permission denied (os error 13)',
      },
      'reject',
    );

    const error = (await client.projectList({}).catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect(error.code).toBe('io/failed');
    expect(error.params).toEqual({ reason: 'Permission denied (os error 13)' });
    expect(error.message).toBe('io/failed reason=Permission denied (os error 13)');
    // 词典渲染出来是人话，不是紧凑串
    expect(describeIpcError(error, i18n.getFixedT('zh-CN'))).toBe(
      '文件或数据库读写失败：Permission denied (os error 13)',
    );
  });

  it('抛出的错误保留稳定错误码', async () => {
    mockInvoke.stub(
      'project_get',
      { code: 'project/not_found', message: 'project 不存在：nope' },
      'reject',
    );

    const error = await client.projectGet('nope').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect((error as client.IpcRequestError).code).toBe('project/not_found');
  });

  // B-2（复审 I-1）：这里曾经合成 `ipc/internal`，而它的模板**没有占位符**
  // （契约把 params 冻结成 `[]`）⇒ 命令名与真实原因被词典整个吞掉，用户只看到
  // 「内部错误，请重试」——对确定性的参数形状不匹配而言还是个错建议。
  it('非结构化异常包装为 ipc/invoke_failed，命令名与原因都留在 params 里', async () => {
    mockInvoke.stub('settings_get', new TypeError('boom'), 'reject');

    const error = (await client.settingsGet().catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error.code).toBe('ipc/invoke_failed');
    expect(error.params).toEqual({ cmd: 'settings_get', reason: 'boom' });
    // message 是语言中立的紧凑串，与后端 `IpcError::with_params` 同构（键按 BTreeMap 排序）
    expect(error.message).toBe('ipc/invoke_failed cmd=settings_get reason=boom');
  });

  it('B-2 · 合成出来的错误经词典渲染后，命令名与真实原因都还在（信息量不回退）', async () => {
    // 这才是本条的真正判据：将来有人把 code 改回 `ipc/internal`，这两行就会红。
    mockInvoke.stub(
      'project_update',
      'invalid args `project` for command `project_update`: command project_update missing required key status',
      'reject',
    );

    const error = (await client.projectUpdate(makeProject()).catch((cause: unknown) => cause)) as client.IpcRequestError;
    const zhText = describeIpcError(error, i18n.getFixedT('zh-CN'));
    const enText = describeIpcError(error, i18n.getFixedT('en-US'));

    for (const text of [zhText, enText]) {
      expect(text).toContain('project_update');
      expect(text).toContain('missing required key status');
      expect(text).not.toContain('内部错误');
      expect(text).not.toContain('Internal error');
    }
    expect(zhText).toBe(
      '调用 project_update 失败：invalid args `project` for command `project_update`: command project_update missing required key status',
    );
  });

  it('promptSetGenerate 透传生成参数', async () => {
    mockInvoke.stub('prompt_set_generate', () => ({ id: 's-1', items: [] }));

    await client.promptSetGenerate('p-1', { target_count: 80, industry: 'b2b_manufacturing' });

    expect(mockInvoke.lastArgsOf('prompt_set_generate')).toEqual({
      project_id: 'p-1',
      options: { target_count: 80, industry: 'b2b_manufacturing' },
    });
  });

  it('命令名集合稳定，防止前后端漂移', () => {
    expect(client.IPC_COMMANDS.length).toBeGreaterThan(30);
    expect(new Set(client.IPC_COMMANDS).size).toBe(client.IPC_COMMANDS.length);
    expect(client.IPC_COMMANDS).toContain('entity_card_autobuild');
  });
});
