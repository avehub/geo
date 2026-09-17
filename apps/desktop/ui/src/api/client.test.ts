import { describe, expect, it } from 'vitest';

import * as client from './client';
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

  it('后端返回 IpcError 时抛出带中文 message 的 Error', async () => {
    mockInvoke.stub(
      'project_list',
      { code: 'store/sqlx', message: '数据库读写失败', detail: null },
      'reject',
    );

    await expect(client.projectList({})).rejects.toThrow('数据库读写失败');
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

  it('非结构化异常包装为 internal 错误码', async () => {
    mockInvoke.stub('settings_get', new TypeError('boom'), 'reject');

    const error = await client.settingsGet().catch((cause: unknown) => cause);
    expect((error as client.IpcRequestError).code).toBe('ipc/internal');
    expect((error as client.IpcRequestError).message).toContain('boom');
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
