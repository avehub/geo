import { beforeEach, describe, expect, it } from 'vitest';

import {
  WIZARD_DRAFT_KEY,
  emptyDraft,
  resetWizardDraftStore,
  useWizardDraft,
} from './wizard-draft';

describe('useWizardDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWizardDraftStore();
  });

  it('saveDraft 后 loadDraft 能恢复已填内容（刷新场景）', () => {
    const store = useWizardDraft.getState();
    store.patch({ brand_name: '宏宇泵业', region: '浙江杭州' });
    useWizardDraft.getState().saveDraft();

    // 模拟刷新：store 被重置，只剩 localStorage
    resetWizardDraftStore();
    expect(useWizardDraft.getState().draft.brand_name).toBe('');

    const restored = useWizardDraft.getState().loadDraft();
    expect(restored?.brand_name).toBe('宏宇泵业');
    expect(restored?.region).toBe('浙江杭州');
  });

  it('草稿写入约定的 localStorage key', () => {
    useWizardDraft.getState().patch({ brand_name: 'X' });
    useWizardDraft.getState().saveDraft();
    expect(localStorage.getItem(WIZARD_DRAFT_KEY)).toContain('X');
  });

  it('clearDraft 同时清空 localStorage 与内存状态', () => {
    useWizardDraft.getState().patch({ brand_name: 'X' });
    useWizardDraft.getState().saveDraft();
    useWizardDraft.getState().clearDraft();

    expect(localStorage.getItem(WIZARD_DRAFT_KEY)).toBeNull();
    expect(useWizardDraft.getState().draft).toEqual(emptyDraft());
    expect(useWizardDraft.getState().step).toBe(0);
  });

  it('step 在 0..4 之间收敛，不会越界', () => {
    const { next, prev, setStep } = useWizardDraft.getState();
    prev();
    expect(useWizardDraft.getState().step).toBe(0);
    for (let i = 0; i < 10; i += 1) next();
    expect(useWizardDraft.getState().step).toBe(4);
    setStep(99);
    expect(useWizardDraft.getState().step).toBe(4);
    setStep(-5);
    expect(useWizardDraft.getState().step).toBe(0);
  });

  it('损坏的草稿被忽略而不是抛错', () => {
    localStorage.setItem(WIZARD_DRAFT_KEY, '{不是 JSON');
    expect(useWizardDraft.getState().loadDraft()).toBeNull();
  });

  it('旧草稿缺字段时用默认值补齐', () => {
    localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify({ brand_name: '宏宇泵业' }));
    const restored = useWizardDraft.getState().loadDraft();
    expect(restored?.brand_name).toBe('宏宇泵业');
    expect(restored?.competitors).toEqual([]);
    expect(restored?.language).toBe('zh_cn');
  });
});
