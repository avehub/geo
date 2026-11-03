import type {
  AppSettings,
  EntityCard,
  PromptItem,
  PromptSet,
  Project,
  ProviderInfo,
} from '../api/types';

export const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const SET_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

/**
 * 设置页各分段测试共用的 `AppSettings` 桩。
 *
 * 抽出来是因为 Plan B 把设置页拆成五段之后，**五个测试文件**都要一份形状完整的设置：
 * 各抄一份的话，`AppSettings` 每加一段（`privacy` / `storage` 就是本轮加的）就要改五处，
 * 而漏改的那一处报的是 `tsc` 错，不是"桩过期了"。
 *
 * ⚠ `model.provider` 用 fixture 里那份 `PROVIDERS` 的 id（`'deepseek'`，无下划线），
 * 与 demo 种子的 `'deep_seek'` **刻意不同**：设置页测试走 `mockInvoke` 桩而不是 demo 假后端，
 * 断言钉的是"界面把桩里的厂商原样端出来"，两套桩数据本来就不互通
 * （`pages/en-us-page-residual.test.tsx` 的头注释把这条口径写下来了）。
 */
export function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    proxy: null,
    concurrency: { max_parallel: 3, queue_size: 200 },
    rate_limit: { requests_per_minute: 20, min_interval_ms: 1500, retry_max: 3 },
    model: {
      provider: 'deepseek',
      model: null,
      base_url: null,
      // Plan B Task 4：`ModelConfig.protocol`（DR-34）。fixture 与种子同批加，
      // 少一侧 `tsc -b` 就红（`ModelConfig` 的必填字段）。
      protocol: 'openai_compat',
      temperature: 0.3,
      timeout_secs: 60,
    },
    language: 'zh_cn',
    notify: { on_finish: true, on_risk: true, sound: false },
    privacy: {
      share_entity_card: true,
      share_prompts: true,
      share_crawled_text: true,
      share_diagnostics: false,
    },
    storage: { last_export_dir: null },
    ...overrides,
  };
}

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
      // `price` 是本轮新加的那个字段（spec 2026-10-01 · DR-60）：报价不再单列一张卡，
      // 而是每个产品自带一格 ⇒ 夹具里必须带上它，否则"价格并进产品卡"这条走查在测试里是空的。
      products: [
        {
          name: '离心泵 HY-100',
          params: ['流量 100m³/h', '扬程 32m'],
          price: '单台 8 万~30 万元',
          note: null,
        },
      ],
      service_regions: ['华东', '华南'],
      contact: { phone: '0571-88888888', email: 'info@example.com', address: '杭州市余杭区' },
    },
    field_status: {
      standard_name: 'official',
      aliases: 'official',
      founded_year: 'pending',
      qualifications: 'pending',
      // 报价口径存疑（与 demo 种子里那条 `products[0].price` 的留痕同一个故事）：
      // 三档状态在夹具里各留至少一个字段，`EntityCardPage` 的 Tag 配色用例才不是空跑。
      products: 'disputed',
      service_regions: 'official',
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
  {
    provider: 'custom',
    label_zh: '自定义服务商',
    base_url: '',
    default_model: '',
    input_per_mtok: 0,
    output_per_mtok: 0,
  },
];
