/**
 * 5 步建项向导的步骤定义与各步字段清单（数据与组件分离，理由同 `entity-fields.ts`）。
 *
 * `title` / `description` 同样改名成 **`titleKey` / `descriptionKey`**（裁定 B-2）：
 * 模块级常量拿不到 `useTranslation()`，装译文就得改成工厂函数把 `t` 渗进数据层。
 *
 * 键名用**稳定 slug** 而不是 index（`steps.brand` 而不是 `steps.0`）：步骤重排时 index 键
 * 会**静默错位**——`steps.2.title` 仍查得到，只是内容变成了另一步的标题，界面不报错、
 * 门禁不红。slug 重排后仍指向同一步。slug 与下面 `WIZARD_STEP_FIELDS` 的分组一一对应。
 */
import type { TranslationKey } from '../i18n/resources';

export interface WizardStep {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    titleKey: 'project.wizard.steps.brand.title',
    descriptionKey: 'project.wizard.steps.brand.description',
  },
  {
    titleKey: 'project.wizard.steps.website.title',
    descriptionKey: 'project.wizard.steps.website.description',
  },
  {
    titleKey: 'project.wizard.steps.products.title',
    descriptionKey: 'project.wizard.steps.products.description',
  },
  {
    titleKey: 'project.wizard.steps.region.title',
    descriptionKey: 'project.wizard.steps.region.description',
  },
  {
    titleKey: 'project.wizard.steps.competitors.title',
    descriptionKey: 'project.wizard.steps.competitors.description',
  },
];

export const WIZARD_STEP_FIELDS: readonly (readonly string[])[] = [
  ['brand_name', 'aliases', 'name'],
  ['website', 'core_pages'],
  ['products', 'service_scope'],
  ['region', 'language', 'industry', 'industry_label', 'tags'],
  ['competitors'],
];

/**
 * 5 步展平去重后的向导字段集（= `ProjectDraft` 的键集，判据 A 在 `wizard-steps.test.ts`）。
 *
 * 排好序再去重：调用方要拿它与 `Object.keys(toProjectDraft({}))` 逐字比，
 * 顺序若来自分组就会随步骤重排漂移，判据会假红。
 */
export const WIZARD_ALL_FIELDS: readonly string[] = [
  ...new Set(WIZARD_STEP_FIELDS.flat()),
].sort();

/**
 * 建项草稿 → 实体卡字段的映射（Plan B Task 7 · 裁定 3 的对齐面）。
 *
 * 🔴 **这张表不驱动任何运行时行为**：真后端建项时由 `fields_from_draft`
 * （真值源 `crates/geo-domain/src/entity_card.rs:508-540`）做这个推导，demo 侧刻意不移植
 * （AGENTS 规则 9：领域逻辑留在 Rust）。它存在的唯一目的是让「手动录入的字段与自动采集的
 * 产出对得上」变成一条**可执行**的判据，而不是走查时靠人眼比两张清单。
 *
 * 一个草稿键可以喂多个实体卡字段（`website` 曾经同时决定 `contact` 与 `official_tone`），
 * 多个草稿键也可以喂同一个字段（`region` 与 `service_scope` 都进 `service_regions`）
 * ⇒ 值域是数组，不是单值。
 *
 * 🔴 本轮 `website` 的值域由 `['contact', 'official_tone']` 收成 `['contact']`：
 * `official_tone` 已退出实体卡、迁进知识库的 `tone` 模块（spec 2026-10-01 · DR-59）。
 * 真后端的 `fields_from_draft` 仍会从官网推一句官方口径 ⇒ 差异 E-58 一并登记。
 */
export const DRAFT_TO_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  brand_name: ['standard_name'],
  aliases: ['aliases'],
  products: ['products'],
  region: ['service_regions'],
  service_scope: ['service_regions'],
  website: ['contact'],
};

/**
 * 只落**项目自身**、不进实体卡的向导字段（判据 D 的点名清单）。
 *
 * 它们不是漏映射：竞品是同框对比的资料、行业决定 prompt 模板库、标签用于多项目检索、
 * `core_pages` 变成自有页面资产、`name`/`language`/`industry_label` 是项目属性
 * （真值源 `project_service.rs:66` 的 `create_draft`）。列出来是为了让
 * 「向导里冒出一个两边都不认的字段」这件事变红，而不是静默漂过去。
 */
export const PROJECT_ONLY_FIELDS: readonly string[] = [
  'competitors',
  'core_pages',
  'industry',
  'industry_label',
  'language',
  'name',
  'tags',
];
