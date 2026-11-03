import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ProjectWizardPage from './ProjectWizardPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { makeProject } from '../test/fixtures';
import { WIZARD_DRAFT_KEY, resetWizardDraftStore } from '../store/wizard-draft';
import enUS from '../i18n/locales/en-US';
import zhCN from '../i18n/locales/zh-CN';

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
    const view = renderWithProviders(<ProjectWizardPage />);
    const invalidate = vi.spyOn(view.queryClient, 'invalidateQueries');

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
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] }));
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

  /**
   * 裁定 B-2：页面级冒烟（静态 chrome）。这一页在 Task 9 之前连 `useTranslation` 都没接，
   * 所以这条用例同时钉住「页面拿到了 `t`」。步骤条与表单字段是 Task 8 的抽取面，不重复断言。
   */
  it('B-2 · 页面骨架文案在 en-US 下渲染成英文', () => {
    renderWithProviders(<ProjectWizardPage />, { locale: 'en-US' });

    expect(screen.getByRole('heading', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文', () => {
    renderWithProviders(<ProjectWizardPage />);

    expect(screen.getByRole('heading', { name: '新建项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /取消/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上一步/ })).toBeDisabled();
  });

  /**
   * 裁定 B-5：`IpcRequestError` 那一支改走 `describeIpcError(error, t)`。
   * 原来是 `error.userMessage`——而它返回的就是**紧凑日志串**（那句文档注释早已失真），
   * getter 本轮已删。判据是「词典渲染出的人话上屏」+「紧凑串不上屏」。
   */
  it('B-5 · 后端拒绝创建时按词典渲染原因，不再读已删除的 userMessage', async () => {
    // `beforeEach` 已经 `stubAlways('project_create', …)`，而 invoke-mock 是 FIFO 取桩：
    // 直接再 push 一条会先命中旧的成功桩。所以先 reset 再挂唯一一条 reject 桩。
    mockInvoke.reset();
    mockInvoke.stubAlways(
      'project_create',
      {
        code: 'io/failed',
        params: { reason: 'Permission denied (os error 13)' },
        message: 'io/failed reason=Permission denied (os error 13)',
      },
      'reject',
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), '宏宇泵业');
    await gotoStep(user, 1);
    await user.type(screen.getByLabelText('官网'), 'https://www.hongyu-pump.example');
    await gotoStep(user, 2);
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

    // 页面内的 <Alert message={submitError}> 与 antd 的 message.error toast 是同一句话，
    // 所以用 findAllByText（两处都该出现），不用 findByText（会因多命中而抛）。
    const rendered = await screen.findAllByText(
      '文件或数据库读写失败：Permission denied (os error 13)',
    );
    // §B-12：既然就地注释已写明是**两个面**（页面内 <Alert> + antd toast），就该钉死 2，
    // 少一个面（例如 Alert 被摘掉）也要红。这是新增断言的收紧，不是把精确匹配放宽。
    expect(rendered.length).toBe(2);
    expect(screen.queryByText(/io\/failed reason=/)).not.toBeInTheDocument();
    expect(screen.queryByText('创建失败，请检查填写内容')).not.toBeInTheDocument();
  });

  /**
   * #47（15a §8-3）：`WizardSteps.tsx` 第 2 步的官网占位提示也要走词典。
   *
   * 它**全 ASCII**，两遍 CJK 残留扫描看不见它，但确实会上屏 ⇒ 与 15a 处理过的
   * `corePagesPlaceholder`（`…/about` 那条）同性质、同办法：**值逐字搬进词典、不改文案**
   * （加「例如：」这种前缀属改文案，AGENTS 规则 8 要产品负责人先点头）。
   */
  it('#47 · 官网占位提示走词典，且值逐字等于搬进词典前的那个字面量', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectWizardPage />);

    await user.type(screen.getByLabelText('品牌名'), 'HongYu');
    await gotoStep(user, 1);

    // 两侧逐字同一个 URL：它本来就是语言中立的示例地址，搬进词典不是为了翻译，是为了不留硬编码
    expect(zhCN.project.wizard.websitePlaceholder).toBe('https://www.example.com');
    expect(enUS.project.wizard.websitePlaceholder).toBe('https://www.example.com');
    // 组件真的查词典：渲染出来的 placeholder 就是词典值，不是同形字面量
    expect(screen.getByPlaceholderText(zhCN.project.wizard.websitePlaceholder)).toBeInTheDocument();
    // 防空跑：同一个 Form.Item 的 label 仍在（别是整步没渲染出来的假绿）
    expect(screen.getByLabelText('官网')).toBeInTheDocument();
  });
});
