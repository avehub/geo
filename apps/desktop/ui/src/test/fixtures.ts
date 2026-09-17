import type {
  EntityCard,
  PromptItem,
  PromptSet,
  Project,
  ProviderInfo,
} from '../api/types';

export const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const SET_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
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
    ...overrides,
  };
}

export function makeEntityCard(overrides: Partial<EntityCard> = {}): EntityCard {
  return {
    project_id: PROJECT_ID,
    fields: {
      standard_name: '杭州宏宇泵业有限公司',
      aliases: ['宏宇泵业'],
      founded_year: 2006,
      qualifications: ['ISO9001', 'CCC'],
      products: [{ name: '离心泵 HY-100', params: ['流量 100m³/h', '扬程 32m'], note: null }],
      price_range: '8000-30000 元/台',
      service_regions: ['华东', '华南'],
      cases: ['某市政供水项目'],
      differentiators: ['自有铸造车间'],
      official_tone: '工业级可靠供水设备制造商',
      contact: { phone: '0571-88888888', email: 'info@example.com', address: '杭州市余杭区' },
    },
    field_status: {
      standard_name: 'official',
      aliases: 'official',
      founded_year: 'pending',
      qualifications: 'pending',
      products: 'official',
      price_range: 'disputed',
      service_regions: 'official',
      cases: 'pending',
      differentiators: 'official',
      contact: 'official',
    },
    source: {
      crawled_pages: ['https://www.hongyu-pump.example/'],
      llm_provider: 'deepseek',
      llm_model: 'deepseek-chat',
      generated_at: '2026-09-16T01:00:00Z',
    },
    completeness: 0.8,
    created_at: '2026-09-16T01:00:00Z',
    updated_at: '2026-09-16T01:00:00Z',
    ...overrides,
  };
}

export function makePromptItem(index: number, overrides: Partial<PromptItem> = {}): PromptItem {
  return {
    id: `item-${index}`,
    set_id: SET_ID,
    text: `宏宇泵业的离心泵质量怎么样？编号 ${index}`,
    intent: 'category_awareness',
    weight: 3,
    group_name: '品类认知',
    tags: [],
    source: 'template',
    competitor_ids: [],
    repeat_count: 1,
    position: index,
    ...overrides,
  };
}

export function makePromptSet(overrides: Partial<PromptSet> = {}): PromptSet {
  const items = Array.from({ length: 62 }, (_, i) => makePromptItem(i));
  return {
    id: SET_ID,
    project_id: PROJECT_ID,
    version: 1,
    label: '第 1 版题库',
    items,
    content_hash: 'hash-abc123',
    engine_scope: [],
    metric_spec_version: 'geo-metrics-v1',
    sample_size_grade: 'sufficient',
    created_at: '2026-09-16T02:00:00Z',
    notes: null,
    ...overrides,
  };
}

export const PROVIDERS: ProviderInfo[] = [
  {
    provider: 'deepseek',
    label_zh: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    default_model: 'deepseek-chat',
    input_per_mtok: 1,
    output_per_mtok: 2,
  },
  {
    provider: 'moonshot',
    label_zh: 'Moonshot',
    base_url: 'https://api.moonshot.cn/v1',
    default_model: 'moonshot-v1-8k',
    input_per_mtok: 12,
    output_per_mtok: 12,
  },
];
