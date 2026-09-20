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
