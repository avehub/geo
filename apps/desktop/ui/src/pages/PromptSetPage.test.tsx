import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PromptSetPage from './PromptSetPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';
import { PROJECT_ID, SET_ID, makePromptItem, makePromptSet } from '../test/fixtures';
import { INTENT_LABELS } from '../api/types';
import type { PromptDraft, PromptItem, SampleSizeGrade } from '../api/types';

const ROUTE = `/projects/${PROJECT_ID}/prompts`;

/**
 * user-event 只填 `key`，不填 `keyCode`/`which`，而 antd 标签选择器（rc-select）
 * 的 tags 模式靠 `which === 13` 判定「回车提交新标签」。真实浏览器两者都有。
 */
function pressEnter(element: HTMLElement) {
  fireEvent.keyDown(element, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
}

const CSV = [
  'text,intent,weight,group_name,tags,source,repeat_count',
  '宏宇泵业和南方泵业哪个好？,brand_comparison,5,品牌对比,,template,1',
].join('\n');

/** 混合意图的题库：60 条品类认知 + 2 条品牌对比，共 62 条（sufficient）。 */
function mixedItems(): PromptItem[] {
  const awareness = Array.from({ length: 60 }, (_, i) => makePromptItem(i));
  const comparison = [
    makePromptItem(60, {
      id: 'item-cmp-1',
      text: '宏宇泵业和南方泵业哪个更靠谱？',
      intent: 'brand_comparison',
      group_name: '品牌对比',
      weight: 5,
      competitor_ids: ['comp-1'],
    }),
    makePromptItem(61, {
      id: 'item-cmp-2',
      text: '凯泉泵业与宏宇泵业的离心泵怎么选？',
      intent: 'brand_comparison',
      group_name: '品牌对比',
      weight: 4,
      competitor_ids: ['comp-2'],
    }),
  ];
  return [...awareness, ...comparison];
}

/**
 * 有状态的假后端：条目增删改都会改动后续 `prompt_set_get` 的返回值。
 *
 * 必须这样，否则页面刷新缓存时会把用户刚改的值又变回旧值——那既测不出真实
 * 行为，还会让 antd 的数字输入框在失焦时把旧值再提交一次（重复调用 IPC）。
 */
function stub(
  grade: SampleSizeGrade = 'sufficient',
  itemsOverride?: PromptItem[],
  notes?: string | null,
) {
  let items = itemsOverride ?? (grade === 'sufficient' ? mixedItems() : mixedItems().slice(0, 45));
  // `notes` 默认**不传**（保持 fixture 的 `null`），只有 notes 那组用例才局部覆写。
  // 这样既不必改 `src/test/fixtures.ts`（它被十几个用例共用），也不会让存量用例的行为漂移。
  const snapshot = () =>
    makePromptSet({
      items,
      sample_size_grade: grade,
      ...(notes === undefined ? {} : { notes }),
    });

  mockInvoke.stubAlways('prompt_set_list', () => {
    const set = snapshot();
    return [
      {
        id: SET_ID,
        project_id: PROJECT_ID,
        version: set.version,
        label: set.label,
        item_count: set.items.length,
        content_hash: set.content_hash,
        sample_size_grade: grade,
        created_at: set.created_at,
        notes: set.notes,
      },
    ];
  });
  mockInvoke.stubAlways('prompt_set_get', () => snapshot());
  mockInvoke.stubAlways('prompt_set_export_csv', () => CSV);
  mockInvoke.stubAlways('prompt_item_update', (args) => {
    const updated = args.item as PromptItem;
    items = items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
    return updated;
  });
  mockInvoke.stubAlways('prompt_item_add', (args) => {
    const drafts = args.items as PromptDraft[];
    const added = drafts.map((draft, index) =>
      makePromptItem(items.length + index, {
        id: `item-added-${index}`,
        text: draft.text,
        intent: draft.intent,
        weight: draft.weight ?? 3,
        group_name: draft.group_name ?? INTENT_LABELS[draft.intent],
        source: 'manual',
        repeat_count: draft.repeat_count ?? 1,
      }),
    );
    items = [...items, ...added];
    return snapshot();
  });
  mockInvoke.stubAlways('prompt_item_delete', (args) => {
    const ids = args.ids as string[];
    items = items
      .filter((item) => !ids.includes(item.id))
      .map((item, position) => ({ ...item, position }));
    return snapshot();
  });
  mockInvoke.stubAlways('prompt_set_generate', () => snapshot());
  mockInvoke.stubAlways('prompt_set_dedupe', () => ({
    kept: items,
    removed: [],
    duplicate_pairs: 0,
  }));
  mockInvoke.stubAlways('project_get', () => ({
    project: { id: PROJECT_ID, industry: 'b2b_manufacturing' },
    entity_card: null,
    competitors: [],
    assets: [],
    prompt_set_count: 1,
  }));
  return snapshot();
}

function renderPage() {
  return renderAtRoute(<PromptSetPage />, '/projects/:id/prompts', ROUTE);
}

describe('PromptSetPage', () => {
  beforeEach(() => mockInvoke.reset());

  it('grade=directional 时渲染「样本不足，仅供方向性参考」', async () => {
    stub('directional');
    renderPage();

    expect(
      await screen.findByText(/样本不足，仅供方向性参考：当前 prompt 数低于 60 条/),
    ).toBeInTheDocument();
  });

  it('grade=sufficient 时不渲染样本不足提示', async () => {
    stub('sufficient');
    renderPage();

    expect(await screen.findByText('第 1 版题库')).toBeInTheDocument();
    expect(screen.queryByText(/仅供方向性参考/)).not.toBeInTheDocument();
  });

  it('按意图筛选后只剩品牌对比条目', async () => {
    stub('sufficient');
    renderPage();
    await screen.findByText('第 1 版题库');

    // antd 按钮式 Radio 的真实 input 被 pointer-events:none 遮住，用 fireEvent 触发
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));

    const table = await screen.findByRole('table');
    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(3); // 表头 + 2 条
    });
    expect(within(table).getByText('宏宇泵业和南方泵业哪个更靠谱？')).toBeInTheDocument();
  });

  it('调整 weight 调用 prompt_item_update', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    // antd 按钮式 Radio 的真实 input 被 pointer-events:none 遮住，用 fireEvent 触发
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));

    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));

    // 第一条品牌对比 prompt 原权重为 5，改成 2 才会触发提交
    const spinbutton = within(table).getAllByRole('spinbutton')[0];
    await user.clear(spinbutton);
    await user.type(spinbutton, '2');
    await user.tab();

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('prompt_item_update')!.item as PromptItem;
    expect(sent.weight).toBe(2);
    expect(sent.id).toBe('item-cmp-1');
  });

  it('按分组筛选只留下该分组的条目', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('combobox', { name: '按分组筛选' }));
    // antd 的可见选项没有 role（role=option 是 rc-select 的无障碍镜像），按 title 点
    await user.click(await screen.findByTitle('品牌对比'));

    const table = screen.getByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    expect(within(table).getByText('凯泉泵业与宏宇泵业的离心泵怎么选？')).toBeInTheDocument();
  });

  it('按来源筛选只留下人工条目', async () => {
    const items = mixedItems();
    items[0] = { ...items[0], source: 'manual' };
    items[60] = { ...items[60], source: 'manual' };
    stub('sufficient', items);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('combobox', { name: '按来源筛选' }));
    await user.click(await screen.findByTitle('人工'));

    const table = screen.getByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    expect(within(table).queryByText('宏宇泵业的离心泵质量怎么样？编号 1')).not.toBeInTheDocument();
  });

  it('调整采样次数走 prompt_item_update 并带上 repeat_count', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));

    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const repeat = within(table).getAllByRole('spinbutton', { name: /^采样次数/ })[0];
    await user.clear(repeat);
    await user.type(repeat, '3');
    await user.tab();

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('prompt_item_update')!.item as PromptItem;
    expect(sent.id).toBe('item-cmp-1');
    expect(sent.repeat_count).toBe(3);
  });

  it('新增 prompt 走 prompt_item_add，来源由后端定为人工', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /新增 prompt/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Prompt 文本/), '宏宇泵业的消防泵能过验收吗');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_add')).toHaveLength(1));
    const args = mockInvoke.lastArgsOf('prompt_item_add')!;
    expect(args.set_id).toBe(SET_ID);
    const drafts = args.items as PromptDraft[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toBe('宏宇泵业的消防泵能过验收吗');
    expect(drafts[0].intent).toBe('category_awareness');
    expect(await screen.findByText(/已新增 1 条/)).toBeInTheDocument();
  });

  it('编辑文本走 prompt_item_update 并保留条目 id', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));
    await screen.findByText('宏宇泵业和南方泵业哪个更靠谱？');

    const row = screen.getByText('宏宇泵业和南方泵业哪个更靠谱？').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /编\s*辑/ }));
    const dialog = await screen.findByRole('dialog');
    const textarea = within(dialog).getByLabelText(/Prompt 文本/);
    await user.clear(textarea);
    await user.type(textarea, '宏宇泵业和南方泵业的售后谁响应更快');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('prompt_item_update')!.item as PromptItem;
    expect(sent.id).toBe('item-cmp-1');
    expect(sent.text).toBe('宏宇泵业和南方泵业的售后谁响应更快');
    expect(await screen.findByText(/已更新/)).toBeInTheDocument();
  });

  it('编辑时可以改标签，随条目一起提交并在表格里显示', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));
    await screen.findByText('宏宇泵业和南方泵业哪个更靠谱？');

    const row = screen.getByText('宏宇泵业和南方泵业哪个更靠谱？').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /编\s*辑/ }));
    const dialog = await screen.findByRole('dialog');
    const tagsInput = within(dialog).getByLabelText('标签');
    await user.type(tagsInput, '核心词');
    pressEnter(tagsInput);
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('prompt_item_update')!.item as PromptItem;
    expect(sent.id).toBe('item-cmp-1');
    expect(sent.tags).toContain('核心词');

    const table = screen.getByRole('table');
    expect(await within(table).findByText('核心词')).toBeInTheDocument();
  });

  it('勾选多条后一次删除，并把返回快照写回缓存', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    // 先筛到 2 条：整页 20 行在 jsdom 下渲染很慢，行为完全等价
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));
    await screen.findByText('宏宇泵业和南方泵业哪个更靠谱？');

    // 页面上还有生成面板的意图勾选框，必须把范围收进表格
    const table = screen.getByRole('table');
    const boxes = within(table).getAllByRole('checkbox');
    await user.click(boxes[1]);
    await user.click(boxes[2]);
    await user.click(screen.getByRole('button', { name: /删除选中（2）/ }));
    await user.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_delete')).toHaveLength(1));
    const args = mockInvoke.lastArgsOf('prompt_item_delete')!;
    expect(args.set_id).toBe(SET_ID);
    expect(args.ids).toEqual(['item-cmp-1', 'item-cmp-2']);
    expect(await screen.findByText(/已删除 2 条/)).toBeInTheDocument();
  });

  it('单条删除也要二次确认', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    const row = screen.getByText('宏宇泵业的离心泵质量怎么样？编号 0').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /删\s*除/ }));
    expect(mockInvoke.callsOf('prompt_item_delete')).toHaveLength(0);

    await user.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_delete')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('prompt_item_delete')!.ids).toEqual(['item-0']);
  });

  it('导出 CSV 拿到含表头的字符串', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /导出 CSV/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_export_csv')).toHaveLength(1));
    expect(await screen.findByDisplayValue(/text,intent,weight/)).toBeInTheDocument();
    expect(screen.getByText(/共 2 行/)).toBeInTheDocument();
  });

  it('导出预览点「下载文件」走系统对话框命令', async () => {
    stub('sufficient');
    mockInvoke.stubAlways('export_write_file', () => '/tmp/prompt-set-1-prompts.csv');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /导出 CSV/ }));
    await screen.findByDisplayValue(/text,intent,weight/);
    await user.click(screen.getByRole('button', { name: /下载文件/ }));

    await waitFor(() => expect(mockInvoke.callsOf('export_write_file')).toHaveLength(1));
    const args = mockInvoke.lastArgsOf('export_write_file')!;
    expect(args.with_bom).toBe(true);
    expect(String(args.default_name)).toMatch(/-prompts\.csv$/);
    expect(String(args.content)).toContain('text,intent,weight');
    expect(await screen.findByText(/CSV 已导出/)).toBeInTheDocument();
  });

  it('点击生成题库展示进度并在完成后刷新条数', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /生成题库/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_generate')).toHaveLength(1));
    const options = mockInvoke.lastArgsOf('prompt_set_generate')!.options as Record<string, unknown>;
    expect(options.target_count).toBe(80);
    expect(options.industry).toBe('b2b_manufacturing');
    expect(await screen.findByText(/hash-abc123/)).toBeInTheDocument();
  });

  it('去重后展示重复对数量', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /去重检查/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_dedupe')).toHaveLength(1));
    expect(await screen.findByText(/重复对：0/)).toBeInTheDocument();
  });
});

/**
 * `notes` 按行分派（Task 8 fix1 · 复审 Important #1 / 裁定 1）。
 *
 * # 为什么必须在这一层测
 *
 * 计划正文那条 Produces 的判据是一句**行为禁令**：「**不许**把机器行原样显示给用户」。
 * Task 8 落地了 `describeNoteLine` 与按行渲染的 `<Alert>`，但 fixture 的 `notes` 是 `null`
 * ⇒ 整个分支在测试里从不渲染，禁令零覆盖：将来谁把调用点改回 `message={promptSet.notes}`，
 * 198 条用例全绿。本组用例就是堵这个回归洞（fix1 §D-9 的变异自证打的正是它）。
 *
 * `src/i18n/no-hardcoded-strings.test.ts` 里那几条 notes 断言是**静态键集**（键存在、
 * 模板有 `{{stage}}`/`{{detail}}` 两个槽位），不证明「机器行会被解析并走词典」——两者不重叠。
 *
 * # fixture 形状取自后端真值，不是编的
 *
 * `apps/desktop/src-tauri/src/services/prompt_service.rs` 的 `degradation_note()`：
 * `DEGRADED_PREFIX = "degraded "` + `ascii_json(&json!({"stage","code","params"}))`。
 * `serde_json` 的 Map 是 BTreeMap ⇒ **键按字典序**输出（`code` / `params` / `stage`），
 * 该行自带测试 `degradation_note_is_a_single_line_ascii_machine_record` 钉住了这个形状。
 * 散文行取自同文件 `report_quota_shortfall()` 的真实格式串（竞品同框配额不足那条）。
 *
 * ⚠ 复审举例用的 `"code":"llm/timeout"` **不在** `contracts/error-codes.json` 的 43 码里
 * （超时是 `llm/transport` 的 `reason`，不是独立 code）。这里用契约内真实存在的
 * `llm/transport` + `reason:"timeout"`，另有一条用例专门钉「契约外的 code 走 raw passthrough」。
 */
describe('PromptSetPage · notes 按行分派（机器行不许原样上屏）', () => {
  /** 后端 `degradation_note("expansion", IpcError::with_params("llm/transport", [("reason","timeout")]))` 的输出。 */
  const MACHINE_LINE =
    'degraded {"code":"llm/transport","params":{"reason":"timeout"},"stage":"expansion"}';
  /** 后端 `report_quota_shortfall()` 的散文行（既存中文，裁定 §H-2 明令不许顺手改）。 */
  const PROSE_LINE = '竞品「宏宇泵业」的同框 prompt 只有 1 条，低于配额 3 条，其 SOV 仅供参考。';

  /**
   * 整行**恰好**等于词典译文：`{{stage}}` 填 `prompt.promptSet.notes.stage.expansion`，
   * `{{detail}}` 填 `describeIpcError` 对 `llm/transport` + `reason=timeout` 的渲染。
   * 写成字面量而不是在测试里重算一遍——重算等于把生产逻辑抄进测试，判据会跟着实现一起漂。
   */
  const EXPECTED_ZH =
    'AI 扩写未成功，本轮题目改由行业模板与本地改写补足（连接模型服务失败：上游响应超时，请稍后重试，或调低并发与频控设置）';
  const EXPECTED_EN =
    'AI expansion did not succeed; this batch was filled in from industry templates and local rewriting (Could not reach the model provider: the upstream provider timed out, so retry later or lower the concurrency and rate limit settings)';

  /** 静音并计数 console.warn：判据必须是结构化的，不能靠「输出里没有某行」（vitest 5 默认拦 console）。 */
  function captureWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  }

  beforeEach(() => mockInvoke.reset());
  afterEach(() => vi.restoreAllMocks());

  it('机器行走词典：整行恰好是 degraded 模板的译文，stage 与 detail 都填对', async () => {
    const warn = captureWarn();
    stub('sufficient', undefined, MACHINE_LINE);
    renderPage();

    const line = await screen.findByText(EXPECTED_ZH);

    // `toBe` 而不是 `toContain`：这一行**不允许**有任何多余字符（前缀、花括号、裸 code 都不行）
    expect(line.textContent).toBe(EXPECTED_ZH);
    expect(warn).not.toHaveBeenCalled();
  });

  it('机器行的机器记号一个都不上屏（degraded 前缀 / JSON 花括号 / 裸 code / stage 记号）', async () => {
    stub('sufficient', undefined, MACHINE_LINE);
    const { container } = renderPage();
    await screen.findByText(EXPECTED_ZH);

    // 这就是那条**行为禁令**本身：机器行不许原样显示给用户
    expect(container.textContent).not.toContain('degraded ');
    expect(container.textContent).not.toContain('{');
    expect(container.textContent).not.toContain('llm/transport');
    expect(container.textContent).not.toContain('"stage"');
    expect(container.textContent).not.toContain('expansion');
  });

  it('既存中文散文行逐字原样渲染（老数据与配额/合规那几行不许被吞）', async () => {
    const warn = captureWarn();
    stub('sufficient', undefined, PROSE_LINE);
    renderPage();

    const line = await screen.findByText(PROSE_LINE);

    expect(line.textContent).toBe(PROSE_LINE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('解析失败（degraded not-json）⇒ 原样渲染 + console.warn 恰好 1 次', async () => {
    const warn = captureWarn();
    stub('sufficient', undefined, 'degraded not-json');
    renderPage();

    const line = await screen.findByText('degraded not-json');

    expect(line.textContent).toBe('degraded not-json');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('malformed degraded note line');
  });

  it('多行 notes 逐行分派：机器行走词典、散文行原样，互不干扰', async () => {
    const warn = captureWarn();
    stub('sufficient', undefined, [PROSE_LINE, MACHINE_LINE].join('\n'));
    renderPage();

    expect((await screen.findByText(EXPECTED_ZH)).textContent).toBe(EXPECTED_ZH);
    expect(screen.getByText(PROSE_LINE).textContent).toBe(PROSE_LINE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('契约外的 code 走 raw passthrough：露出稳定记号而不是静默半句话', async () => {
    stub(
      'sufficient',
      undefined,
      'degraded {"code":"brand_new/code","params":{},"stage":"rewrite"}',
    );
    renderPage();

    // stage 记号 `rewrite` 有词条 ⇒ 译成「口语化改写」；code 查不到 ⇒ 原样露出（可排查）
    const line = await screen.findByText(/口语化改写未成功/);

    expect(line.textContent).toContain('brand_new/code');
    expect(line.textContent).not.toContain('{');
  });

  it('en-US 下机器行走英文模板（证明 detail 不是硬编码中文）', async () => {
    stub('sufficient', undefined, MACHINE_LINE);
    renderAtRoute(<PromptSetPage />, '/projects/:id/prompts', ROUTE, 'en-US');

    const line = await screen.findByText(EXPECTED_EN);

    expect(line.textContent).toBe(EXPECTED_EN);
    expect(line.textContent).not.toContain('扩写');
  });

  it('自证（对照组）：notes 为空时这一组判据不会假绿——分支确实被渲染过', async () => {
    // `notes: null`（fixture 默认值）⇒ 整个 <Alert> 不渲染。少了这条，上面几条
    // 「findByText 拿到了节点」就有可能被误读成「反正页面里总有这段文字」。
    stub('sufficient', undefined, null);
    const { container } = renderPage();
    await screen.findByText('第 1 版题库');

    expect(container.textContent).not.toContain('未成功');
    expect(screen.queryByText(EXPECTED_ZH)).not.toBeInTheDocument();
  });
});
