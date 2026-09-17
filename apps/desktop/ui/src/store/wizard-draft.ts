import { create } from 'zustand';

import type {
  CompetitorDraft,
  Industry,
  Language,
  ProductSpec,
  ProjectDraft,
} from '../api/types';

export const WIZARD_DRAFT_KEY = 'geo.wizard.draft';
export const WIZARD_STEP_COUNT = 5;

/** 5 步向导的输入，与后端 `ProjectDraft` 字段一一对应。 */
export interface WizardDraftData {
  brand_name: string;
  aliases: string[];
  name: string;
  website: string;
  core_pages: string[];
  products: ProductSpec[];
  service_scope: string;
  region: string;
  language: Language;
  industry: Industry;
  industry_label: string;
  tags: string[];
  competitors: CompetitorDraft[];
}

export function emptyDraft(): WizardDraftData {
  return {
    brand_name: '',
    aliases: [],
    name: '',
    website: '',
    core_pages: [],
    products: [],
    service_scope: '',
    region: '',
    language: 'zh_cn',
    industry: 'b2b_manufacturing',
    industry_label: '',
    tags: [],
    competitors: [],
  };
}

interface WizardDraftState {
  step: number;
  draft: WizardDraftData;
  touched: boolean;
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  patch: (partial: Partial<WizardDraftData>) => void;
  saveDraft: () => void;
  loadDraft: () => WizardDraftData | null;
  clearDraft: () => void;
  reset: () => void;
}

function readStorage(): WizardDraftData | null {
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraftData>;
    // 旧版本草稿缺字段时用空值补齐，避免 undefined 传进 antd Form。
    return { ...emptyDraft(), ...parsed };
  } catch {
    // 草稿损坏不应该阻塞建项流程，直接当作没有草稿。
    return null;
  }
}

export const useWizardDraft = create<WizardDraftState>((set, get) => ({
  step: 0,
  draft: emptyDraft(),
  touched: false,

  setStep: (step) => set({ step: Math.min(Math.max(step, 0), WIZARD_STEP_COUNT - 1) }),
  next: () => get().setStep(get().step + 1),
  prev: () => get().setStep(get().step - 1),

  patch: (partial) =>
    set((state) => ({ draft: { ...state.draft, ...partial }, touched: true })),

  saveDraft: () => {
    try {
      localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(get().draft));
    } catch {
      // 隐私模式等场景写入失败，草稿只是便利功能，静默降级。
    }
  },

  loadDraft: () => readStorage(),

  clearDraft: () => {
    try {
      localStorage.removeItem(WIZARD_DRAFT_KEY);
    } catch {
      /* 忽略：清除失败不影响主流程 */
    }
    set({ draft: emptyDraft(), step: 0, touched: false });
  },

  reset: () => set({ draft: emptyDraft(), step: 0, touched: false }),
}));

/** 测试与非 hook 场景使用：直接重置 store 单例。 */
export function resetWizardDraftStore() {
  useWizardDraft.setState({ draft: emptyDraft(), step: 0, touched: false });
}

// ---------------------------------------------------------------------------
// 草稿 → 后端 DTO
// ---------------------------------------------------------------------------


function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '');
}

function nullIfEmpty(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function cleanProducts(raw: unknown): ProductSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Partial<ProductSpec> => typeof item === 'object' && item !== null)
    .filter((item) => (item.name ?? '').trim() !== '')
    .map((item) => ({
      name: (item.name ?? '').trim(),
      params: cleanList(item.params),
      note: nullIfEmpty(item.note),
    }));
}

function cleanCompetitors(raw: unknown): CompetitorDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Partial<CompetitorDraft> => typeof item === 'object' && item !== null)
    .filter((item) => (item.name ?? '').trim() !== '')
    .map((item) => ({
      name: (item.name ?? '').trim(),
      aliases: cleanList(item.aliases),
      website: nullIfEmpty(item.website),
      note: nullIfEmpty(item.note),
    }));
}

/**
 * 把向导表单值收敛成后端 `ProjectDraft`。
 *
 * 规则与 `geo_domain::ProjectDraft::validate()` 对齐：空串一律转 `null`，
 * 列表去空白去空项，`industry_label` 只在 `industry=other` 时保留。
 */
export function toProjectDraft(values: Partial<WizardDraftData>): ProjectDraft {
  const industry = values.industry ?? 'b2b_manufacturing';
  return {
    brand_name: (values.brand_name ?? '').trim(),
    aliases: cleanList(values.aliases),
    name: nullIfEmpty(values.name),
    website: nullIfEmpty(values.website),
    core_pages: cleanList(values.core_pages),
    products: cleanProducts(values.products),
    service_scope: nullIfEmpty(values.service_scope),
    region: nullIfEmpty(values.region),
    language: values.language ?? 'zh_cn',
    industry,
    industry_label: industry === 'other' ? nullIfEmpty(values.industry_label) : null,
    tags: cleanList(values.tags),
    competitors: cleanCompetitors(values.competitors),
  };
}
