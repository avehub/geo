import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EntityCardPage from './EntityCardPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';
import { PROJECT_ID, makeEntityCard } from '../test/fixtures';
import type { EntityCardRevision } from '../api/types';

const ROUTE = `/projects/${PROJECT_ID}/entity-card`;

function revision(index: number, overrides: Partial<EntityCardRevision> = {}): EntityCardRevision {
  return {
    id: `rev-${index}`,
    project_id: PROJECT_ID,
    field_path: 'standard_name',
    old_value: '旧值',
    new_value: '新值',
    status: 'official',
    note: `人工修订 ${index}`,
    edited_at: '2026-09-16T03:00:00Z',
    ...overrides,
  };
}

function stub({ completeness = 0.8 }: { completeness?: number } = {}) {
  const revisions: EntityCardRevision[] = [revision(1)];
  // 后端是有状态的：自动建档之后 get 要返回新卡，否则完整率永远停在旧值
  let current = makeEntityCard({ completeness });
  mockInvoke.stubAlways('entity_card_get', () => current);
  mockInvoke.stubAlways('entity_card_revisions', () => [...revisions]);
  mockInvoke.stubAlways('entity_card_update_field', (args) => {
    const created = revision(revisions.length + 1, {
      field_path: args.path as string,
      new_value: args.value,
      status: args.status as EntityCardRevision['status'],
      note: '人工修订：标准名',
    });
    revisions.unshift(created);
    return created;
  });
  mockInvoke.stubAlways('entity_card_autobuild', () => {
    current = makeEntityCard({ completeness: 0.95 });
    return current;
  });
  return revisions;
}

function renderPage() {
  return renderAtRoute(<EntityCardPage />, '/projects/:id/entity-card', ROUTE);
}

describe('EntityCardPage', () => {
  beforeEach(() => mockInvoke.reset());

  it('渲染完整率（0.8 → 80%）', async () => {
    stub({ completeness: 0.8 });
    renderPage();

    expect(await screen.findByText('80%')).toBeInTheDocument();
    expect(screen.getByText(/字段完整率/)).toBeInTheDocument();
  });

  it('待确认字段渲染橙色 Tag，存疑渲染红色', async () => {
    stub();
    renderPage();
    await screen.findByText('80%');

    const pending = screen.getAllByText('待确认')[0].closest('.ant-tag');
    expect(pending).not.toBeNull();
    expect(pending!.className).toContain('ant-tag-orange');

    const disputed = screen.getAllByText('存疑')[0].closest('.ant-tag');
    expect(disputed!.className).toContain('ant-tag-red');

    const official = screen.getAllByText('官方口径')[0].closest('.ant-tag');
    expect(official!.className).toContain('ant-tag-green');
  });

  it('编辑字段并保存 → 调用 entity_card_update_field 且时间线新增一条', async () => {
    stub();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('80%');
    expect(screen.getByText('人工修订 1')).toBeInTheDocument();

    const card = screen.getByTestId('entity-field-standard_name');
    await user.click(within(card).getByRole('button', { name: /编\s*辑/ }));

    const input = within(card).getByDisplayValue('杭州宏宇泵业有限公司');
    await user.clear(input);
    await user.type(input, '杭州宏宇泵业股份有限公司');
    await user.click(within(card).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockInvoke.callsOf('entity_card_update_field')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('entity_card_update_field')).toMatchObject({
      project_id: PROJECT_ID,
      path: 'standard_name',
      value: '杭州宏宇泵业股份有限公司',
      status: 'official',
    });
    expect(await screen.findByText('人工修订：标准名')).toBeInTheDocument();
  });

  it('切换字段状态为存疑后随修订一起提交', async () => {
    stub();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('80%');

    const card = screen.getByTestId('entity-field-price_range');
    await user.click(within(card).getByRole('button', { name: /编\s*辑/ }));
    // antd 按钮式 Radio 的真实 input 被 pointer-events:none 遮住，用 fireEvent 直接触发
    fireEvent.click(within(card).getByRole('radio', { name: '存疑' }));
    await user.click(within(card).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockInvoke.callsOf('entity_card_update_field')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('entity_card_update_field')).toMatchObject({
      path: 'price_range',
      status: 'disputed',
    });
  });

  it('点自动建档 → 调用 entity_card_autobuild 并展示新完整率', async () => {
    stub();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('80%');

    await user.type(screen.getByPlaceholderText('例如：www.hongyu-pump.com'), 'www.hongyu-pump.com');
    await user.click(screen.getByRole('button', { name: /自动建档/ }));

    await waitFor(() => expect(mockInvoke.callsOf('entity_card_autobuild')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('entity_card_autobuild')).toMatchObject({
      project_id: PROJECT_ID,
      domain: 'www.hongyu-pump.com',
    });
    expect(await screen.findByText('95%')).toBeInTheDocument();
  });

  it('域名为空时不发起自动建档', async () => {
    stub();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('80%');

    await user.click(screen.getByRole('button', { name: /自动建档/ }));

    expect(mockInvoke.callsOf('entity_card_autobuild')).toHaveLength(0);
    expect(await screen.findByText(/请输入要抓取的官网域名/)).toBeInTheDocument();
  });

  it('后端报错时展示中文原因', async () => {
    mockInvoke.stubAlways(
      'entity_card_get',
      { code: 'project/not_found', message: 'project 不存在：nope' },
      'reject',
    );
    mockInvoke.stubAlways('entity_card_revisions', () => []);
    renderPage();

    expect(await screen.findByText(/project 不存在/)).toBeInTheDocument();
  });
});
