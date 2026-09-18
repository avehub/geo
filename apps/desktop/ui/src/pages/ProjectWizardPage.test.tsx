import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ProjectWizardPage from './ProjectWizardPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { makeProject } from '../test/fixtures';
import { WIZARD_DRAFT_KEY, resetWizardDraftStore } from '../store/wizard-draft';

const NEXT = /下一步/;

function nextButton() {
  return screen.getByRole('button', { name: NEXT });
}

/** 从 DOM 读出当前步序号（0-based），避免测试里手工维护状态。 */
function currentStep(): number {
  const label = screen.getByText(/^第 \d+ 步$/);
  return Number(label.textContent?.replace(/\D/g, '') ?? '1') - 1;
}

async function stepForward(user: ReturnType<typeof userEvent.setup>) {
  const before = currentStep();
  await user.click(nextButton());
  await waitFor(() => expect(currentStep()).toBe(before + 1));
}

/** 前进到第 `index` 步（0-based，绝对定位）。 */
async function gotoStep(user: ReturnType<typeof userEvent.setup>, index: number) {
  await waitFor(() => expect(currentStep()).toBeLessThanOrEqual(index));
  while (currentStep() < index) await stepForward(user);
}

describe('ProjectWizardPage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWizardDraftStore();
    mockInvoke.stubAlways('project_create', () => makeProject());
  });

  it('品牌名为空点下一步 → 显示校验错误且停在第 1 步', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    expect(screen.getByText('第 1 步')).toBeInTheDocument();
    await user.click(nextButton());

    expect(await screen.findByText('请输入品牌名')).toBeInTheDocument();
    expect(screen.getByText('第 1 步')).toBeInTheDocument();
    expect(screen.queryByText('第 2 步')).not.toBeInTheDocument();
    expect(mockInvoke.callsOf('project_create')).toHaveLength(0);
  });

  it('填完 5 步提交 → project_create 参数含 3 个竞品', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), '宏宇泵业');
    await gotoStep(user, 1);
    await user.type(screen.getByLabelText('官网'), 'https://www.hongyu-pump.example');
    await gotoStep(user, 2);
    // 产品线初始为空，需要先添加一行
    await user.click(screen.getByRole('button', { name: /添加产品/ }));
    await user.type(screen.getByPlaceholderText('例如：离心泵'), '离心泵');
    await gotoStep(user, 3);
    await user.type(screen.getByLabelText('服务地域'), '浙江杭州');
    await gotoStep(user, 4);

    for (const name of ['南方泵业', '凯泉泵业', '格兰富']) {
      await user.click(screen.getByRole('button', { name: /添加竞品/ }));
      const inputs = screen.getAllByPlaceholderText('竞品名称');
      await user.type(inputs[inputs.length - 1], name);
    }

    await user.click(screen.getByRole('button', { name: /创建项目/ }));

    await waitFor(() => expect(mockInvoke.callsOf('project_create')).toHaveLength(1));
    const draft = mockInvoke.lastArgsOf('project_create')!.draft as Record<string, unknown>;
    expect(draft.brand_name).toBe('宏宇泵业');
    expect(draft.website).toBe('https://www.hongyu-pump.example');
    expect(draft.region).toBe('浙江杭州');
    expect(draft.competitors).toHaveLength(3);
    expect((draft.competitors as { name: string }[]).map((item) => item.name)).toEqual([
      '南方泵业',
      '凯泉泵业',
      '格兰富',
    ]);
  });

  it('竞品少于 3 家时阻止提交并提示', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), '宏宇泵业');
    await gotoStep(user, 4);
    await user.click(screen.getByRole('button', { name: /添加竞品/ }));
    await user.type(screen.getByPlaceholderText('竞品名称'), '南方泵业');
    await user.click(screen.getByRole('button', { name: /创建项目/ }));

    expect(await screen.findByText(/至少填写 3 家竞品/)).toBeInTheDocument();
    expect(mockInvoke.callsOf('project_create')).toHaveLength(0);
  });

  it('可以回退到上一步且已填内容保留', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), '宏宇泵业');
    await gotoStep(user, 1);
    await user.click(screen.getByRole('button', { name: /上一步/ }));

    expect(await screen.findByText('第 1 步')).toBeInTheDocument();
    expect(screen.getByLabelText('品牌名')).toHaveValue('宏宇泵业');
  });

  it('输入即写入本地草稿，刷新可恢复', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), '宏宇泵业');

    await waitFor(() => {
      const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string).brand_name).toBe('宏宇泵业');
    });
  });

  it('存在草稿时提示恢复，点「恢复草稿」把内容填回表单', async () => {
    localStorage.setItem(
      WIZARD_DRAFT_KEY,
      JSON.stringify({ brand_name: '草稿品牌', region: '江苏南京' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    const alert = await screen.findByText(/检测到上次未完成的建档草稿/);
    await user.click(within(alert.closest('.ant-alert')!).getByRole('button', { name: /恢复草稿/ }));

    await waitFor(() => expect(screen.getByLabelText('品牌名')).toHaveValue('草稿品牌'));
  });
});
