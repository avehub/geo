/**
 * 静态种子数据的**自检**与**漂移守卫**（Task 11 · 简报 §B-5 / §B-6）。
 *
 * 两类断言，刻意分开：
 * - **数据自检**：种子内部是否自洽（条目数 ↔ 样本量档位、`field_status` 的键 ↔ `EntityFields`
 *   的字段名、竞品下标 ↔ 竞品 id、时间戳 ↔ 固定 RFC3339 字面量）。自检**不是**领域算法
 *   （AGENTS 规则 9 的红线是「不许在 demo 里算去重率 / 完整率 / 样本量分级」），它只是把
 *   「种子写错了」变成红的，而不是变成界面上一个走查不出来的空洞。
 * - **漂移守卫**：把种子钉在**外部真值源**上——provider 表钉在 zh-CN 词典（词典那批值当初
 *   就是照 `LlmProvider::label_zh()` 逐字抄的），设置默认值钉在 `crates/geo-store` 的
 *   `impl Default`，`metric_spec_version` 钉在 `crates/geo-domain/src/prompt.rs`。
 *   真值源变了而种子没跟上 ⇒ 这里红（Task 9b 的 `Baike`/`百科词条` 漂移就是这么漏过去的）。
 */
import { describe, expect, it } from 'vitest';

import {
  CONTENT_STATUS_VALUES,
  FIELD_STATUS_VALUES,
  INTENT_VALUES,
  KEYWORD_KIND_VALUES,
  LIBRARY_SOURCE_VALUES,
  PROMPT_SOURCE_VALUES,
  RANK_BAND_VALUES,
  SEARCH_OPPORTUNITY_STATUS_VALUES,
  SEARCH_RULE_ID_VALUES,
  SEARCH_RULE_KEY_BY_ID,
  SEARCH_SOURCE_VALUES,
  SELF_INDEX_SNAPSHOT_KIND_VALUES,
  SITE_CHANNEL_KIND_VALUES,
  SITE_PATCH_STATUS_VALUES,
} from '../api/types';
import { RUST_REVIEW_CONFIDENCE_FLOOR } from '../test/truth-source';
import {
  MINIMUM_SAMPLE_SIZE,
  REVIEW_CONFIDENCE_FLOOR,
  SELF_INDEX_RETENTION_DAYS,
  STALE_AFTER_DAYS,
  SUFFICIENT_SAMPLE_SIZE,
} from '../api/constants';
import { enumLabel } from '../i18n/enum-label';
import { i18n, initI18n } from '../i18n';
import { createDemoDb, demoSecretRef } from './db';
import { readRepoFile } from '../test/repo-file';
import {
  SEED_ACTIVE_COMPETITOR_IDS,
  SEED_ACTIVE_PROJECT_ID,
  SEED_ARCHIVED_PROJECT_ID,
  SEED_ASSETS,
  SEED_COMPETITORS,
  SEED_PROJECTS,
} from './seed/projects';
import { SEED_ENTITY_CARD_REVISIONS, SEED_ENTITY_CARDS } from './seed/entity-cards';
import { SEED_FAQS, SEED_FAQ_GENERATED_POOL } from './seed/faqs';
import { SEED_KEYWORDS, SEED_KEYWORD_GENERATED_POOL } from './seed/keywords';
import { SEED_KB_ENTRIES, SEED_KB_REVISIONS } from './seed/kb';
import { KB_FIELDS } from '../components/kb-fields';
import { KB_REVISION_BODY_LIMIT } from './handlers/kb-revision';
import { SEED_PROMPT_ITEMS, SEED_PROMPT_SETS } from './seed/prompt-sets';
import { INSUFFICIENT_PROMPT_ROWS } from './seed/prompt-items-insufficient';
import { SUFFICIENT_PROMPT_ROWS } from './seed/prompt-items-sufficient';
import { SEED_MODEL_CATALOGS } from './seed/model-catalogs';
import { SEED_SETTINGS } from './seed/settings';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_COLLECTION_TASKS,
  SEED_ENGINE_RUNS,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
  SEED_USAGE_BOARD,
} from './seed/collection-rounds';
import { SEED_RETRY_OUTCOMES } from './seed/collection-records-retest';
import {
  SEED_ALERTS,
  SEED_COMPETITOR_MATRICES,
  SEED_DIAGNOSIS_OVERVIEWS,
  SEED_TREND,
} from './seed/diagnosis';
import { alertMetricUnit } from '../components/format';
import {
  DEFAULT_FAQ_GENERATE_OPTIONS,
  DEFAULT_KEYWORD_GENERATE_OPTIONS,
} from '../components/library-generate-defaults';
import { SEED_ACTIONS, SEED_ATTRIBUTION_CARDS, SEED_CONTENT_TEMPLATES } from './seed/actions';
import { SEED_FACT_CHECK_ISSUES, SEED_FACT_CHECK_SUMMARIES, SEED_RETRY_INSIGHTS } from './seed/insights';
import { EVIDENCE_COLUMN_KEYS, SEED_REPORTS, SEED_VARIANT_SECTIONS } from './seed/reports';
import {
  SEED_SITE_CHANNELS,
  SEED_SITE_CHANNEL_PROBES,
  SEED_SITE_DOMAIN,
  SEED_SITE_PAGES,
  SEED_SITE_PATCHES,
  SEED_SITE_PATCH_EVENTS,
  SEED_SITE_PATCH_POOL,
  SEED_SITE_PROFILE,
} from './seed/site';
import {
  AGGREGATE_WINDOW_LIMITED_KEY,
  SEARCH_TRAFFIC_ENGINE_VALUES,
  SUGGEST_NOW_KEY,
  defaultSearchFilter,
  filterMetrics,
  isAnalyticsSource,
  isStaleData,
  suggestSources,
  summarizeMetrics,
} from '../api/search-compose';
import { SEARCH_CTR_BENCHMARKS, ctrReferenceBand } from '../api/search-benchmark';
import {
  SEARCH_SOURCE_CATALOG,
  catalogEntryOf,
  resolveDataThrough,
  searchSecretRef,
} from '../api/search-catalog';
import { MAPPING_VERSION } from '../api/search-mapping';
import {
  SEED_SEARCH_AI_OVERVIEWS,
  SEED_SEARCH_AS_OF,
  SEED_SEARCH_DATA_THROUGH,
  SEED_SEARCH_GSC_DATA_THROUGH,
  SEED_SEARCH_NATIVE_EXTRAS,
  SEED_SEARCH_OPPORTUNITIES,
  SEED_SEARCH_PERIOD_END,
  SEED_SEARCH_PERIOD_START,
  SEED_SEARCH_QUERY_METRICS,
  SEED_SEARCH_SOURCES,
  SEED_SEARCH_SOURCE_PROBES,
  SEED_SEARCH_TOUTIAO_DATA_THROUGH,
  SEED_SEARCH_TRAFFIC_SPLIT,
  SEED_SELF_INDEX_SNAPSHOTS,
} from './seed/search-data';
import type { SearchFilter } from '../api/search-compose';
import type {
  AttributionMetricKey,
  CompetitorMatrixRow,
  SearchOpportunity,
  SearchQueryMetric,
  SearchRuleId,
} from '../api/types';

/** 深度遍历：把每个字符串连同它的键名交给 visit（键名为 null 表示数组元素）。 */
function walk(value: unknown, key: string | null, visit: (key: string | null, text: string) => void): void {
  if (typeof value === 'string') {
    visit(key, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, key, visit);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) walk(child, childKey, visit);
  }
}

const RFC3339_SHAPE = /^\d{4}-\d{2}-\d{2}T/;
/** 种子的时间戳一律是**固定字面量**，全部落在演示数据那个月（§B-4：不许 `new Date()`）。 */
const FIXED_SEED_WINDOW = /^2026-09-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ASCII_ID = /^[a-z0-9][a-z0-9-]*$/;

describe('demo/seed · provider 表的漂移守卫（§B-6）', () => {
  it('种子的 provider id 集合与顺序 == zh-CN 词典 settings.providers 的键集合与顺序', () => {
    initI18n('zh-CN');
    // 用 i18next 自己的 API 取键集（§B-6：不手写字典树遍历）；ns 固定是默认的 translation。
    const bundle = i18n.getResourceBundle('zh-CN', 'translation');
    const dictionaryIds: string[] = Object.keys(bundle.settings.providers);

    // 🔴 Plan B Task 4（DR-33）：**12** 个 = Rust `LlmProvider::all()` 那 7 个 + demo 独有的
    // 5 家中转站。顺序是产品事实（界面就按这个顺序排）：6 家国内厂商 → 5 家中转站 → `custom` 末位。
    // 后 5 个在 Rust 侧还没有对应枚举成员 ⇒ 桌面端今天会少 5 项，差异登记 E-47。
    expect(dictionaryIds).toEqual([
      'deep_seek',
      'moonshot',
      'volcengine_ark',
      'ali_bailian',
      'baidu_qianfan',
      'tencent_hunyuan',
      'openrouter',
      'siliconflow',
      '302ai',
      'yunwu',
      'deepbricks',
      'custom',
    ]);
    expect(SEED_SETTINGS.providers.map((info) => info.provider)).toEqual(dictionaryIds);
  });

  /**
   * 5 家中转站的预设行自检（DR-33）。三条判据都是"抄错了会静默跑不通"的那种：
   * ① 地址是各家**公开文档里的** OpenAI 兼容根路径（`/v1` 结尾，不是 `/chat/completions`）；
   * ② 价格填 0 且**字段照留**：中转站的价格随上游模型浮动，填一个具体数字就是编数据
   *    （与 `custom` 同一口径，Q4 决议本来也不上屏价目）；
   * ③ `default_model` 必须是**该家清单里真有的**那个名字（清单在 `seed/model-catalogs.ts`）。
   */
  it('5 家中转站：地址形状、价格填 0、默认模型在自己的清单里', () => {
    const relays = ['openrouter', 'siliconflow', '302ai', 'yunwu', 'deepbricks'];

    for (const provider of relays) {
      const info = SEED_SETTINGS.providers.find((row) => row.provider === provider);
      expect(info, `${provider} 不在预设表里`).toBeDefined();
      expect(info!.base_url, provider).toMatch(/^https:\/\/[^\s]+\/v1$/);
      expect(info!.input_per_mtok, provider).toBe(0);
      expect(info!.output_per_mtok, provider).toBe(0);
      expect(info!.label_zh.length, `${provider} 的 zh 标签太短（会撞 en-US 残留守卫的 M-1 闸门）`)
        .toBeGreaterThan(4);
      expect(SEED_MODEL_CATALOGS[provider], provider).toContain(info!.default_model);
    }
  });

  it('每个 label_zh 逐字等于词典里 settings.providers.<id> 的值（后端 label_zh 的镜像）', () => {
    initI18n('zh-CN');
    const t = i18n.getFixedT('zh-CN');

    for (const info of SEED_SETTINGS.providers) {
      // enumLabel 查不到时回退 id 本身 ⇒ 词典漏键会让这条断言红，而不是静默通过。
      const rendered = enumLabel(t, 'settings.providers', info.provider);
      expect(rendered, info.provider).not.toBe(info.provider);
      expect(info.label_zh, info.provider).toBe(rendered);
    }
  });

  it('settings.language / model.provider / metric_spec_version / engine_scope 四颗钉子', () => {
    // A-7：`AppSettings.language` 是**生成内容的语言**（下划线），不是界面语言的 `zh-CN`。
    expect(SEED_SETTINGS.app.language).toBe('zh_cn');
    // A-6：demo 是假后端、直接对前端说话 ⇒ 必须写归一化后的稳定 id，不是 geo-store 的别名。
    expect(SEED_SETTINGS.app.model.provider).toBe('deep_seek');
    expect(SEED_SETTINGS.app.model.provider).not.toBe('deepseek');
    // Task 4：协议默认档是 `openai_compat`（两档里的中立档，也是今天 11 家预设实际在走的那一档）。
    expect(SEED_SETTINGS.app.model.protocol).toBe('openai_compat');
    // A-8：METRIC_SPEC_VERSION 与 PromptSet::new 的空 engine_scope。
    for (const set of SEED_PROMPT_SETS) {
      expect(set.metric_spec_version, set.id).toBe('geo-metrics-v1');
      expect(set.engine_scope, set.id).toEqual([]);
    }
  });

  it('AppSettings 的其余默认值逐字镜像 crates/geo-store/src/settings.rs 的 impl Default', () => {
    expect(SEED_SETTINGS.app.proxy).toBeNull();
    expect(SEED_SETTINGS.app.concurrency).toEqual({ max_parallel: 3, queue_size: 200 });
    expect(SEED_SETTINGS.app.rate_limit).toEqual({
      requests_per_minute: 20,
      min_interval_ms: 1500,
      retry_max: 3,
    });
    // 🔴 `protocol` 是 Plan B Task 4 加的（DR-34）：Rust 的 `ModelConfig` 里**还没有**这个字段，
    // 所以它不在"逐字镜像 impl Default"的范围内，默认值 `openai_compat` 是 demo 先冻结的契约。
    expect(SEED_SETTINGS.app.model).toEqual({
      provider: 'deep_seek',
      model: null,
      base_url: null,
      protocol: 'openai_compat',
      temperature: 0.3,
      timeout_secs: 60,
    });
    expect(SEED_SETTINGS.app.notify).toEqual({ on_finish: true, on_risk: true, sound: false });
  });

  /**
   * 🔴 `privacy` / `storage` 两段是 **demo 独有**（Plan B Task 3 · 差异 E-48）。
   *
   * 上一条用例钉的是"逐字镜像 Rust 的 `impl Default`"，这两段恰恰**不在**那份真值源里：
   * 隐私开关与导出目录是先在 demo 里定的形状，落库要等 Plan C。所以这里钉两件事——
   * ① 默认值本身（`share_diagnostics` 默认关，其余三项默认开）；
   * ② **真值源里确实没有同名字段**：这条反向断言让"哪天 Rust 侧补上了这两段"变成一次
   *    必须回来处理的红，而不是让 demo 与后端各说各话。
   */
  it('privacy / storage 是 demo 独有的两段：默认值钉死，且 Rust 真值源里没有同名字段', () => {
    expect(SEED_SETTINGS.app.privacy).toEqual({
      share_entity_card: true,
      share_prompts: true,
      share_crawled_text: true,
      share_diagnostics: false,
    });
    expect(SEED_SETTINGS.app.storage).toEqual({ last_export_dir: null });

    const rustSettings = readRepoFile('crates', 'geo-store', 'src', 'settings.rs');
    // 🔴 `protocol`（Task 4 / DR-34）与上面 5 个字段同族：`ModelConfig.protocol` 在 Rust 侧
    // 还不存在，默认值 `openai_compat` 是 demo 先冻结的契约。一并挂在这条反向断言上，
    // "哪天 Rust 补齐了"就变成一次必须回来核对 E-48 的红，而不是两侧各说各话。
    for (const field of ['share_entity_card', 'share_prompts', 'share_crawled_text', 'share_diagnostics', 'last_export_dir', 'protocol']) {
      expect(rustSettings.includes(field), `${field} 已经出现在 Rust 侧了 ⇒ 差异 E-48 要重新核对`).toBe(false);
    }
  });

  it('ProviderInfo 的价格字段照填（Q4：不展示，但不许填 0 或删字段）', () => {
    const byId = new Map(SEED_SETTINGS.providers.map((info) => [info.provider, info]));
    expect(byId.get('deep_seek')?.input_per_mtok).toBe(2);
    expect(byId.get('deep_seek')?.output_per_mtok).toBe(8);
    expect(byId.get('baidu_qianfan')?.input_per_mtok).toBe(120);
    expect(byId.get('custom')?.input_per_mtok).toBe(0);
    expect(byId.get('custom')?.base_url).toBe('');
    expect(byId.get('custom')?.default_model).toBe('');
  });

  it('密钥状态只有 secret_ref 字符串，形状是 keyring://llm/<provider>（AGENTS 规则 3）', () => {
    const db = createDemoDb();

    expect(db.secrets.map((secret) => secret.provider)).toEqual(
      SEED_SETTINGS.providers.map((info) => info.provider),
    );
    for (const secret of db.secrets) {
      expect(secret.secret_ref).toBe(demoSecretRef(secret.provider));
      expect(secret.secret_ref).toBe(`keyring://llm/${secret.provider}`);
      expect(secret.configured).toBe(false);
      // 规则 3：种子与库里都不许出现任何形如 API Key 的值。
      expect(Object.keys(secret).sort()).toEqual(['configured', 'provider', 'secret_ref']);
    }
  });
});

describe('demo/seed · 项目 / 竞品 / 资产', () => {
  it('4 个项目：3 个 active（archived_at 为 null）、1 个 archived（archived_at 有值）', () => {
    expect(SEED_PROJECTS).toHaveLength(4);
    expect(SEED_PROJECTS.map((project) => project.status)).toEqual([
      'active',
      'archived',
      'active',
      'active',
    ]);
    expect(SEED_PROJECTS[0].id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(SEED_PROJECTS[0].archived_at).toBeNull();
    expect(SEED_PROJECTS[1].id).toBe(SEED_ARCHIVED_PROJECT_ID);
    expect(SEED_PROJECTS[1].archived_at).not.toBeNull();
    for (const project of SEED_PROJECTS) {
      expect(project.language, project.id).toBe('zh_cn');
      expect(project.name.length, project.id).toBeGreaterThan(0);
      expect(project.brand_name.length, project.id).toBeGreaterThan(0);
    }
  });

  it('竞品与资产都挂在种子里存在的项目上，position 与数组序一致', () => {
    const projectIds = new Set(SEED_PROJECTS.map((project) => project.id));
    for (const competitor of SEED_COMPETITORS) {
      expect(projectIds.has(competitor.project_id), competitor.id).toBe(true);
    }
    for (const asset of SEED_ASSETS) {
      expect(projectIds.has(asset.project_id), asset.id).toBe(true);
    }
    const activeCompetitors = SEED_COMPETITORS.filter(
      (competitor) => competitor.project_id === SEED_ACTIVE_PROJECT_ID,
    );
    expect(activeCompetitors).toHaveLength(3);
    expect(activeCompetitors.map((competitor) => competitor.position)).toEqual([0, 1, 2]);
    expect(SEED_ACTIVE_COMPETITOR_IDS).toEqual(activeCompetitors.map((competitor) => competitor.id));
  });
});

describe('demo/seed · 实体卡（§B-5）', () => {
  it('1 张卡挂在 active 项目上，completeness 是写死的静态值且 ≥ 0.8', () => {
    expect(SEED_ENTITY_CARDS).toHaveLength(1);
    const card = SEED_ENTITY_CARDS[0];
    expect(card.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(card.completeness).toBeGreaterThanOrEqual(0.8);
    expect(card.completeness).toBeLessThanOrEqual(1);
    // 规则 9：完整率是 Rust 侧的领域算法 ⇒ 种子里只写死静态值，并且与「必填字段留空 1 个」自洽。
    expect(card.fields.founded_year).toBeNull();
    // 🔴 字段面收窄到 7 键（spec 2026-10-01 · DR-59）⇒ 静态值 0.86 = 6/7（留空的还是 founded_year）。
    // 真后端今天算的是 6/10 = 0.6（分母未改），差异 E-58。
    expect(Object.keys(card.fields).sort()).toEqual(
      ['aliases', 'contact', 'founded_year', 'products', 'qualifications', 'service_regions', 'standard_name'],
    );
    expect(card.completeness).toBe(0.86);
  });

  it('field_status 三种状态都出现，且每个键都是 EntityFields 的顶层字段名', () => {
    const card = SEED_ENTITY_CARDS[0];
    const fieldNames = Object.keys(card.fields);
    const statuses = Object.keys(card.field_status).map((path) => card.field_status[path]);

    expect(new Set(statuses)).toEqual(new Set(FIELD_STATUS_VALUES));
    expect(Object.keys(card.field_status).sort()).toEqual([...fieldNames].sort());
    for (const path of Object.keys(card.field_status)) {
      expect(fieldNames, path).toContain(path);
      expect(FIELD_STATUS_VALUES as readonly string[], path).toContain(card.field_status[path]);
    }
  });

  it('source：3–5 条自有域名的固定 URL + A-5 的稳定 provider id 与默认模型', () => {
    const card = SEED_ENTITY_CARDS[0];
    const website = SEED_PROJECTS[0].website;
    expect(website).not.toBeNull();
    const host = new URL(String(website)).host;

    expect(card.source.crawled_pages.length).toBeGreaterThanOrEqual(3);
    expect(card.source.crawled_pages.length).toBeLessThanOrEqual(5);
    for (const page of card.source.crawled_pages) {
      expect(new URL(page).host, page).toBe(host);
    }
    expect(card.source.llm_provider).toBe('deep_seek');
    expect(card.source.llm_model).toBe('deepseek-chat');
    expect(card.source.generated_at).toMatch(FIXED_SEED_WINDOW);
  });

  it('1 条修订种子，field_path 的**根字段**指向实体卡真实存在的字段', () => {
    expect(SEED_ENTITY_CARD_REVISIONS).toHaveLength(1);
    const revision = SEED_ENTITY_CARD_REVISIONS[0];
    const card = SEED_ENTITY_CARDS[0];

    expect(revision.project_id).toBe(card.project_id);
    // 🔴 报价并进产品之后（DR-60），这条留痕的路径是**深层**的 `products[0].price`：
    // 取根字段名再比（与 `components/entity-fields.ts` 的 `entityFieldLabelKey` 同一个口径；
    // DR-119 之后那个函数搬出了 `RevisionTimeline.tsx`：时间线组件已泛化成两个页面共用）。
    const root = revision.field_path.split(/[.[]/)[0];
    expect(root, revision.field_path).toBe('products');
    expect(Object.keys(card.fields)).toContain(root);
    expect(FIELD_STATUS_VALUES as readonly string[]).toContain(revision.status);
    expect(revision.edited_at).toMatch(FIXED_SEED_WINDOW);
    expect(revision.old_value).not.toEqual(revision.new_value);
  });
});

describe('demo/seed · 知识库修订留痕（DR-119）', () => {
  /** 与 `EntityCardRevision` 共用的那六个键（`api/types-kb.ts` 的头注点名要求六键同构）。 */
  const SHARED_KEYS = ['field_path', 'old_value', 'new_value', 'status', 'note', 'edited_at'];

  it('3 条留痕挂在真实条目上、field_path 都在 KB_FIELDS 里、时间戳落在演示月份', () => {
    expect(SEED_KB_REVISIONS).toHaveLength(3);
    const entries = new Map(SEED_KB_ENTRIES.map((row) => [row.id, row]));

    for (const revision of SEED_KB_REVISIONS) {
      const entry = entries.get(revision.entry_id);
      expect(entry, `${revision.id} → ${revision.entry_id}`).toBeDefined();
      expect(revision.project_id, revision.id).toBe(entry!.project_id);
      expect(
        KB_FIELDS.some((field) => field.path === revision.field_path),
        revision.field_path,
      ).toBe(true);
      expect(FIELD_STATUS_VALUES as readonly string[]).toContain(revision.status);
      expect(revision.edited_at).toMatch(FIXED_SEED_WINDOW);
      expect(revision.id).toMatch(ASCII_ID);
      expect(revision.old_value).not.toEqual(revision.new_value);
    }
  });

  it('与实体卡留痕**六键同构**，差别只有归属键 entry_id（DR-119）', () => {
    for (const revision of SEED_KB_REVISIONS) {
      for (const key of SHARED_KEYS) expect(Object.keys(revision), key).toContain(key);
    }
    expect(Object.keys(SEED_KB_REVISIONS[0]).sort()).toEqual(
      [...Object.keys(SEED_ENTITY_CARD_REVISIONS[0]), 'entry_id'].sort(),
    );
  });

  it('body_markdown 那条是**截断样例**：留痕里正好 120 字（与 handler 的上限同一个数）', () => {
    const body = SEED_KB_REVISIONS.find((row) => row.field_path === 'body_markdown');
    expect(body).toBeDefined();
    expect(KB_REVISION_BODY_LIMIT).toBe(120);
    expect(String(body!.old_value)).toHaveLength(KB_REVISION_BODY_LIMIT);
    // 存疑态：界面上要出红点（`RevisionTimeline` 的颜色口径）。
    expect(body!.status).toBe('disputed');
  });
});

describe('demo/seed · M1.5 素材库（关键词 / FAQ）', () => {
  it('关键词 14 条 / FAQ 8 条，都挂在 active 项目上，position = 数组序、id 唯一', () => {
    expect(SEED_KEYWORDS).toHaveLength(14);
    expect(SEED_FAQS).toHaveLength(8);

    SEED_KEYWORDS.forEach((row, index) => {
      expect(row.project_id, row.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(row.position, row.id).toBe(index);
    });
    SEED_FAQS.forEach((row, index) => {
      expect(row.project_id, row.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(row.position, row.id).toBe(index);
    });

    const ids = [...SEED_KEYWORDS, ...SEED_FAQS].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('关键词覆盖全部 5 种类型 / 3 种来源 / 3 种审核态与 7 类意图（少一种，那个筛选档就是空的）', () => {
    expect(new Set(SEED_KEYWORDS.map((row) => row.kind))).toEqual(new Set(KEYWORD_KIND_VALUES));
    expect(new Set(SEED_KEYWORDS.map((row) => row.source))).toEqual(new Set(LIBRARY_SOURCE_VALUES));
    expect(new Set(SEED_KEYWORDS.map((row) => row.status))).toEqual(new Set(CONTENT_STATUS_VALUES));
    expect(new Set(SEED_KEYWORDS.map((row) => row.intent))).toEqual(new Set(INTENT_VALUES));

    for (const row of SEED_KEYWORDS) {
      // 优先级会被当成 Prompt 的 weight 引用进去（DR-43），越界就成了无效权重。
      expect(row.priority, row.id).toBeGreaterThanOrEqual(1);
      expect(row.priority, row.id).toBeLessThanOrEqual(5);
      // 搜索量与难度是**静态值**（规则 9），但形状要真：null 表示"没数据"，不许拿 0 充数。
      if (row.monthly_volume !== null) expect(row.monthly_volume, row.id).toBeGreaterThan(0);
      if (row.difficulty !== null) {
        expect(row.difficulty, row.id).toBeGreaterThanOrEqual(0);
        expect(row.difficulty, row.id).toBeLessThanOrEqual(100);
      }
    }
    // 两列各至少一条 null：界面上那个空值占位符（`—`）要有数据才走查得到。
    expect(SEED_KEYWORDS.some((row) => row.monthly_volume === null)).toBe(true);
    expect(SEED_KEYWORDS.some((row) => row.difficulty === null)).toBe(true);
    // 词面互不重复：handler 只做等值跳过（E-54），种子里先重复就等于把"生成不重复"这件事架空。
    expect(new Set(SEED_KEYWORDS.map((row) => row.text)).size).toBe(SEED_KEYWORDS.length);
  });

  it('FAQ 覆盖 3 种来源 / 3 种审核态，答案是带换行的 Markdown 原文', () => {
    expect(new Set(SEED_FAQS.map((row) => row.source))).toEqual(new Set(LIBRARY_SOURCE_VALUES));
    expect(new Set(SEED_FAQS.map((row) => row.status))).toEqual(new Set(CONTENT_STATUS_VALUES));

    for (const row of SEED_FAQS) {
      expect(INTENT_VALUES as readonly string[], row.id).toContain(row.intent);
      expect(row.question.trim().length, row.id).toBeGreaterThan(4);
      expect(row.answer_markdown.trim().length, row.id).toBeGreaterThan(20);
    }
    // 🔴 「导出只收已通过」那一支要有料：0 条已通过 ⇒ JSON-LD 永远是空壳、按钮永远置灰，
    // 走查不到"导出成功"这半边（`FaqLibraryPage.test.tsx` 那条 5 也钉在这里）。
    expect(SEED_FAQS.filter((row) => row.status === 'approved')).toHaveLength(5);
    // 答案原样进 `acceptedAnswer.text`（DR-44），所以库里得有真的多行答案，不能全是单行。
    expect(SEED_FAQS.some((row) => row.answer_markdown.includes('\n'))).toBe(true);
    expect(new Set(SEED_FAQS.map((row) => row.question)).size).toBe(SEED_FAQS.length);
    // 分类是**自由文本数据**（不进词典）：8 条各归一类，筛选下拉才不是一档独大。
    expect(new Set(SEED_FAQS.map((row) => row.category)).size).toBe(SEED_FAQS.length);
  });

  it('🔴 生成池不入初始库，且与库里零重叠（否则"点生成 → 库里多出来"看不见变化）', () => {
    expect(SEED_KEYWORD_GENERATED_POOL).toHaveLength(12);
    expect(SEED_FAQ_GENERATED_POOL).toHaveLength(8);

    const keywordTexts = new Set(SEED_KEYWORDS.map((row) => row.text));
    for (const row of SEED_KEYWORD_GENERATED_POOL) {
      expect(keywordTexts.has(row.text), row.text).toBe(false);
      expect(KEYWORD_KIND_VALUES as readonly string[], row.text).toContain(row.kind);
      expect(INTENT_VALUES as readonly string[], row.text).toContain(row.intent);
      expect(row.priority, row.text).toBeGreaterThanOrEqual(1);
      expect(row.priority, row.text).toBeLessThanOrEqual(5);
    }
    // 池子覆盖全部 5 种类型：只勾一种时也得生成得出东西（`generatedNone` 是兜底，不是常态）。
    expect(new Set(SEED_KEYWORD_GENERATED_POOL.map((row) => row.kind))).toEqual(
      new Set(KEYWORD_KIND_VALUES),
    );

    const faqQuestions = new Set(SEED_FAQS.map((row) => row.question));
    for (const row of SEED_FAQ_GENERATED_POOL) {
      expect(faqQuestions.has(row.question), row.question).toBe(false);
      expect(INTENT_VALUES as readonly string[], row.question).toContain(row.intent);
      expect(row.answer_markdown.trim().length, row.question).toBeGreaterThan(20);
    }

    // 池子内部也不许自我重复：handler 只跳过**库里已有**的等值文本，池内重复会一次生成两条一样的。
    expect(new Set(SEED_KEYWORD_GENERATED_POOL.map((row) => row.text)).size).toBe(
      SEED_KEYWORD_GENERATED_POOL.length,
    );
    expect(new Set(SEED_FAQ_GENERATED_POOL.map((row) => row.question)).size).toBe(
      SEED_FAQ_GENERATED_POOL.length,
    );
  });

  it('默认生成条件下两个池子各挑得出 6 条（页面测试里那个 6 是这里算出来的，不是抄来的）', () => {
    // 默认档取自两个弹窗导出的 `initialValues`，不是在这里再抄一份类型清单。
    const keywordHits = SEED_KEYWORD_GENERATED_POOL.filter((row) =>
      DEFAULT_KEYWORD_GENERATE_OPTIONS.kinds.includes(row.kind),
    ).length;
    const faqHits = SEED_FAQ_GENERATED_POOL.filter((row) =>
      DEFAULT_FAQ_GENERATE_OPTIONS.intents.includes(row.intent),
    ).length;

    expect(Math.min(DEFAULT_KEYWORD_GENERATE_OPTIONS.target_count, keywordHits)).toBe(6);
    expect(Math.min(DEFAULT_FAQ_GENERATE_OPTIONS.target_count, faqHits)).toBe(6);
  });
});

describe('demo/seed · 题库（§B-3 / A-8）', () => {
  it('两份题库：62 条 sufficient、28 条 insufficient，档位与条目数自洽', () => {
    expect(SEED_PROMPT_SETS).toHaveLength(2);
    expect(SUFFICIENT_PROMPT_ROWS).toHaveLength(62);
    expect(INSUFFICIENT_PROMPT_ROWS).toHaveLength(28);
    expect(SEED_PROMPT_ITEMS).toHaveLength(90);

    const grades = SEED_PROMPT_SETS.map((set) => [set.items.length, set.sample_size_grade]);
    expect(grades).toEqual([
      [62, 'sufficient'],
      [28, 'insufficient'],
    ]);
    // B-13①（原注释写「一致性自检（不是重算分级）」，与紧随其后的代码不符 ⇒ 改成实话）：
    // 用 src/api/constants.ts 的镜像常量**交叉重算**一遍档位；真值源是 crates/geo-domain/src/prompt.rs 的
    // sample_size_grade，镜像常量漂了这里会红。
    for (const set of SEED_PROMPT_SETS) {
      const expected =
        set.items.length >= SUFFICIENT_SAMPLE_SIZE
          ? 'sufficient'
          : set.items.length >= MINIMUM_SAMPLE_SIZE
            ? 'directional'
            : 'insufficient';
      expect(set.sample_size_grade, set.id).toBe(expected);
    }
  });

  it('62 条那份覆盖全部 7 类意图，来源至少 4 种，权重在 1~5', () => {
    const baseline = SEED_PROMPT_SETS[0];

    expect(new Set(baseline.items.map((item) => item.intent))).toEqual(new Set(INTENT_VALUES));
    expect(new Set(baseline.items.map((item) => item.source)).size).toBeGreaterThanOrEqual(4);
    for (const source of baseline.items.map((item) => item.source)) {
      expect(PROMPT_SOURCE_VALUES as readonly string[], source).toContain(source);
    }
    for (const item of SEED_PROMPT_ITEMS) {
      expect(item.weight, item.id).toBeGreaterThanOrEqual(1);
      expect(item.weight, item.id).toBeLessThanOrEqual(5);
      expect(item.text.trim().length, item.id).toBeGreaterThan(4);
      expect(item.repeat_count, item.id).toBe(1);
    }
    expect(new Set(SEED_PROMPT_ITEMS.map((item) => item.group_name)).size).toBeGreaterThanOrEqual(7);
  });

  it('每条 text 都是字面量中文（§B-3：绝不许程序化拼出来）', () => {
    const rows = [...SUFFICIENT_PROMPT_ROWS, ...INSUFFICIENT_PROMPT_ROWS];
    expect(rows).toHaveLength(90);
    for (const row of rows) {
      expect(row.text, row.text).toMatch(/[\u4e00-\u9fa5]/);
      // 拼接的痕迹：模板里出现品牌名占位或 `${`（种子是 .ts，字面量里不该有插值残留）。
      expect(row.text, row.text).not.toContain('${');
    }
    // 90 条互不重复：重复了就说明是程序化生成的套话。
    expect(new Set(rows.map((row) => row.text)).size).toBe(90);
  });

  it('派生字段自洽：position = 数组序、set_id 指向所属题库、id 唯一', () => {
    for (const set of SEED_PROMPT_SETS) {
      set.items.forEach((item, index) => {
        expect(item.position, item.id).toBe(index);
        expect(item.set_id, item.id).toBe(set.id);
      });
    }
    const ids = SEED_PROMPT_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 两处视图一致：promptItems 是归一化真值，promptSets[].items 是它的分组镜像。
    expect(ids).toEqual(SEED_PROMPT_SETS.flatMap((set) => set.items.map((item) => item.id)));
  });

  it('competitor_ids 都能解析到同项目的真实竞品', () => {
    const byId = new Map(SEED_COMPETITORS.map((competitor) => [competitor.id, competitor]));
    for (const set of SEED_PROMPT_SETS) {
      for (const item of set.items) {
        for (const competitorId of item.competitor_ids) {
          const competitor = byId.get(competitorId);
          expect(competitor, `${item.id} → ${competitorId}`).toBeDefined();
          expect(competitor?.project_id, item.id).toBe(set.project_id);
        }
      }
    }
    // 行表里的下标必须在竞品数组范围内（越界会解析成 undefined，上面的断言抓不到源头）。
    for (const row of [...SUFFICIENT_PROMPT_ROWS, ...INSUFFICIENT_PROMPT_ROWS]) {
      for (const index of row.competitors) {
        expect(index, row.text).toBeGreaterThanOrEqual(0);
        expect(index, row.text).toBeLessThan(SEED_ACTIVE_COMPETITOR_IDS.length);
      }
    }
  });

  it('至少有一条品牌对比条目真的挂了竞品（否则对比意图在 demo 里走查不出来）', () => {
    const comparisons = SEED_PROMPT_ITEMS.filter((item) => item.intent === 'brand_comparison');
    expect(comparisons.length).toBeGreaterThanOrEqual(4);
    expect(comparisons.every((item) => item.competitor_ids.length > 0)).toBe(true);
  });
});

describe('demo/seed · 确定性（§B-4）', () => {
  it('所有时间戳都是固定的 RFC3339 字面量，落在演示月份 2026-09', () => {
    const found: string[] = [];
    walk(createDemoDb(), null, (_key, text) => {
      if (RFC3339_SHAPE.test(text)) found.push(text);
    });

    // 230 = M1/M2 那 19 条（项目 5 含归档项目的 archived_at + 竞品 4 + 资产 4 + 实体卡 3
    // 含 generated_at + 修订 1 + 题库 2）+ M3–M7 那 86 条（轮次 7 = started 4 / finished 3、
    // 队列任务 34 = queued 19 / finished 15、证据 18、解析 2、核查 2、告警 4、
    // 处方 15 = completed 5 / updated 10、文稿 4 = created 2 / updated 2）
    // + M1.5 素材库那 44 条（关键词 14 行 × created_at/updated_at = 28、FAQ 8 行 × 2 = 16；
    //   两个**生成池**是紧凑行、不带时间戳 ⇒ 一条都不贡献，时间戳由 handler 在运行时补）
    // + M6.5 站点接入那 48 条（同一轮里由站点接入那条线自己核过口径，spec
    //   `2026-09-30-site-connect-patch-bench-design.md`）
    // + **M1.2b 知识库那 58 条**（`SEED_KB_ENTRIES` 25 行 × created_at/updated_at = 50，
    //   其中 8 行带 `verified_at` = 8；`SEED_KB_GENERATED_POOL` 那 6 行是紧凑行、不带时间戳
    //   ⇒ 一条都不贡献，与 M1.5 两个生成池同一条口径）。
    // + **M6 文章管理那 18 条**（方向 4 行 × created_at = 4、模板 3 行 × created_at/updated_at = 6、
    //   排期 2 行 × last_run_at = 2 再加启用那条的 next_run_at = 1、文章 5 行 × generated_at = 5；
    //   `SEED_ARTICLE_POOL` 那 6 行与 `SEED_ARTICLE_DIRECTION_POOL` 那 3 行同样是紧凑行、不带时间戳
    //   ⇒ 一条都不贡献，与前面几个生成池同一条口径）。
    // + **DR-119 知识库留痕那 4 条**（`SEED_KB_REVISIONS` 3 行 × `edited_at` = 3，
    //   再加 `verified_at` 那行的 `new_value` 本身就是一个时间戳字面量 = 1；
    //   `old_value` 那条是 `null`，不贡献）。
    // + **M5.5 站长数据那 85 条**（源 20 = 7 行 × created_at/updated_at = 14 再加 6 行的
    //   `checked_at`（人工填报那一行是 `null`，不贡献）；指标 30 = 30 行 × `imported_at`
    //   （由 `metricOf` 从周期常量补齐，所以它在种子文本里**不是**字面量）；AI 汇总 1；
    //   C 类留档 8；机会 12 = 6 行 × created_at/updated_at；自建索引快照 14 = 14 行 × `observed_at`。
    //   🔴 两处刻意**不贡献**：`SEED_SEARCH_SOURCE_PROBES` 那 7 条不进库（`search_source_test`
    //   逐字端出，规则 2），`SEED_SEARCH_TRAFFIC_SPLIT` 3 行只有 `engine` / `share` / `project_id`、
    //   不带时间戳（DR-111 的分布是"占比"，不是"某天的观测"）；`data_through` / `period_*`
    //   那批是**日期**不是 RFC3339，同样一条都不算）。
    // 写死而不是写下界：种子被谁悄悄删了一个时间戳也要红。
    expect(found).toHaveLength(366);
    for (const stamp of found) expect(stamp, stamp).toMatch(FIXED_SEED_WINDOW);
  });

  it('所有 id 都是 ASCII 稳定字面量（§B-4 不许随机、§B-11 不许代码生成中文）', () => {
    const ids: string[] = [];
    walk(createDemoDb(), null, (key, text) => {
      if (key === 'id' || (key !== null && key.endsWith('_id'))) ids.push(text);
    });

    expect(ids.length).toBeGreaterThanOrEqual(100);
    for (const id of ids) expect(id, id).toMatch(ASCII_ID);
  });

  it('两次重建得到逐字相同的一份数据（刷新即重置的语义前提）', () => {
    expect(createDemoDb()).toEqual(createDemoDb());
  });
});

/**
 * 上面那个「记号 → 词条」用例只读词典的这几组键，所以这里给一份**最小形状**：
 * 直接标注 `typeof zhCN` 会把整个词典树拖进本文件的类型面，而本文件已经 import 了
 * `i18n`（运行时）——只取需要的几组，改动词典其余部分时这里不会跟着红。
 */
type ZhBundleShape = {
  report: {
    sections: Record<string, string>;
    metrics: Record<string, string>;
    columns: Record<string, string>;
  };
  action: {
    categories: Record<string, string>;
    templateSections: Record<string, string>;
    attribution: { metrics: Record<string, string> };
    templates: { kinds: Record<string, string> };
  };
  diagnosis: {
    dimensions: { names: Record<string, string> };
    alerts: {
      kinds: Record<string, string>;
      severities: Record<string, string>;
      metrics: Record<string, string>;
    };
  };
};

// ---------------------------------------------------------------------------
// M3–M7：种子之间的自洽
// ---------------------------------------------------------------------------
//
// 🔴 这一整块的存在理由是**产品失败形态**：本产品卖的是"数字可信"，所以界面上任何两个
// 数字对不上（诊断页说覆盖率 42%、报告里写 45%；归因卡片说 +13 个百分点、表里是 +12）
// 都比"某个功能没做"更伤。demo 的数字全是静态值（AGENTS 规则 9：不在 demo 里算指标），
// 于是"自洽"只能靠种子手工对齐 + 这里的判据钉住。
//
// ⚠ 这些断言**不是**领域算法：没有一处从原始证据算覆盖率 / 去重率 / 加权分，
// 全是「A 表里写的那个数 == B 表里写的那个数」这种同一性检查。

/** 一轮的轮次行（找不到就抛：种子里的 round_id 写错时，这里要比后面的断言先炸）。 */
function roundOf(roundId: string) {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === roundId);
  if (round === undefined) throw new Error(`unknown round in seed: ${roundId}`);
  return round;
}

/** 竞品矩阵里本品牌那一行（小样本的通道验证轮没有矩阵，调用方自己负责别在这轮用它）。 */
function selfRowOf(roundId: string): CompetitorMatrixRow {
  const row = SEED_COMPETITOR_MATRICES[roundId]?.rows.find((entry) => entry.is_self);
  if (row === undefined) throw new Error(`no self row in competitor matrix: ${roundId}`);
  return row;
}

/** 归因卡片的四个指标分别从哪儿取（真值源写在 `seed/actions.ts` 的头注释里）。 */
const ATTRIBUTION_SOURCES: Record<AttributionMetricKey, (roundId: string) => number> = {
  brand_coverage: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].brand_coverage,
  top3_rate: (roundId) => selfRowOf(roundId).top3_rate,
  fact_error_count: (roundId) => selfRowOf(roundId).fact_error_count,
  negative_rate: (roundId) => selfRowOf(roundId).negative_rate,
};

/** 报告里的指标记号分别从哪儿取（与 `report.metrics` 词典的键集一一对应）。 */
const REPORT_SOURCES: Record<string, (roundId: string) => number> = {
  brand_coverage: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].brand_coverage,
  total_score: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].total_score,
  sample_size: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].sample_size,
  success_rate: (roundId) => roundOf(roundId).success_rate,
  share_of_voice: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].share_of_voice,
  fact_accuracy: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].fact_accuracy,
  fact_error_count: (roundId) => selfRowOf(roundId).fact_error_count,
  top3_rate: (roundId) => selfRowOf(roundId).top3_rate,
  negative_rate: (roundId) => selfRowOf(roundId).negative_rate,
  distinct_cited_domains: (roundId) => SEED_DIAGNOSIS_OVERVIEWS[roundId].distinct_cited_domains,
};

/** 报告趋势里的上一轮（`delta` 的基准）；没有上一轮就是 null。 */
function previousRoundOf(roundId: string): string | null {
  const index = SEED_TREND.findIndex((point) => point.round_id === roundId);
  return index > 0 ? SEED_TREND[index - 1].round_id : null;
}

describe('demo/seed · M3 采集与用量看板自洽', () => {
  it('用量看板每一行 == 该轮各引擎执行汇总之和（queries = 成功 + 失败，失败也消耗配额）', () => {
    for (const row of SEED_USAGE_BOARD.rows) {
      const runs = SEED_ENGINE_RUNS[row.round_id];
      expect(runs, row.round_id).toBeDefined();
      const sum = (pick: (run: (typeof runs)[number]) => number) =>
        runs.reduce((total, run) => total + pick(run), 0);

      expect(row.queries, row.round_id).toBe(sum((run) => run.succeeded + run.failed));
      expect(row.prompt_tokens, row.round_id).toBe(sum((run) => run.prompt_tokens));
      expect(row.completion_tokens, row.round_id).toBe(sum((run) => run.completion_tokens));
      expect(row.total_tokens, row.round_id).toBe(row.prompt_tokens + row.completion_tokens);
      // 轮次名与轮次表逐字一致：界面上两处显示同一轮，不许一个叫法一个样。
      expect(row.round_label, row.round_id).toBe(roundOf(row.round_id).label);
    }

    const total = (pick: (row: (typeof SEED_USAGE_BOARD.rows)[number]) => number) =>
      SEED_USAGE_BOARD.rows.reduce((sum, row) => sum + pick(row), 0);
    expect(SEED_USAGE_BOARD.total_queries).toBe(total((row) => row.queries));
    expect(SEED_USAGE_BOARD.total_tokens).toBe(total((row) => row.total_tokens));
    // 配额判定是静态值，但它必须与 total_queries 同向（否则进度条与"超额暂停"提示互相打脸）。
    expect(SEED_USAGE_BOARD.quota_exceeded).toBe(
      SEED_USAGE_BOARD.quota_queries !== null &&
        SEED_USAGE_BOARD.total_queries > SEED_USAGE_BOARD.quota_queries,
    );
  });

  it('轮次的 planned/completed/failed == 各引擎执行汇总之和；计划数按「题目 × 引擎」封顶', () => {
    for (const round of SEED_COLLECTION_ROUNDS) {
      const runs = SEED_ENGINE_RUNS[round.id] ?? [];
      const sum = (pick: (run: (typeof runs)[number]) => number) =>
        runs.reduce((total, run) => total + pick(run), 0);

      // 轮次卡与引擎表显示的是同一批查询：两处对不上，界面上就会自己打自己。
      expect(round.planned_queries, round.id).toBe(sum((run) => run.planned));
      expect(round.completed_queries, round.id).toBe(sum((run) => run.succeeded));
      expect(round.failed_queries, round.id).toBe(sum((run) => run.failed));
      // 跑完的轮次（含 `partial`：通道验证轮按计划只跑 15 次，已全跑完）账要平；
      // 排队中 / 进行中的轮次必须**还没平**，否则界面上的进度条与状态标签会互相矛盾。
      const settled = round.status !== 'queued' && round.status !== 'running';
      const done = round.completed_queries + round.failed_queries;
      if (settled) expect(done, round.id).toBe(round.planned_queries);
      else expect(done, round.id).toBeLessThan(round.planned_queries);

      // 🔴 上界是「题目数 × 引擎数」，**不乘** `repeat_count`：重复采样只作用于关键题目，
      // 哪些题算关键是后端判定的（`demo/handlers/collection.ts` 的 `collection_start` 同口径）。
      const items = SEED_PROMPT_ITEMS.filter((item) => item.set_id === round.prompt_set_id).length;
      const cap = items * round.engine_scope.length;
      expect(round.planned_queries, round.id).toBeLessThanOrEqual(cap);
      // 跑满整份题库的那几轮正好等于上界；通道验证轮只跑了 5 道题的子集，所以严格小于。
      if (round.sample_size_grade !== 'insufficient') {
        expect(round.planned_queries, round.id).toBe(cap);
      }
    }
  });

  it('重跑结果只挂在真的失败过的任务上（否则界面上"重跑"按钮点不出东西）', () => {
    const failedTaskIds = SEED_COLLECTION_TASKS.filter((task) => task.status === 'failed').map(
      (task) => task.id,
    ).sort();

    expect(Object.keys(SEED_RETRY_OUTCOMES).sort()).toEqual(failedTaskIds);
    // 重跑之后新出现的那条解析结果，键集必须与证据同集（一条证据配一条解析）。
    expect(Object.keys(SEED_RETRY_INSIGHTS).sort()).toEqual(failedTaskIds);
    // 每条重跑证据都落在它那一轮上，且那一轮确实是种子认领的可重跑轮次。
    for (const [taskId, record] of Object.entries(SEED_RETRY_OUTCOMES)) {
      const task = SEED_COLLECTION_TASKS.find((entry) => entry.id === taskId);
      expect(record.round_id, taskId).toBe(task?.round_id);
    }
  });
});

describe('demo/seed · M4/M5 诊断口径自洽（附录 C）', () => {
  it('体检总分 ≈ 五维加权和（权重 0.35/0.25/0.15/0.15/0.10，容下四舍五入）', () => {
    expect(SEED_DIAGNOSIS_OVERVIEWS[SEED_TRIAL_ROUND_ID].dimensions.map((d) => d.weight)).toEqual([
      0.35, 0.25, 0.15, 0.15, 0.1,
    ]);
    for (const [roundId, overview] of Object.entries(SEED_DIAGNOSIS_OVERVIEWS)) {
      const weighted = overview.dimensions.reduce((sum, d) => sum + d.weight * d.score, 0);
      expect(Math.abs(overview.total_score - weighted), roundId).toBeLessThanOrEqual(0.6);
    }
  });

  it('核查汇总的准确率 == 1 − 问题条数 / 已核查回答数，且与 overview 的 fact_accuracy 同值', () => {
    for (const [roundId, summary] of Object.entries(SEED_FACT_CHECK_SUMMARIES)) {
      const issues = Object.values(summary.by_kind).reduce((total, value) => total + value, 0);
      const expected = 1 - issues / summary.checked_answers;
      expect(Math.abs(summary.fact_accuracy - expected), roundId).toBeLessThanOrEqual(0.006);

      const overview = SEED_DIAGNOSIS_OVERVIEWS[roundId];
      if (overview !== undefined) {
        expect(overview.fact_accuracy, roundId).toBe(summary.fact_accuracy);
        // 事实准确那一维的样本量就是"已核查回答数"（附录 C 的分母口径）。
        const factDimension = overview.dimensions.find((d) => d.dimension === 'fact_accuracy');
        expect(factDimension?.sample_size, roundId).toBe(summary.checked_answers);
      }
    }
  });

  it('竞品矩阵里本品牌那一行 == 同轮 overview 的覆盖率与提及份额；错误条数 == 核查汇总', () => {
    for (const [roundId, matrix] of Object.entries(SEED_COMPETITOR_MATRICES)) {
      const self = selfRowOf(roundId);
      const overview = SEED_DIAGNOSIS_OVERVIEWS[roundId];
      expect(self.coverage, roundId).toBe(overview.brand_coverage);
      expect(self.share_of_voice, roundId).toBe(overview.share_of_voice);
      expect(matrix.sample_size, roundId).toBe(overview.sample_size);
      // 矩阵里的事实错误条数与核查汇总的问题条数是同一个量（一个按品牌、一个按轮）。
      const issues = Object.values(SEED_FACT_CHECK_SUMMARIES[roundId].by_kind).reduce(
        (total, value) => total + value,
        0,
      );
      expect(self.fact_error_count, roundId).toBe(issues);
      // Share of Voice 的分母（同框题数）不许超过样本量，否则比率无从解释。
      expect(matrix.head_to_head_prompt_count, roundId).toBeLessThanOrEqual(matrix.sample_size);
    }
  });

  it('趋势点逐字段 == 各轮 overview，且刻意不含进行中那一轮', () => {
    expect(SEED_TREND.map((point) => point.round_id)).toEqual([
      SEED_TRIAL_ROUND_ID,
      SEED_BASELINE_ROUND_ID,
      SEED_RETEST_ROUND_ID,
    ]);
    for (const point of SEED_TREND) {
      const overview = SEED_DIAGNOSIS_OVERVIEWS[point.round_id];
      expect(point.brand_coverage, point.round_id).toBe(overview.brand_coverage);
      expect(point.coverage_margin, point.round_id).toBe(overview.brand_coverage_margin);
      expect(point.total_score, point.round_id).toBe(overview.total_score);
      expect(point.fact_accuracy, point.round_id).toBe(overview.fact_accuracy);
      expect(point.sample_size, point.round_id).toBe(overview.sample_size);
      expect(point.round_label, point.round_id).toBe(roundOf(point.round_id).label);
    }
  });

  it('样本不足那一轮的分级与轮次表一致（界面靠它决定要不要置灰总分）', () => {
    for (const [roundId, overview] of Object.entries(SEED_DIAGNOSIS_OVERVIEWS)) {
      expect(overview.sample_size_grade, roundId).toBe(roundOf(roundId).sample_size_grade);
      expect(overview.round_label, roundId).toBe(roundOf(roundId).label);
      expect(overview.collected_at, roundId).toBe(roundOf(roundId).finished_at);
      expect(overview.metric_spec_version, roundId).toBe(roundOf(roundId).metric_spec_version);
    }
  });
});

describe('demo/seed · M6/M7 处方、归因与报告自洽', () => {
  it('归因卡片的 before/after 逐条 == 基线轮与复测轮的诊断值', () => {
    expect(SEED_ATTRIBUTION_CARDS).toHaveLength(1);
    for (const card of SEED_ATTRIBUTION_CARDS) {
      expect(card.baseline_round_id).toBe(SEED_BASELINE_ROUND_ID);
      expect(card.retest_round_id).toBe(SEED_RETEST_ROUND_ID);
      // 卡片点名的动作必须真的存在、真的已完成、且完成时间早于复测轮的采集时间。
      const retestCollectedAt = roundOf(card.retest_round_id).finished_at ?? '';
      expect(card.action_ids.length).toBeGreaterThanOrEqual(3);
      for (const actionId of card.action_ids) {
        const item = SEED_ACTIONS.find((entry) => entry.id === actionId);
        expect(item, actionId).toBeDefined();
        expect(item?.status, actionId).toBe('done');
        const completedAt = item?.completed_at ?? null;
        expect(completedAt !== null && completedAt < retestCollectedAt, actionId).toBe(true);
      }
      for (const metric of card.metrics) {
        const source = ATTRIBUTION_SOURCES[metric.metric];
        expect(source, metric.metric).toBeDefined();
        expect(metric.before, metric.metric).toBe(source(card.baseline_round_id));
        expect(metric.after, metric.metric).toBe(source(card.retest_round_id));
      }
    }
  });

  it('处方的关联证据都能解析到真实的核查问题；1 小时内可完成的快赢项 ≥3（MVP 验收）', () => {
    const issueById = new Map(SEED_FACT_CHECK_ISSUES.map((issue) => [issue.id, issue]));
    let linked = 0;
    for (const item of SEED_ACTIONS) {
      for (const issueId of item.evidence_issue_ids) {
        expect(issueById.has(issueId), `${item.id} → ${issueId}`).toBe(true);
        linked += 1;
      }
    }
    expect(linked).toBeGreaterThanOrEqual(4);
    expect(SEED_ACTIONS.filter((item) => item.quick_win).length).toBeGreaterThanOrEqual(3);
    // Top-N 的名次是 1..N 且不重号（界面上按它排序展示）。
    expect(SEED_ACTIONS.map((item) => item.rank).sort((a, b) => a - b)).toEqual(
      SEED_ACTIONS.map((_, index) => index + 1),
    );
    // 已完成的处方必须有完成时间，未完成的必须没有（界面上两列不能自相矛盾）。
    for (const item of SEED_ACTIONS) {
      expect(item.completed_at !== null, item.id).toBe(item.status === 'done');
    }
  });

  it('报告里的每个数字都能在诊断/轮次种子里找到同值来源（记号 → 真值源）', () => {
    for (const [roundId, payload] of Object.entries(SEED_REPORTS)) {
      const blocks = [
        ...payload.headline,
        ...Object.values(payload.sections)
          .flat()
          .filter((block) => block.kind === 'metric'),
      ];
      expect(blocks.length, roundId).toBeGreaterThanOrEqual(3);
      for (const block of blocks) {
        if (block.kind !== 'metric') continue;
        const source = REPORT_SOURCES[block.metric];
        expect(source, `${roundId}/${block.metric}`).toBeDefined();
        expect(block.value, `${roundId}/${block.metric}`).toBeCloseTo(source(roundId), 6);

        const previous = previousRoundOf(roundId);
        if (block.delta === null) {
          // 没有基准轮（第 1 轮）或这一份刻意不给环比（第 2 轮）⇒ 必须真的没有基准或写明 null。
          continue;
        }
        expect(previous, `${roundId}/${block.metric}`).not.toBeNull();
        const before = source(previous as string);
        const expected =
          block.unit === 'percent'
            ? Math.round((block.value - before) * 100)
            : block.value - before;
        expect(block.delta, `${roundId}/${block.metric}`).toBe(expected);
      }
    }
    // 正向对照：复测轮那份**必须**带环比，否则上面那条 `continue` 会让整块判据空跑。
    const retestDeltas = [
      ...SEED_REPORTS[SEED_RETEST_ROUND_ID].headline,
      ...Object.values(SEED_REPORTS[SEED_RETEST_ROUND_ID].sections)
        .flat()
        .filter((block) => block.kind === 'metric'),
    ].filter((block) => block.kind === 'metric' && block.delta !== null);
    expect(retestDeltas.length).toBeGreaterThanOrEqual(5);
    // 没有基准的那两轮不许凭空出现环比。
    for (const roundId of [SEED_TRIAL_ROUND_ID, SEED_BASELINE_ROUND_ID]) {
      const withDelta = [
        ...SEED_REPORTS[roundId].headline,
        ...Object.values(SEED_REPORTS[roundId].sections)
          .flat()
          .filter((block) => block.kind === 'metric'),
      ].filter((block) => block.kind === 'metric' && block.delta !== null);
      expect(withDelta, roundId).toEqual([]);
    }
  });

  /**
   * 🔴 告警的 `delta` 与报告的 `delta` **同一个口径**：百分点 / 条数（Plan B Task 8 · 裁定 3 · E-40）。
   *
   * # 统一之前
   * `SEED_ALERTS` 的比率类 delta 装的是 0~1 的**比率**（`-0.14`），靠 `format.ts` 里那个
   * `alertDeltaText` 乘 100 才显示成「-14 个百分点」；`SEED_REPORTS` 那侧装的是**百分点**（`13`）。
   * 同一个「降 14 个点」在 M5 与 M7 各有一套写法 ⇒ 产品负责人裁定统一（方向取百分点）。
   *
   * # 这两条判据分别防什么
   * ① **整数性**：显示层 `signedNumber` 本来就四舍五入到整数，所以百分点口径下 delta 必须是整数；
   *    退回比率口径（`-0.14`）立刻红。单位由 `alertMetricUnit` 现取，不在这里重抄一遍映射。
   * ② **与文案对账**：`detail` 里点了「N 个百分点」的，徽标上的数字必须与它逐字相同。
   *    这条才是"统一"的真判据——两处两个数（界面说 -14、文案说 14 个百分点）正是本产品
   *    最不能出现的失败形态，而它靠肉眼走查很容易漏。
   */
  it('告警 delta 用百分点/条数（不再是 0~1 比率），且与 detail 里点名的数字逐条对得上', () => {
    let reconciled = 0;
    for (const alert of SEED_ALERTS) {
      expect(alert.delta, `${alert.id} 缺环比基准`).not.toBeNull();
      const delta = alert.delta ?? 0;
      expect(Number.isInteger(delta), `${alert.id} 还在用 0~1 比率口径`).toBe(true);
      expect(Math.abs(delta), `${alert.id} 单位口径漂了`).toBeLessThanOrEqual(100);
      if (alertMetricUnit(alert.metric) === 'count') continue;

      const stated = /(\d+)\s*个百分点/.exec(alert.detail);
      if (stated === null) continue;
      reconciled += 1;
      expect(Math.abs(delta), `${alert.id} 与 detail 里的数字对不上`).toBe(Number(stated[1]));
    }
    // 防空跑：4 条里至少 2 条真的做了文案对账，否则上面那个 `continue` 会让判据空转。
    expect(reconciled).toBeGreaterThanOrEqual(2);
  });

  it('报告口径说明页逐字段对齐轮次与诊断（样本量、引擎、重复采样、题库版本、指标口径）', () => {
    for (const [roundId, payload] of Object.entries(SEED_REPORTS)) {
      const round = roundOf(roundId);
      const methodology = payload.methodology;
      expect(methodology.round_label, roundId).toBe(round.label);
      expect(methodology.collected_at, roundId).toBe(round.finished_at);
      expect(methodology.engines, roundId).toEqual(round.engine_scope);
      expect(methodology.repeat_count, roundId).toBe(round.repeat_count);
      expect(methodology.prompt_set_label, roundId).toBe(round.prompt_set_label);
      expect(methodology.prompt_set_version, roundId).toBe(round.prompt_set_version);
      expect(methodology.metric_spec_version, roundId).toBe(round.metric_spec_version);
      expect(methodology.sample_size_grade, roundId).toBe(round.sample_size_grade);
      expect(methodology.sample_size, roundId).toBe(SEED_DIAGNOSIS_OVERVIEWS[roundId].sample_size);
      // 模型版本清单来自该轮各引擎的执行汇总（去重后逐一出现）。
      const models = (SEED_ENGINE_RUNS[roundId] ?? []).map((run) => run.model);
      for (const model of methodology.model_versions) {
        expect(models, `${roundId}/${model}`).toContain(model);
      }
      // 版本差异只有一个真值源（`SEED_VARIANT_SECTIONS`）：种子里不许出现某个版本不要的节。
      const variantSectionIds = new Set(Object.values(SEED_VARIANT_SECTIONS).flat());
      for (const sectionId of Object.keys(payload.sections)) {
        expect(variantSectionIds.has(sectionId), `${roundId}/${sectionId}`).toBe(true);
      }
      // 跑满样本的那几轮，执行版要的节一节不少；小样本那一轮只有「结论」，
      // `report_render` 会把没有数据的节整节省略（判据写在 handler 里）。
      for (const sectionId of SEED_VARIANT_SECTIONS.detailed) {
        if (round.sample_size_grade === 'insufficient') continue;
        expect(payload.sections[sectionId], `${roundId}/${sectionId}`).toBeDefined();
      }
      expect(Object.keys(payload.sections).length, roundId).toBeGreaterThanOrEqual(1);
      expect(payload.evidence_rows.length, roundId).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('demo/seed · M6.5 站点接入：补丁 ↔ 处方 ↔ 归因三者自洽', () => {
  /**
   * 这一组判据钉的是 spec `2026-09-30-site-connect-patch-bench-design.md` §10 那句
   * 「归因卡片、处方状态与补丁台账三者横看竖看不矛盾」。
   *
   * 🔴 为什么值得单独一组：站点接入是**第三个**说"这件事做完了"的地方
   * （M6 处方说 `done`、M6 归因卡片说提及率涨了、M6.5 台账说改动上线了）。
   * 三处各写一份时间戳，改一处忘两处就是产品负责人一眼能看出的自相矛盾——
   * 而这种矛盾在**任何单侧**的测试里都是绿的。
   */
  const patchesOf = (actionId: string) => SEED_SITE_PATCHES.filter((row) => row.action_id === actionId);
  const poolKeys = new Set(Object.keys(SEED_SITE_PATCH_POOL));
  /** `(action_id, kind, target_url)`：台账与生成池的互斥键（spec §10）。 */
  const slotOf = (row: { action_id: string | null; kind: string; target_url: string }) =>
    `${row.action_id ?? '-'}/${row.kind}/${row.target_url}`;

  it('8 条补丁 / 17 条事件：都挂在 active 项目与基线轮上，id 唯一、position = 数组序', () => {
    expect(SEED_SITE_PATCHES).toHaveLength(8);
    expect(SEED_SITE_PATCH_EVENTS).toHaveLength(17);

    const ids = SEED_SITE_PATCHES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    SEED_SITE_PATCHES.forEach((row, index) => {
      expect(row.project_id, row.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(row.round_id, row.id).toBe(SEED_BASELINE_ROUND_ID);
      expect(row.position, row.id).toBe(index);
    });

    const eventIds = SEED_SITE_PATCH_EVENTS.map((row) => row.id);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    for (const event of SEED_SITE_PATCH_EVENTS) {
      expect(ids, `事件 ${event.id} 指向的补丁不存在`).toContain(event.patch_id);
    }
  });

  it('三态都看得见（少一态，那个筛选档与那三个置灰理由就走查不出来）', () => {
    const statuses = new Set(SEED_SITE_PATCHES.map((row) => row.status));
    for (const status of SITE_PATCH_STATUS_VALUES) expect(statuses, status).toContain(status as string);
    // 🔴 发布闸门要能走查 ⇒ 必须有一条待人工审核的草案
    expect(SEED_SITE_PATCHES.some((row) => row.review_status === 'pending_review')).toBe(true);
  });

  it('四条通道 kind 唯一、覆盖全部档位，且每条都有一份预置自检结论（DR-56②）', () => {
    expect(SEED_SITE_CHANNELS).toHaveLength(SITE_CHANNEL_KIND_VALUES.length);
    expect(new Set(SEED_SITE_CHANNELS.map((row) => row.kind)).size).toBe(SEED_SITE_CHANNELS.length);
    for (const kind of SITE_CHANNEL_KIND_VALUES) {
      expect(SEED_SITE_CHANNELS.map((row) => row.kind), kind).toContain(kind);
      expect(SEED_SITE_CHANNEL_PROBES[kind]?.check_detail?.code, kind).toBeTruthy();
    }
    // 🔴 零凭据那条不该有 endpoint / username（后端也会把它们清成 null，DR-46）
    const bundle = SEED_SITE_CHANNELS.find((row) => row.kind === 'bundle');
    expect(bundle?.endpoint).toBeNull();
    expect(bundle?.username).toBeNull();
  });

  it('🔴 站点通道的 secret_ref 形状是 keyring://site/<kind>/<project_id>（规则 3 / DR-96）', () => {
    for (const channel of SEED_SITE_CHANNELS) {
      expect(channel.project_id, channel.kind).toBe(SEED_ACTIVE_PROJECT_ID);
      if (channel.credentials_state === 'not_required') {
        expect(channel.secret_ref, channel.kind).toBeNull();
      } else {
        // 引用串必须能让真后端定位到该项目的该通道：<kind>/<project_id> 一个都不能糊。
        expect(channel.secret_ref, channel.kind).toBe(
          `keyring://site/${channel.kind}/${channel.project_id}`,
        );
      }
    }
    // 旧种子里的假项目 id（demo-project-lanzhou）会让真后端按引用串找不到钥匙串项。
    expect(SEED_SITE_CHANNELS.some((row) => row.secret_ref?.includes('demo-project'))).toBe(false);
  });

  it('站点域名是项目官网的镜像（DR-49：不在两处各存一份）', () => {
    const website = SEED_PROJECTS[0].website;
    expect(website).not.toBeNull();
    expect(SEED_SITE_DOMAIN).toBe(website);
    expect(SEED_SITE_PROFILE.domain).toBe(website);
    expect(SEED_SITE_PROFILE.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    // 页面清单与补丁落点一律同域：跨域的落点不属于"这个站"，交接单上出现就是事故
    for (const page of SEED_SITE_PAGES) expect(page.url.startsWith(SEED_SITE_DOMAIN), page.url).toBe(true);
    for (const patch of SEED_SITE_PATCHES) {
      expect(patch.target_url.startsWith(SEED_SITE_DOMAIN), patch.target_url).toBe(true);
    }
  });

  it('每条补丁的 action_id 都能解析到同项目同轮的真实处方', () => {
    for (const patch of SEED_SITE_PATCHES) {
      expect(patch.action_id, patch.id).not.toBeNull();
      const action = SEED_ACTIONS.find((row) => row.id === patch.action_id);
      expect(action, `${patch.id} 挂在不存在的处方 ${patch.action_id} 上`).toBeDefined();
      expect(action?.project_id, patch.id).toBe(patch.project_id);
      expect(action?.round_id, patch.id).toBe(patch.round_id);
    }
  });

  it('🔴 处方说 done ⇒ 名下至少一条已发布，且 published_at 逐字等于处方的 completed_at', () => {
    const done = SEED_ACTIONS.filter((row) => row.status === 'done');
    expect(done.length).toBeGreaterThanOrEqual(5);
    for (const action of done) {
      const published = patchesOf(action.id).filter((row) => row.status === 'published');
      expect(published.length, `处方 ${action.id} 是 done 却没有已发布的补丁`).toBeGreaterThan(0);
      expect(
        published.map((row) => row.published_at),
        `处方 ${action.id} 的完成时刻与补丁的发布时刻对不上`,
      ).toContain(action.completed_at);
    }
  });

  it('🔴 处方还在 todo / in_progress ⇒ 名下只可能有草案（说"上线了"就是自相矛盾）', () => {
    const open = SEED_ACTIONS.filter((row) => row.status !== 'done');
    expect(open.length).toBeGreaterThan(0);
    for (const action of open) {
      for (const patch of patchesOf(action.id)) {
        expect(patch.status, `处方 ${action.id} 未完成，补丁 ${patch.id} 却是 ${patch.status}`).toBe('draft');
        expect(patch.published_at, patch.id).toBeNull();
      }
    }
  });

  it('已发布的补丁 published_body 与 body 逐字相同（快照由不变式派生，不在种子里抄第二遍）', () => {
    for (const patch of SEED_SITE_PATCHES) {
      if (patch.status === 'published') {
        expect(patch.published_body, `已发布的 ${patch.id} 没有快照`).not.toBeNull();
        expect(patch.published_body, `${patch.id} 的快照与草案分叉了`).toBe(patch.body);
      }
      if (patch.status === 'draft') expect(patch.published_at, patch.id).toBeNull();
    }
    // 已撤回那一条刻意留着**旧快照**：它就是"回滚的落点"，没有它回滚在 demo 里走查不出来
    expect(SEED_SITE_PATCHES.some((row) => row.status === 'unpublished' && row.published_body !== null)).toBe(true);
  });

  it('🔴 生成池与台账按 (action_id, kind, target_url) 互斥（否则"从处方生成"永远回空数组）', () => {
    const inLedger = new Set(SEED_SITE_PATCHES.map(slotOf));
    let pooled = 0;
    for (const [actionId, rows] of Object.entries(SEED_SITE_PATCH_POOL)) {
      expect(SEED_ACTIONS.some((row) => row.id === actionId), `池子里有陌生处方 ${actionId}`).toBe(true);
      for (const row of rows) {
        pooled += 1;
        const slot = slotOf({ action_id: actionId, kind: row.kind, target_url: row.target_url });
        expect(inLedger, `池子条目 ${slot} 已经在台账里了`).not.toContain(slot);
      }
    }
    expect(pooled).toBeGreaterThan(0);
    // 池内自身也不许重复：同一个 (kind, target_url) 出两行，勾选框就长得一模一样
    const slots = Object.entries(SEED_SITE_PATCH_POOL).flatMap(([actionId, rows]) =>
      rows.map((row) => slotOf({ action_id: actionId, kind: row.kind, target_url: row.target_url })),
    );
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('🔴 source_layout 类处方既不在池子里、也不在台账里（落点在站外，产品定义 §3.12 不自动发布）', () => {
    const offSite = SEED_ACTIONS.filter((row) => row.category === 'source_layout');
    expect(offSite.length).toBeGreaterThan(0);
    for (const action of offSite) {
      expect(poolKeys.has(action.id), `站外处方 ${action.id} 不该进生成池`).toBe(false);
      expect(patchesOf(action.id), `站外处方 ${action.id} 不该有补丁`).toHaveLength(0);
    }
    // 反过来也要有：站内处方里得有几条真的进了池子，否则生成弹窗全是空态
    const onSite = SEED_ACTIONS.filter((row) => row.category !== 'source_layout');
    expect(onSite.filter((row) => poolKeys.has(row.id)).length).toBeGreaterThanOrEqual(3);
  });

  it('事件的时间戳只可能是那条补丁的 created / published / updated 三者之一（不许凭空多一个时刻）', () => {
    for (const event of SEED_SITE_PATCH_EVENTS) {
      const patch = SEED_SITE_PATCHES.find((row) => row.id === event.patch_id);
      const stamps = new Set([patch?.created_at, patch?.published_at, patch?.updated_at]);
      expect(stamps.has(event.created_at), `事件 ${event.id} 的时刻 ${event.created_at} 不在补丁的时间轴上`).toBe(true);
    }
    // 每条补丁至少有一个 created 事件：历史弹窗空着等于这条链路没走查过
    for (const patch of SEED_SITE_PATCHES) {
      const kinds = SEED_SITE_PATCH_EVENTS.filter((row) => row.patch_id === patch.id).map((row) => row.kind);
      expect(kinds, `补丁 ${patch.id} 没有 created 事件`).toContain('created');
    }
    // 状态与事件对得上：published ⇒ 有 published 事件；unpublished ⇒ 有 unpublished 事件
    for (const patch of SEED_SITE_PATCHES) {
      const kinds = SEED_SITE_PATCH_EVENTS.filter((row) => row.patch_id === patch.id).map((row) => row.kind);
      if (patch.status !== 'draft') expect(kinds, patch.id).toContain(patch.status === 'published' ? 'published' : 'unpublished');
    }
  });

  it('审核态与来源都取自既有枚举（复用 action.contentStatuses，不新写一份）', () => {
    for (const patch of SEED_SITE_PATCHES) {
      expect(CONTENT_STATUS_VALUES, patch.id).toContain(patch.review_status as (typeof CONTENT_STATUS_VALUES)[number]);
      expect(['generated', 'manual'], patch.id).toContain(patch.source);
    }
    // 手动录入那条要真的存在：不然"手动新建"这个入口在 demo 里没有对价
    expect(SEED_SITE_PATCHES.some((row) => row.source === 'manual')).toBe(true);
  });
});

describe('demo/seed · M3–M7 的稳定记号必须在词典里有词条', () => {
  // 种子只发**记号**，文字由界面按语言渲染（AGENTS 规则 7）。漏一个词条，界面上就直接露出
  // `report.columns.fact_error_rate` 这种机器串——`enumLabel` 的回退是 id 本身，不是中文，
  // 所以它显眼但仍然是破绽。这里把「种子里出现过的每个记号」与词典键集对齐。
  it('报告节 / 指标 / 表头、模板章节、告警与维度记号都能在 zh-CN 词典里查到', () => {
    initI18n('zh-CN');
    const bundle = i18n.getResourceBundle('zh-CN', 'translation') as ZhBundleShape;

    const sectionIds = new Set<string>();
    const metricIds = new Set<string>();
    const columnKeys = new Set<string>(EVIDENCE_COLUMN_KEYS);
    for (const payload of Object.values(SEED_REPORTS)) {
      for (const block of payload.headline) metricIds.add(block.metric);
      for (const [sectionId, blocks] of Object.entries(payload.sections)) {
        sectionIds.add(sectionId);
        for (const block of blocks) {
          if (block.kind === 'metric') metricIds.add(block.metric);
          if (block.kind === 'table') for (const key of block.column_keys) columnKeys.add(key);
        }
      }
    }
    for (const sectionId of Object.values(SEED_VARIANT_SECTIONS).flat()) sectionIds.add(sectionId);

    const missing = (ids: Iterable<string>, group: Record<string, string>) =>
      [...ids].filter((id) => group[id] === undefined).sort();

    expect(missing(sectionIds, bundle.report.sections)).toEqual([]);
    expect(missing(metricIds, bundle.report.metrics)).toEqual([]);
    expect(missing(columnKeys, bundle.report.columns)).toEqual([]);

    const templateSections = new Set<string>();
    const templateKinds = new Set<string>();
    for (const template of SEED_CONTENT_TEMPLATES) {
      templateKinds.add(template.kind);
      for (const key of template.section_keys) templateSections.add(key);
    }
    expect(missing(templateSections, bundle.action.templateSections)).toEqual([]);
    expect(missing(templateKinds, bundle.action.templates.kinds)).toEqual([]);

    const attributionMetrics = new Set<string>();
    for (const card of SEED_ATTRIBUTION_CARDS) {
      for (const metric of card.metrics) attributionMetrics.add(metric.metric);
    }
    expect(missing(attributionMetrics, bundle.action.attribution.metrics)).toEqual([]);

    const categories = new Set(SEED_ACTIONS.map((item) => item.category));
    expect(missing(categories, bundle.action.categories)).toEqual([]);

    const dimensions = new Set<string>();
    for (const overview of Object.values(SEED_DIAGNOSIS_OVERVIEWS)) {
      for (const dimension of overview.dimensions) dimensions.add(dimension.dimension);
    }
    expect(missing(dimensions, bundle.diagnosis.dimensions.names)).toEqual([]);

    // 告警的真值是 `db.alerts`（种子 SEED_ALERTS），种类 / 严重度 / 指标记号都要有词条。
    const db = createDemoDb();
    const alertKinds = new Set(db.alerts.map((alert) => alert.kind));
    const alertSeverities = new Set(db.alerts.map((alert) => alert.severity));
    const alertMetrics = new Set(db.alerts.map((alert) => alert.metric));
    expect(missing(alertKinds, bundle.diagnosis.alerts.kinds)).toEqual([]);
    expect(missing(alertSeverities, bundle.diagnosis.alerts.severities)).toEqual([]);
    expect(missing(alertMetrics, bundle.diagnosis.alerts.metrics)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M5.5 站长数据（spec `2026-10-12-webmaster-data-integration-design.md` §5.2）
// ---------------------------------------------------------------------------

/** 造一个筛选态：默认「传统搜索面 / 按关键词透视 / 不限时间不限源」，再按判据需要覆盖。 */
function searchFilter(patch: Partial<SearchFilter>): SearchFilter {
  return { ...defaultSearchFilter(), ...patch };
}

/** 按 id 取种子指标行；取不到就炸（判据里出现拼错的 id 必须红，不许静默跳过）。 */
function seedMetric(id: string): SearchQueryMetric {
  const row = SEED_SEARCH_QUERY_METRICS.find((item) => item.id === id);
  if (row === undefined) throw new Error(`missing seed metric: ${id}`);
  return row;
}

/** 按规则号取那条机会（§5.2 第 12 条钉住"每条规则恰好一条"⇒ 这里取到的就是唯一那条）。 */
function seedOpportunity(ruleId: SearchRuleId): SearchOpportunity {
  const row = SEED_SEARCH_OPPORTUNITIES.find((item) => item.rule_id === ruleId);
  if (row === undefined) throw new Error(`missing seed opportunity: rule ${ruleId}`);
  return row;
}

/** 一条机会点名的那几行证据。 */
function evidenceOf(ruleId: SearchRuleId): SearchQueryMetric[] {
  return seedOpportunity(ruleId).evidence_metric_ids.map(seedMetric);
}

/**
 * A 类手工合计（🔴 站内分析组按 DR-110 护栏 2 剔掉）。
 * 与 `summarizeMetrics` 的结果对账用：一份是这里按 §5.2 的口径手数出来的，一份是 compose 真算的。
 */
function manualClassATotals(rows: readonly SearchQueryMetric[]): {
  impressions: number;
  clicks: number;
  citations: number;
} {
  const totals = { impressions: 0, clicks: 0, citations: 0 };
  for (const row of rows) {
    if (isAnalyticsSource(row.source_kind)) continue;
    totals.impressions += row.impressions ?? 0;
    totals.clicks += row.clicks ?? 0;
    totals.citations += row.citations ?? 0;
  }
  return totals;
}

/** 同一个源里各行的重算 CTR（B 类"只能重算不能平均"里那个**不许被平均**的东西）。 */
function perSourceCtrs(rows: readonly SearchQueryMetric[]): number[] {
  const bySource = new Map<string, { impressions: number; clicks: number }>();
  for (const row of rows) {
    if (isAnalyticsSource(row.source_kind)) continue;
    const own = bySource.get(row.source_kind) ?? { impressions: 0, clicks: 0 };
    own.impressions += row.impressions ?? 0;
    own.clicks += row.clicks ?? 0;
    bySource.set(row.source_kind, own);
  }
  return [...bySource.values()]
    .filter((own) => own.impressions > 0)
    .map((own) => own.clicks / own.impressions);
}

/**
 * M5.5 的种子自检。🔴 这一节与前面几节的分量不同：站长数据是**唯一**一轮"demo 真算"的模块
 * （DR-99：映射查表、A 类求和、B 类重算、区间收敛都在 `api/search-compose.ts` 真跑），
 * 所以种子里每个比率都必须是**手写字面量**且手工算对——一旦有人把 `ctr` 改成现场
 * `clicks / impressions` 算出来，第 1 条判据就退化成永真式，而界面上端出去的数是错的也没人知道。
 *
 * 🔴 变异验证（§7 的 ①②③⑤⑥ 五条都落在这一节）：把 `ai_ctr` 的分母换成曝光量、把百度统计
 * 并进 A 类合计、把汇总 CTR 换成各源平均、把 `aggregate_window` 换成用户选的区间、
 * 把外部曲线的 `enabled_by_default` 改成 `true` —— 下面对应的判据都必须红。
 */
describe('demo/seed · M5.5 站长数据：源清单钉在目录表上（DR-92 / DR-96 / DR-108）', () => {
  it('一期 7 个源各一行；二期两个源连窗口都不给（开放二期只改目录表一个数字）', () => {
    const phase1 = SEARCH_SOURCE_CATALOG.filter((entry) => entry.phase === 1).map((entry) => entry.kind);
    expect(phase1).toHaveLength(7);
    expect(SEED_SEARCH_SOURCES).toHaveLength(7);
    expect(SEED_SEARCH_SOURCES.map((row) => row.kind).sort()).toEqual([...phase1].sort());

    for (const entry of SEARCH_SOURCE_CATALOG.filter((item) => item.phase === 2)) {
      expect(SEED_SEARCH_SOURCES.some((row) => row.kind === entry.kind), entry.kind).toBe(false);
      expect(SEED_SEARCH_QUERY_METRICS.some((row) => row.source_kind === entry.kind), entry.kind).toBe(false);
      // 自检结论仍然要有（`Record<SearchSourceKind, …>` 的穷尽性网）：开放二期时命令面自动放开。
      expect(SEED_SEARCH_SOURCE_PROBES[entry.kind].check_detail.code, entry.kind).not.toBe('');
    }
    expect(Object.keys(SEED_SEARCH_SOURCE_PROBES).sort()).toEqual([...SEARCH_SOURCE_VALUES].sort());
  });

  it('group / region / auth_mode / ingest_modes / 绑定键集逐字对得上目录表（种子写死、测试比对）', () => {
    for (const source of SEED_SEARCH_SOURCES) {
      const entry = catalogEntryOf(source.kind);
      expect(source.group, source.kind).toBe(entry.group);
      expect(source.region, source.kind).toBe(entry.region);
      expect(source.auth_mode, source.kind).toBe(entry.auth_mode);
      expect([...source.ingest_modes], source.kind).toEqual([...entry.ingest_modes]);
      expect(Object.keys(source.binding).sort(), source.kind).toEqual([...entry.binding_fields].sort());
      // 绑定值是**非敏感**的站点标识（DR-96）：填了就不许是空串，`manual` 没有绑定字段 ⇒ 空对象。
      for (const value of Object.values(source.binding)) expect(value.trim(), source.kind).not.toBe('');
      expect(source.status, source.kind).toBe('ready');
      expect(source.project_id, source.kind).toBe(SEED_ACTIVE_PROJECT_ID);
    }
    // 三个分组都要有源（DR-104 的三分组卡片墙，缺一组界面上就是一块空白）。
    expect(new Set(SEED_SEARCH_SOURCES.map((row) => row.group)).size).toBe(3);
  });

  it('凭据面：库里只有 `keyring://search/<kind>` 这个引用串，一个形密码的值都没有（规则 3 / DR-96）', () => {
    for (const source of SEED_SEARCH_SOURCES) {
      if (source.auth_mode === 'none') {
        expect(source.credentials_state, source.kind).toBe('not_required');
        expect(source.secret_ref, source.kind).toBeNull();
      } else {
        // demo 不演 OAuth 全流程（DR-99）⇒ 一律 `missing`，`stored` 永不出现。
        expect(source.credentials_state, source.kind).toBe('missing');
        expect(source.secret_ref, source.kind).toBe(searchSecretRef(source.kind));
        // 引用串是**账号级两段**（`keyring://search/<kind>`，DR-96）：
        // 不带项目 id 那一段——那是站点通道（三段）的形状，两者不得混。
        expect(source.secret_ref, source.kind).toBe(`keyring://search/${source.kind}`);
      }
      const serialized = JSON.stringify(source).toLowerCase();
      expect(serialized, source.kind).not.toContain('password');
      expect(serialized, source.kind).not.toContain('ya29.');
    }
  });

  it('`data_through` == `resolveDataThrough(kind, {period_end, imported_at})`：取更早的那个（DR-109）', () => {
    for (const source of SEED_SEARCH_SOURCES) {
      const rows = SEED_SEARCH_QUERY_METRICS.filter((row) => row.source_kind === source.kind);
      expect(rows.length, source.kind).toBeGreaterThan(0);
      // 同一个源的一批数据共享一个窗口（种子里由 WINDOW_BY_SOURCE 推导 ⇒ 这里验它真的只有一份）。
      const periodEnds = new Set(rows.map((row) => row.period_end));
      const importedAts = new Set(rows.map((row) => row.imported_at));
      const throughs = new Set(rows.map((row) => row.data_through));
      const completions = new Set(rows.map((row) => row.completeness));
      expect(periodEnds.size, source.kind).toBe(1);
      expect(importedAts.size, source.kind).toBe(1);
      expect(throughs.size, source.kind).toBe(1);
      expect(completions.size, source.kind).toBe(1);
      expect(source.data_through, source.kind).toBe([...throughs][0]);
      expect(
        resolveDataThrough(source.kind, {
          period_end: [...periodEnds][0],
          imported_at: [...importedAts][0],
        }),
        `${source.kind} 的截至日与目录表 lag_days 算出来的不一致`,
      ).toBe(source.data_through);
      for (const row of rows) expect(row.mapping_version, row.id).toBe(MAPPING_VERSION);
    }
    for (const overview of SEED_SEARCH_AI_OVERVIEWS) {
      expect(overview.mapping_version, overview.id).toBe(MAPPING_VERSION);
    }
  });
});

describe('demo/seed · M5.5 站长数据：§5.2 的 16 条自洽判据', () => {
  it('① 每行 ctr == clicks / impressions（±0.001），且 ctr 为空当且仅当分子分母为空', () => {
    let checked = 0;
    for (const row of SEED_SEARCH_QUERY_METRICS) {
      if (row.impressions === null || row.clicks === null) {
        // 🔴 `null` 与 `0` 不许互换（DR-94）："平台没给这一列"不能写成"点击率 0"。
        expect(row.ctr, row.id).toBeNull();
        continue;
      }
      expect(row.ctr, row.id).not.toBeNull();
      expect(row.impressions, row.id).toBeGreaterThan(0);
      expect(row.clicks, row.id).toBeGreaterThanOrEqual(0);
      expect(Math.abs((row.ctr as number) - row.clicks / row.impressions), row.id).toBeLessThanOrEqual(0.001);
      checked += 1;
    }
    // 防空跑：30 行里 27 行带 A 类指标，百度统计那 3 行全空（判据⑬）。
    expect(SEED_SEARCH_QUERY_METRICS).toHaveLength(30);
    expect(checked).toBe(27);
    // 两个面都要有行（AI 面 7 行 / 传统面 23 行）。
    expect(SEED_SEARCH_QUERY_METRICS.filter((row) => row.surface === 'ai_answer')).toHaveLength(7);
    expect(SEED_SEARCH_QUERY_METRICS.filter((row) => row.surface === 'web_search')).toHaveLength(23);
  });

  it('② AI 汇总的 ai_ctr == ai_clicks / citations —— 🔴 分母是**引用量**、不是曝光量（变异①）', () => {
    const overview = SEED_SEARCH_AI_OVERVIEWS.find((row) => row.source_kind === 'baidu_ziyuan_ai');
    expect(overview, '百度《AI 流量分析》至少要有一条项目级汇总').toBeDefined();
    // 🔴 四个数都是 `number | null`（DR-94："平台没给这一列"与"这一列是 0"是两个结论）
    // ⇒ 这里先把它们收成非空，判据才谈得上"算对"。
    const citations = overview!.citations;
    const aiClicks = overview!.ai_clicks;
    const aiCtr = overview!.ai_ctr;
    expect(citations, overview!.id).not.toBeNull();
    expect(aiClicks, overview!.id).not.toBeNull();
    expect(aiCtr, overview!.id).not.toBeNull();
    const cited = citations as number;
    const clicks = aiClicks as number;
    const ctr = aiCtr as number;
    expect(cited).toBeGreaterThan(0);
    expect(clicks).toBeGreaterThan(0);
    expect(Math.abs(ctr - clicks / cited)).toBeLessThanOrEqual(0.001);

    // 🔴 变异① 的护栏：拿 AI 面的**曝光量**当分母算出来的数必须与种子里那个显著不同，
    // 否则"分母是引用量"这条判据就退化成两种写法都能过的永真式（界面上会差五倍）。
    const aiImpressions = SEED_SEARCH_QUERY_METRICS
      .filter((row) => row.source_kind === overview!.source_kind && row.surface === 'ai_answer')
      .reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    expect(aiImpressions).toBeGreaterThan(cited);
    expect(Math.abs(ctr - clicks / aiImpressions)).toBeGreaterThan(0.001);

    // 概览段是**全站**口径，热门关键词表只是它的一个切片 ⇒ 两者不该相等（相等反而说明抄错了）。
    const slice = SEED_SEARCH_QUERY_METRICS
      .filter((row) => row.source_kind === overview!.source_kind)
      .reduce((sum, row) => sum + (row.citations ?? 0), 0);
    expect(cited).toBeGreaterThan(slice);
    // C 类留档里的「引用页面量」与概览的 `cited_pages` 是同一个数（同一份导出的两个落点）。
    const citedPages = SEED_SEARCH_NATIVE_EXTRAS.find(
      (row) => row.source_kind === 'baidu_ziyuan_ai' && row.metric_id === null,
    );
    expect(citedPages, overview!.id).toBeDefined();
    expect(citedPages!.value).toBe(overview!.cited_pages);
    expect(overview!.cited_pages).not.toBeNull();
  });

  it('③ 单源单周期的汇总 == 该源该周期导入行按 surface 求和（compose 真算，种子对账）', () => {
    let compared = 0;
    for (const surface of ['web_search', 'ai_answer'] as const) {
      const kinds = new Set(
        SEED_SEARCH_QUERY_METRICS.filter((row) => row.surface === surface).map((row) => row.source_kind),
      );
      for (const kind of kinds) {
        // 站内分析组不进 A 类合计（DR-110 护栏 2，判据⑬单独钉）。
        if (isAnalyticsSource(kind)) continue;
        const own = SEED_SEARCH_QUERY_METRICS.filter(
          (row) => row.source_kind === kind && row.surface === surface,
        );
        const totals = manualClassATotals(own);
        const summary = summarizeMetrics(
          SEED_SEARCH_QUERY_METRICS,
          searchFilter({ surface, source_kinds: [kind] }),
          SEED_SEARCH_AS_OF,
        );
        expect(summary.impressions, `${kind} / ${surface}`).toBe(totals.impressions);
        expect(summary.clicks, `${kind} / ${surface}`).toBe(totals.clicks);
        expect(summary.citations, `${kind} / ${surface}`).toBe(totals.citations);
        expect(summary.row_count, `${kind} / ${surface}`).toBe(own.length);
        expect(summary.participants.map((row) => row.source_kind), `${kind} / ${surface}`).toEqual([kind]);
        compared += 1;
      }
    }
    // 防空跑：传统面 6 个源里剔掉百度统计（站内分析组）= 5 组，AI 面只有百度《AI 流量分析》= 1 组。
    expect(compared).toBe(6);
  });

  it('④ 汇总 ctr == Σclicks ÷ Σimpressions，且🔴不等于各源 ctr 的算术平均（DR-110 护栏 3 / 变异③）', () => {
    const filter = searchFilter({ surface: 'web_search' });
    const summary = summarizeMetrics(SEED_SEARCH_QUERY_METRICS, filter, SEED_SEARCH_AS_OF);
    const webRows = SEED_SEARCH_QUERY_METRICS.filter((row) => row.surface === 'web_search');
    const totals = manualClassATotals(webRows);

    // 手数的合计（20090 次曝光 / 650 次点击）与 compose 真算的必须逐字相同。
    expect(totals.impressions).toBe(20090);
    expect(totals.clicks).toBe(650);
    expect(summary.impressions).toBe(totals.impressions);
    expect(summary.clicks).toBe(totals.clicks);
    expect(summary.ctr).not.toBeNull();
    expect(Math.abs((summary.ctr as number) - totals.clicks / totals.impressions)).toBeLessThan(1e-9);

    // 🔴 变异③ 的护栏：各源自己的重算 CTR 取算术平均必须与合计 CTR **不同**（DR-95 B 类）。
    const ctrs = perSourceCtrs(webRows);
    expect(ctrs.length).toBeGreaterThan(1);
    const mean = ctrs.reduce((sum, value) => sum + value, 0) / ctrs.length;
    expect(Math.abs(mean - (summary.ctr as number))).toBeGreaterThan(0.001);
  });

  it('⑤ 汇总区间收敛到各源 data_through 的交集：gsc 早 3 天且被点名（DR-109 / 变异⑤）', () => {
    expect(SEED_SEARCH_DATA_THROUGH).toBe('2026-09-27');
    expect(SEED_SEARCH_GSC_DATA_THROUGH).toBe('2026-09-24');
    const gsc = SEED_SEARCH_SOURCES.find((row) => row.kind === 'gsc');
    expect(gsc?.data_through).toBe(SEED_SEARCH_GSC_DATA_THROUGH);
    for (const source of SEED_SEARCH_SOURCES) {
      if (source.kind === 'gsc' || source.kind === 'toutiao') continue;
      expect(source.data_through, source.kind).toBe(SEED_SEARCH_DATA_THROUGH);
    }

    // 🔴 用户选到 9/30（比交集更宽）时，合计区间只到 9/24 且点名 gsc —— 不是"用户选的区间"。
    const summary = summarizeMetrics(
      SEED_SEARCH_QUERY_METRICS,
      searchFilter({ from: SEED_SEARCH_PERIOD_START, to: '2026-09-30' }),
      SEED_SEARCH_AS_OF,
    );
    expect(summary.window.start).toBe(SEED_SEARCH_PERIOD_START);
    expect(summary.window.end).toBe(SEED_SEARCH_GSC_DATA_THROUGH);
    expect(summary.window.end).not.toBe('2026-09-30');
    expect(summary.window.limited_by).toEqual(['gsc']);
    expect(summary.window.note_key).toBe(AGGREGATE_WINDOW_LIMITED_KEY);

    // 反向哨兵：只看 gsc 一个源时没什么可收敛的 ⇒ 不点名任何人（单源视图用自己的完整区间）。
    const single = summarizeMetrics(
      SEED_SEARCH_QUERY_METRICS,
      searchFilter({ source_kinds: ['gsc'] }),
      SEED_SEARCH_AS_OF,
    );
    expect(single.window.end).toBe(SEED_SEARCH_GSC_DATA_THROUGH);
    expect(single.window.limited_by).toEqual([]);
  });

  it('⑥ 每条机会的 evidence_metric_ids 都指向**存在**的种子行', () => {
    const ids = new Set(SEED_SEARCH_QUERY_METRICS.map((row) => row.id));
    for (const opportunity of SEED_SEARCH_OPPORTUNITIES) {
      expect(opportunity.evidence_metric_ids.length, opportunity.id).toBeGreaterThan(0);
      for (const id of opportunity.evidence_metric_ids) {
        expect(ids.has(id), `${opportunity.id} → ${id}`).toBe(true);
      }
      expect(new Set(opportunity.evidence_metric_ids).size, opportunity.id).toBe(
        opportunity.evidence_metric_ids.length,
      );
    }
  });

  it('⑦ 规则 5 点名的那一页在 SEED_SITE_PAGES 里存在且 crawlable = false', () => {
    const rows = evidenceOf(5);
    const urls = new Set(rows.map((row) => row.page_url));
    expect(urls.size, '规则 5 的证据行必须点名同一页').toBe(1);
    const url = [...urls][0];
    expect(url).not.toBeNull();
    const page = SEED_SITE_PAGES.find((row) => row.url === url);
    expect(page, `${url} 不在站点页面清单里`).toBeDefined();
    expect(page!.crawlable).toBe(false);
    expect(page!.id).toBe('demo-site-page-004');
    // "挡了有需求的页" ⇒ 这一页确实有曝光，否则结论不成立。
    expect(rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0)).toBeGreaterThan(0);
    // 自建索引三轮的 robots 观测也必须是 false（DR-118 ② 与规则 5 互为佐证）。
    const probes = SEED_SELF_INDEX_SNAPSHOTS.filter(
      (row) => row.kind === 'page_indexability' && row.key === url,
    );
    expect(probes.length).toBeGreaterThan(1);
    for (const probe of probes) expect(probe.robots_ok, probe.id).toBe(false);
  });

  it('⑧ 规则 3 点名的那个词：传统面 clicks > 0、AI 面 citations 为 0 或 null', () => {
    const rows = evidenceOf(3);
    expect(new Set(rows.map((row) => row.query)).size, '两面必须点名同一个词').toBe(1);
    const web = rows.filter((row) => row.surface === 'web_search');
    const ai = rows.filter((row) => row.surface === 'ai_answer');
    expect(web.length).toBeGreaterThan(0);
    expect(ai.length).toBeGreaterThan(0);
    for (const row of web) expect(row.clicks ?? 0, row.id).toBeGreaterThan(0);
    for (const row of ai) expect(row.citations === null || row.citations === 0, row.id).toBe(true);
  });

  it('⑨ 规则 2 点名的那个词**不在**关键词库里（否则判据自相矛盾）', () => {
    const rows = evidenceOf(2);
    const queries = new Set(rows.map((row) => row.query));
    expect(queries.size).toBe(1);
    const library = new Set(SEED_KEYWORDS.map((row) => row.text));
    expect(library.size).toBeGreaterThan(0);
    for (const query of queries) expect(library.has(query), query).toBe(false);
  });

  it('⑩ 所有 page_url / 页面快照的 key 与 SEED_SITE_DOMAIN 同域', () => {
    let withPage = 0;
    for (const row of SEED_SEARCH_QUERY_METRICS) {
      if (row.page_url === null) continue;
      expect(row.page_url.startsWith(SEED_SITE_DOMAIN), `${row.id} → ${row.page_url}`).toBe(true);
      withPage += 1;
    }
    expect(withPage).toBeGreaterThan(20);
    for (const snapshot of SEED_SELF_INDEX_SNAPSHOTS.filter((row) => row.kind === 'page_indexability')) {
      expect(snapshot.key.startsWith(SEED_SITE_DOMAIN), snapshot.id).toBe(true);
      // 页面清单来自 M6（DR-118 ②）⇒ 必须真的在 SEED_SITE_PAGES 里。
      expect(SEED_SITE_PAGES.some((page) => page.url === snapshot.key), snapshot.id).toBe(true);
    }
  });

  it('⑪ 演示周期钉在 2026-09；toutiao 故意过期、gsc 故意标 sampled（DR-105 / DR-110）', () => {
    expect(SEED_SEARCH_PERIOD_START).toMatch(/^2026-09-\d{2}$/);
    expect(SEED_SEARCH_PERIOD_END).toMatch(/^2026-09-\d{2}$/);
    expect(SEED_SEARCH_AS_OF).toBe('2026-09-30');
    for (const row of SEED_SEARCH_QUERY_METRICS) {
      if (row.source_kind === 'toutiao') {
        // 那一批故意停在 8 月（"新站数据延时"是 DR-110 点名的 partial 成因之一）。
        expect(row.period_end, row.id).toBe(SEED_SEARCH_TOUTIAO_DATA_THROUGH);
        continue;
      }
      expect(row.period_start, row.id).toMatch(/^2026-09-\d{2}$/);
      expect(row.period_end, row.id).toMatch(/^2026-09-\d{2}$/);
    }

    // 陈旧判定的边界：正好 35 天不算、第 36 天算（判据不是在钉一个永真式）。
    expect(STALE_AFTER_DAYS).toBe(35);
    expect(isStaleData('2026-08-26', SEED_SEARCH_AS_OF)).toBe(false);
    expect(isStaleData('2026-08-25', SEED_SEARCH_AS_OF)).toBe(true);
    expect(isStaleData(SEED_SEARCH_TOUTIAO_DATA_THROUGH, SEED_SEARCH_AS_OF)).toBe(true);
    for (const source of SEED_SEARCH_SOURCES) {
      if (source.kind === 'toutiao') continue;
      expect(isStaleData(source.data_through as string, SEED_SEARCH_AS_OF), source.kind).toBe(false);
    }

    // 旗标可走查：stale_sources 非空且点名 toutiao、sampled 点名 gsc。
    const summary = summarizeMetrics(SEED_SEARCH_QUERY_METRICS, searchFilter({}), SEED_SEARCH_AS_OF);
    expect(summary.flags.find((flag) => flag.flag === 'stale')?.source_kinds).toContain('toutiao');
    expect(summary.flags.find((flag) => flag.flag === 'sampled')?.source_kinds).toEqual(['gsc']);
    for (const row of SEED_SEARCH_QUERY_METRICS.filter((item) => item.source_kind === 'gsc')) {
      expect(row.completeness, row.id).toBe('sampled');
    }
  });

  it('⑫ 6 条机会每条规则恰好一条，title_key 与 SEARCH_RULE_KEY_BY_ID 对得上', () => {
    expect(SEED_SEARCH_OPPORTUNITIES).toHaveLength(SEARCH_RULE_ID_VALUES.length);
    expect([...SEED_SEARCH_OPPORTUNITIES.map((row) => row.rule_id)].sort()).toEqual([
      ...SEARCH_RULE_ID_VALUES,
    ]);
    expect(new Set(SEED_SEARCH_OPPORTUNITIES.map((row) => row.id)).size).toBe(6);
    for (const opportunity of SEED_SEARCH_OPPORTUNITIES) {
      expect(opportunity.title_key).toBe(
        `webmasterData.rules.${SEARCH_RULE_KEY_BY_ID[opportunity.rule_id]}.name`,
      );
      expect(SEARCH_OPPORTUNITY_STATUS_VALUES).toContain(opportunity.status);
      expect(opportunity.basis.trim(), opportunity.id).not.toBe('');
      expect(opportunity.project_id, opportunity.id).toBe(SEED_ACTIVE_PROJECT_ID);
    }
    // confidence 刻意跨过 REVIEW_CONFIDENCE_FLOOR 两侧（DR-100：不新造第二套置信度口径），
    // 好让"进不进复核队列"这道门槛在界面上走得查。
    expect(REVIEW_CONFIDENCE_FLOOR).toBe(RUST_REVIEW_CONFIDENCE_FLOOR);
    expect(SEED_SEARCH_OPPORTUNITIES.some((row) => row.confidence >= REVIEW_CONFIDENCE_FLOOR)).toBe(true);
    expect(SEED_SEARCH_OPPORTUNITIES.some((row) => row.confidence < REVIEW_CONFIDENCE_FLOOR)).toBe(true);
    // 状态三值都要出现（新 / 已采纳 / 已忽略），否则界面上的筛选与徽章只有一种形态可看。
    expect(new Set(SEED_SEARCH_OPPORTUNITIES.map((row) => row.status)).size).toBe(3);
  });

  it('⑬ 百度统计那 3 行只有 sessions 类字段：A 类全 null、且不进任何合计（DR-110 护栏 2 / 变异②）', () => {
    const tongji = SEED_SEARCH_QUERY_METRICS.filter((row) => row.source_kind === 'baidu_tongji');
    expect(tongji).toHaveLength(3);
    expect(isAnalyticsSource('baidu_tongji')).toBe(true);
    expect(catalogEntryOf('baidu_tongji').group).toBe('analytics');
    for (const row of tongji) {
      expect(row.impressions, row.id).toBeNull();
      expect(row.clicks, row.id).toBeNull();
      expect(row.ctr, row.id).toBeNull();
      expect(row.citations, row.id).toBeNull();
      expect(row.ai_clicks, row.id).toBeNull();
    }

    // 会话数只以 C 类留档的形态存在（映射表里**没有** sessions 这个落库位，DR-107）。
    const sessions = SEED_SEARCH_NATIVE_EXTRAS.filter((row) => row.source_kind === 'baidu_tongji');
    expect(sessions).toHaveLength(3);
    for (const extra of sessions) {
      expect(extra.metric_id, extra.id).not.toBeNull();
      expect(seedMetric(extra.metric_id as string).source_kind, extra.id).toBe('baidu_tongji');
      expect(extra.value, extra.id).toBeGreaterThan(0);
    }

    // 🔴 变异② 的护栏：明细里照样列这 3 行，合计里必须剔掉 ⇒ 行数差恰好等于它，且挂旗说明。
    const filter = searchFilter({ surface: 'web_search' });
    const inScope = filterMetrics(SEED_SEARCH_QUERY_METRICS, filter);
    const summary = summarizeMetrics(SEED_SEARCH_QUERY_METRICS, filter, SEED_SEARCH_AS_OF);
    expect(inScope.length - summary.row_count).toBe(tongji.length);
    expect(summary.flags.find((flag) => flag.flag === 'excluded_analytics')?.source_kinds).toEqual([
      'baidu_tongji',
    ]);
    expect(summary.impressions).toBe(manualClassATotals(inScope).impressions);
  });

  it('⑭ SEED_SEARCH_TRAFFIC_SPLIT 三项之和为 1，且不含任何内置默认推荐（DR-111）', () => {
    expect(SEED_SEARCH_TRAFFIC_SPLIT).toHaveLength(3);
    const sum = SEED_SEARCH_TRAFFIC_SPLIT.reduce((total, item) => total + item.share, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.01);
    for (const item of SEED_SEARCH_TRAFFIC_SPLIT) {
      expect(item.share, item.engine).toBeGreaterThan(0);
      expect(SEARCH_TRAFFIC_ENGINE_VALUES).toContain(item.engine);
    }
    // 这是**这个客户**的分布、不是市场份额表：覆盖全部 7 个引擎恰恰是市场份额表才有的形状。
    expect(SEED_SEARCH_TRAFFIC_SPLIT.length).toBeLessThan(SEARCH_TRAFFIC_ENGINE_VALUES.length);
    // 🔴 没有 analytics 数据 ⇒ 一条建议都不给，而不是端一份通用推荐。
    expect(suggestSources([])).toEqual([]);
    const suggestions = suggestSources(SEED_SEARCH_TRAFFIC_SPLIT);
    expect(suggestions.map((row) => row.engine)).toEqual(['baidu', 'google', 'toutiao']);
    for (const suggestion of suggestions) {
      expect(suggestion.reason_key, suggestion.engine).toBe(SUGGEST_NOW_KEY);
      expect(catalogEntryOf(suggestion.source_kind).phase).toBe(1);
    }
  });

  it('⑮ 外部 CTR 曲线每条都带出处，且默认不参与判定（DR-115 / 变异⑥）', () => {
    expect(SEARCH_CTR_BENCHMARKS.length).toBeGreaterThan(0);
    for (const curve of SEARCH_CTR_BENCHMARKS) {
      expect(curve.source.trim(), curve.source).not.toBe('');
      expect(curve.url.trim(), curve.source).not.toBe('');
      expect(curve.as_of, curve.source).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(curve.year, curve.source).toBeGreaterThan(2000);
      expect(curve.enabled_by_default, curve.source).toBe(false);
      expect(curve.points.length, curve.source).toBeGreaterThan(0);
      for (const point of curve.points) {
        expect(point.position, curve.source).toBeGreaterThan(0);
        expect(point.ctr, curve.source).toBeGreaterThan(0);
        expect(point.ctr, curve.source).toBeLessThan(1);
      }
    }
    // 🔴 变异⑥：设置里没开 ⇒ 一条曲线都给不出来，规则判定拿不到外部基准。
    expect(ctrReferenceBand(false)).toEqual([]);
    expect(ctrReferenceBand(true)).toEqual(SEARCH_CTR_BENCHMARKS);
    // 主基准是站点自身分位数 ⇒ 样本量口径复用既有常量，不新造第二个（DR-115）。
    expect(MINIMUM_SAMPLE_SIZE).toBe(30);
  });

  it('⑯ 自建索引快照与 M3 轮次自洽：round_id / 位次带 / 定长指纹（DR-118）', () => {
    const roundIds = new Set(SEED_COLLECTION_ROUNDS.map((row) => row.id));
    const fingerprint = /^[0-9a-f]{16}$/;
    expect(SEED_SELF_INDEX_SNAPSHOTS).toHaveLength(14);
    for (const snapshot of SEED_SELF_INDEX_SNAPSHOTS) {
      expect(roundIds.has(snapshot.round_id), `${snapshot.id} → ${snapshot.round_id}`).toBe(true);
      expect(SELF_INDEX_SNAPSHOT_KIND_VALUES).toContain(snapshot.kind);
      expect(snapshot.project_id, snapshot.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(snapshot.observed_at, snapshot.id).toMatch(FIXED_SEED_WINDOW);
      expect(snapshot.key.trim(), snapshot.id).not.toBe('');
      // 🔴 只记带、不记精确名次（一次采样支撑不了精确值，规则 6 精神）。
      if (snapshot.rank_band !== null) expect(RANK_BAND_VALUES).toContain(snapshot.rank_band);
      if (snapshot.cite_position_band !== null) {
        expect(RANK_BAND_VALUES).toContain(snapshot.cite_position_band);
        expect(snapshot.cited, snapshot.id).toBe(true);
      }
      // 指纹定长非空、不存原文；`snippet_hash` 只在被引用时才有（没被引就没有"被引的那一段"）。
      if (snapshot.title_hash !== null) expect(snapshot.title_hash, snapshot.id).toMatch(fingerprint);
      if (snapshot.snippet_hash !== null) {
        expect(snapshot.snippet_hash, snapshot.id).toMatch(fingerprint);
        expect(snapshot.cited, snapshot.id).toBe(true);
      }
      if (snapshot.cited === null) expect(snapshot.kind, snapshot.id).not.toBe('ai_citation');
      if (snapshot.kind === 'ai_citation') expect(snapshot.cited, snapshot.id).not.toBeNull();
    }
    // 三块采样面都要有（AI 引用 / 页面可索引性 / SERP 位次带），四值位次带里至少出现三种。
    expect(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.kind)).size).toBe(
      SELF_INDEX_SNAPSHOT_KIND_VALUES.length,
    );
    const bands = SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.rank_band).filter((band) => band !== null);
    expect(bands.length).toBeGreaterThan(0);
    expect(new Set(bands).size).toBeGreaterThanOrEqual(3);
    // 🔴 `search_board` 的读出口（DR-118：命令面不加）——这三个数就是状态卡上显示的数。
    expect(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.engine)).size).toBe(5);
    expect(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.key)).size).toBe(9);
    expect(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.round_id)).size).toBe(3);
    // 被引用的快照数（AI 可见性趋势图的分子）：基线 1 → 复测 2 → 上线 1。
    expect(SEED_SELF_INDEX_SNAPSHOTS.filter((row) => row.cited === true)).toHaveLength(4);
    expect(SELF_INDEX_RETENTION_DAYS).toBe(400);
    // 🔴 自有索引**没有点击**：一行都不许带 A 类指标，界面上不许与 CTR 混成一条曲线。
    for (const snapshot of SEED_SELF_INDEX_SNAPSHOTS) {
      expect('impressions' in snapshot, snapshot.id).toBe(false);
      expect('clicks' in snapshot, snapshot.id).toBe(false);
    }
  });

  it('C 类留档：三类平台独有维度都在，且 label 一律是**映射不上**的平台原文列名（DR-107）', () => {
    const sources = new Set(SEED_SEARCH_NATIVE_EXTRAS.map((row) => row.source_kind));
    // §5.2 点名的三类：Bing `Grounding Queries` / 百度《AI 流量分析》引用页面量 / 百度统计会话数。
    expect(sources.has('bing_wmt')).toBe(true);
    expect(sources.has('baidu_ziyuan_ai')).toBe(true);
    expect(sources.has('baidu_tongji')).toBe(true);
    for (const extra of SEED_SEARCH_NATIVE_EXTRAS) {
      expect(extra.label.trim(), extra.id).not.toBe('');
      expect(Number.isFinite(extra.value), extra.id).toBe(true);
      expect(extra.project_id, extra.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(extra.observed_at, extra.id).toMatch(FIXED_SEED_WINDOW);
      // 🔴 C 类的定义就是"映射不上"：label 若出现在目录表的 alias_columns 里，
      // 说明它本该进指标表（静默丢弃是最坏的失败形态，DR-107）。
      expect(Object.keys(catalogEntryOf(extra.source_kind).alias_columns), extra.id).not.toContain(
        extra.label,
      );
      if (extra.metric_id !== null) {
        expect(seedMetric(extra.metric_id).source_kind, extra.id).toBe(extra.source_kind);
      }
    }
    // 表级留档（`metric_id: null`）与行级留档两种形态都要有。
    expect(SEED_SEARCH_NATIVE_EXTRAS.some((row) => row.metric_id === null)).toBe(true);
    expect(SEED_SEARCH_NATIVE_EXTRAS.some((row) => row.metric_id !== null)).toBe(true);
  });
});
