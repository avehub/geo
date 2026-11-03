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

/**
 * **7** 个实体卡字段，顺序即 UI 展示顺序（7 个全必填 ⇒ 都计入完整率）。
 *
 * 🔴 本轮由 11 项收窄到 7 项（spec `2026-10-01-entity-card-slim-and-knowledge-base-design.md` DR-59）：
 * - `price_range` **取消独立卡片**，报价改成每个产品自带一个字段（`ProductSpec.price`，DR-60）
 *   ⇒ 它随 `products` 这张 `json` 卡一起显示与编辑，不再单列；
 * - `cases` / `differentiators` / `official_tone` 三张卡**取消**，内容迁进知识库的
 *   `case` / `differentiator` / `tone` 三个模块（`demo/seed/kb.ts` 已迁好，界面上可增删改）。
 *
 * 实体卡因此回到它的本职：「我是谁」的**结构化事实**；「我怎么讲自己」下沉到知识层。
 *
 * ⚠ 这张表**不是** `entity.fields.*` 词典的键集：词典里那四个已迁出字段的标签**刻意保留**
 * （DR-62）——真后端的 `ALL_FIELDS` 还是 11，历史修订留痕与事实核查记录里仍会出现这些
 * `field_path`，`RevisionTimeline` / `FactCheckPanel` 查不到标签就会露出裸 id。
 * 所以 `i18n/no-hardcoded-strings.test.ts` 的 B-4 只断言**单向**（这里的每个 key 都在词典里）。
 */
export const ENTITY_FIELDS: FieldDescriptor[] = [
  { path: 'standard_name', labelKey: 'entity.fields.standard_name', kind: 'text', required: true },
  { path: 'aliases', labelKey: 'entity.fields.aliases', kind: 'tags', required: true },
  { path: 'founded_year', labelKey: 'entity.fields.founded_year', kind: 'number', required: true },
  { path: 'qualifications', labelKey: 'entity.fields.qualifications', kind: 'tags', required: true },
  { path: 'products', labelKey: 'entity.fields.products', kind: 'json', required: true },
  { path: 'service_regions', labelKey: 'entity.fields.service_regions', kind: 'tags', required: true },
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

/**
 * 字段路径 → `entity.fields.*` 的词典 key；查不到返回 **null**。
 *
 * 🔴 DR-119 把它从 `components/RevisionTimeline.tsx` 搬到这里并导出：时间线组件被泛化成
 * "吃任何六键同构的留痕"（实体卡 + 知识库），字段标签表因此必须由**调用方**送进来
 * （`labelKeyOf` 那个 prop）。留在组件文件里有两个坏处：① 组件会同时认得两张标签表，
 * 迟早长出"这条留痕属于谁"的分派；② `.tsx` 只导出组件，Vite 的 React Fast Refresh 才生效
 * （本文件头注那条裁定），从组件里 `export function` 会踩 `react-refresh/only-export-components`。
 *
 * 返回 **key 或 null**（而不是 `key ?? path`）是刻意的：`path` 是后端给的原始字段路径
 * （可能是 `products[0].name` 这种带下标的），把它当 key 喂给 `t()` 只是"碰巧"因为
 * i18next 未命中会原样返回 key。那种隐式依赖一改 `nsSeparator` 就碎，所以调用点显式分流。
 *
 * 🔴 取**根字段名**再查（`products[0].price` → `products`）：报价并进产品之后（spec 2026-10-01 ·
 * DR-60），留痕里会出现带下标的深层路径；只认 `products.name` 这种点号形态的话，
 * 碰到 `products[0].price` 会回落成裸路径（界面上露出机器记号）。改了哪个产品的哪个字段，
 * 由那行新旧值与 `note` 说明，标签只负责回答"这是哪一类字段"。
 *
 * 知识库那侧的同族函数是 `components/kb-fields.ts` 的 `kbFieldLabelKey`（DR-119）。
 */
export function entityFieldLabelKey(path: string): string | null {
  const root = path.split(/[.[]/)[0];
  const match = ENTITY_FIELDS.find((field) => field.path === root);
  return match === undefined ? null : match.labelKey;
}
