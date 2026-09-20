/**
 * 实体卡字段元数据与展示格式化。
 *
 * 单独成模块（而不是放在 `EntityFieldCard.tsx` 里）有两个原因：
 * 1. `RevisionTimeline` 也要用字段标签与格式化，不该反向依赖组件文件；
 * 2. 组件文件只导出组件，Vite 的 React Fast Refresh 才能生效。
 *
 * # 为什么装的是 i18n **key** 而不是译文（裁定 B-2）
 *
 * 本模块是**模块级常量**，求值时没有 React 上下文，拿不到 `useTranslation()`。
 * 另一条路是把它改成 `entityFields(t)` 这样的工厂函数，被**明确拒绝**：
 * ① 上面那两条"数据与组件分离"的理由是刻意的，工厂函数会把 `t` 渗进数据层；
 * ② 常量保持纯数据 ⇒ 测试可以直接遍历它做词典覆盖断言
 * （`src/i18n/no-hardcoded-strings.test.ts` 的 B-4 那条）。
 *
 * 字段名刻意从 `label` **改名**成 `labelKey`（而不是复用旧名字装新语义）：
 * 留着 `label` 会让"这里装的是中文还是 key"在调用点上看不出来。
 * 类型标注 `TranslationKey` ⇒ 拼错的 key 在 `tsc -b` 就红，不必等到运行期露出裸 key。
 */
import type { TranslationKey } from '../i18n/resources';

export type FieldKind = 'text' | 'textarea' | 'tags' | 'number' | 'json';

export interface FieldDescriptor {
  /** 稳定 id，同时是数据库列名与 `entity.fields.*` 的键名后缀。 */
  path: string;
  /** 字段标签的词典 key（不是译文）。消费方渲染 `t(descriptor.labelKey)`。 */
  labelKey: TranslationKey;
  kind: FieldKind;
  required: boolean;
}

/** 11 个实体卡字段，顺序即 UI 展示顺序（前 10 个计入完整率）。 */
export const ENTITY_FIELDS: FieldDescriptor[] = [
  { path: 'standard_name', labelKey: 'entity.fields.standard_name', kind: 'text', required: true },
  { path: 'aliases', labelKey: 'entity.fields.aliases', kind: 'tags', required: true },
  { path: 'founded_year', labelKey: 'entity.fields.founded_year', kind: 'number', required: true },
  { path: 'qualifications', labelKey: 'entity.fields.qualifications', kind: 'tags', required: true },
  { path: 'products', labelKey: 'entity.fields.products', kind: 'json', required: true },
  { path: 'price_range', labelKey: 'entity.fields.price_range', kind: 'text', required: true },
  { path: 'service_regions', labelKey: 'entity.fields.service_regions', kind: 'tags', required: true },
  { path: 'cases', labelKey: 'entity.fields.cases', kind: 'tags', required: true },
  { path: 'differentiators', labelKey: 'entity.fields.differentiators', kind: 'tags', required: true },
  { path: 'official_tone', labelKey: 'entity.fields.official_tone', kind: 'textarea', required: false },
  { path: 'contact', labelKey: 'entity.fields.contact', kind: 'json', required: true },
];

/**
 * 把任意字段值渲染成人能读的文本。
 *
 * # `listSeparator` 是**必填**参数（fix1 复审 #6 / 裁定 6）
 *
 * 字符串数组的连接符是**语言相关**的：zh 用顿号 `、`，en 用 `, `。原先这里写死 `join('、')`，
 * en locale 下实体卡的 `aliases` / `qualifications` / `service_regions` / `cases` /
 * `differentiators` 与 `RevisionTimeline` 的新旧值都会渲染成 `A、B`——用户可见的错误，
 * 而且两道扫描都看不见它（`、` 是 U+3001，不在 `[\u4e00-\u9fa5]` 区间里）。
 *
 * **必填而不是给默认值**：默认值会让新增调用点静默用回顿号，缺陷重新变成隐形的。
 * 调用点一律传 `t('common.listSeparator')`（该键本轮已存在，**不新建词典键**）。
 *
 * 数据层因此仍然**不 import `t`**（裁定 B-2 原样有效）：`t` 不进数据层，
 * 语言相关的值由调用方作为**参数**送进来。这也是 `labelKey` 那条裁定的同一套姿态。
 *
 * @param listSeparator 语言相关的列表连接符，例如 zh `、` / en `, `。
 */
export function formatFieldValue(value: unknown, listSeparator: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() === '' ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => typeof item === 'string')) {
      return (value as string[]).join(listSeparator);
    }
    return JSON.stringify(value, null, 2);
  }
  return JSON.stringify(value, null, 2);
}
