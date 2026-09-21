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

import { FIELD_STATUS_VALUES, INTENT_VALUES, PROMPT_SOURCE_VALUES } from '../api/types';
import { MINIMUM_SAMPLE_SIZE, SUFFICIENT_SAMPLE_SIZE } from '../api/constants';
import { enumLabel } from '../i18n/enum-label';
import { i18n, initI18n } from '../i18n';
import { createDemoDb, demoSecretRef } from './db';
import {
  SEED_ACTIVE_COMPETITOR_IDS,
  SEED_ACTIVE_PROJECT_ID,
  SEED_ARCHIVED_PROJECT_ID,
  SEED_ASSETS,
  SEED_COMPETITORS,
  SEED_PROJECTS,
} from './seed/projects';
import { SEED_ENTITY_CARD_REVISIONS, SEED_ENTITY_CARDS } from './seed/entity-cards';
import { SEED_PROMPT_ITEMS, SEED_PROMPT_SETS } from './seed/prompt-sets';
import { INSUFFICIENT_PROMPT_ROWS } from './seed/prompt-items-insufficient';
import { SUFFICIENT_PROMPT_ROWS } from './seed/prompt-items-sufficient';
import { SEED_SETTINGS } from './seed/settings';

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

    expect(dictionaryIds).toEqual([
      'deep_seek',
      'moonshot',
      'volcengine_ark',
      'ali_bailian',
      'baidu_qianfan',
      'tencent_hunyuan',
      'custom',
    ]);
    expect(SEED_SETTINGS.providers.map((info) => info.provider)).toEqual(dictionaryIds);
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
    expect(SEED_SETTINGS.app.model).toEqual({
      provider: 'deep_seek',
      model: null,
      base_url: null,
      temperature: 0.3,
      timeout_secs: 60,
    });
    expect(SEED_SETTINGS.app.notify).toEqual({ on_finish: true, on_risk: true, sound: false });
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
  it('2 个项目：1 个 active（archived_at 为 null）、1 个 archived（archived_at 有值）', () => {
    expect(SEED_PROJECTS).toHaveLength(2);
    expect(SEED_PROJECTS.map((project) => project.status)).toEqual(['active', 'archived']);
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

  it('1 条修订种子，field_path 指向实体卡真实存在的字段', () => {
    expect(SEED_ENTITY_CARD_REVISIONS).toHaveLength(1);
    const revision = SEED_ENTITY_CARD_REVISIONS[0];
    const card = SEED_ENTITY_CARDS[0];

    expect(revision.project_id).toBe(card.project_id);
    expect(Object.keys(card.fields)).toContain(revision.field_path);
    expect(FIELD_STATUS_VALUES as readonly string[]).toContain(revision.status);
    expect(revision.edited_at).toMatch(FIXED_SEED_WINDOW);
    expect(revision.old_value).not.toEqual(revision.new_value);
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

    // 19 = 项目 5（含归档项目的 archived_at）+ 竞品 4 + 资产 4 + 实体卡 3（含 generated_at）
    // + 修订 1 + 题库 2。写死而不是写下界：种子被谁悄悄删了一个时间戳也要红。
    expect(found).toHaveLength(19);
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
