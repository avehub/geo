/**
 * 知识库条目的**字段标签表**（DR-119，照 `components/entity-fields.ts` 的姿态）。
 *
 * # 为什么要有这张表
 * 修订留痕（`KbEntryRevision`）里存的是后端给的 `field_path`（`body_markdown` 这种机器记号），
 * 界面上要显示成人话就得有一张 path → 词典 key 的表。实体卡那边同一张表叫 `ENTITY_FIELDS`，
 * 两边**刻意不合并**：字段集完全不同（实体卡 7 个结构化事实，知识库 11 个条目属性），
 * 合成一张只会让 `RevisionTimeline` 又要多一个"这条留痕属于谁"的分派。
 *
 * # 装的是 i18n **key** 而不是译文（同 `entity-fields.ts` 的裁定 B-2）
 * 本模块是模块级常量，求值时没有 React 上下文 ⇒ 拿不到 `useTranslation()`。
 * 语言相关的东西一律由调用方送进来（`RevisionTimeline` 里的 `t(labelKey)`），
 * 数据层不 import `t`；`labelKey` 标注 `TranslationKey` ⇒ 拼错的 key 在 `tsc -b` 就红。
 *
 * # 🔴 这张表**不是** `kb.fields.*` 词典键集的封闭声明
 * 与 `ENTITY_FIELDS` 同一条取舍：真后端将来若给留痕补上 `created_at` / `source` 这类
 * 只读字段的 path，`kbFieldLabelKey` 查不到就**回落原始 path**（露出机器记号，
 * 比静默换一套标签安全）。所以词典侧多几个键不算漂移，这里的每个键必须在词典里存在
 * （`i18n/no-hardcoded-strings.test.ts` 的 B-4 那条同族的单向断言）。
 */
import type { TranslationKey } from '../i18n/resources';

export interface KbFieldDescriptor {
  /** 稳定 id，同时是 `KbEntry` 的属性名与 `kb.fields.*` 的键名后缀。 */
  path: string;
  /** 字段标签的词典 key（不是译文）。消费方渲染 `t(descriptor.labelKey)`。 */
  labelKey: TranslationKey;
}

/**
 * **11** 个会被留痕点名的条目字段（`KbEntry` 的属性名，顺序照录入表单的先后）。
 *
 * 🔴 `position` / `verified_at` 也在表里，但**编辑接口改不动它们**
 * （`kb_entry_update` 一律取库里那份）：`verified_at` 由 `kb_entry_verify` 写、
 * `position` 由增删后的重排写。留痕里出现它们 ⇒ 一定来自那两个动作，不是来自编辑。
 */
export const KB_FIELDS: KbFieldDescriptor[] = [
  { path: 'title', labelKey: 'kb.fields.title' },
  { path: 'body_markdown', labelKey: 'kb.fields.body_markdown' },
  { path: 'url', labelKey: 'kb.fields.url' },
  { path: 'mime', labelKey: 'kb.fields.mime' },
  { path: 'tags', labelKey: 'kb.fields.tags' },
  { path: 'status', labelKey: 'kb.fields.status' },
  { path: 'scenario', labelKey: 'kb.fields.scenario' },
  { path: 'verified_at', labelKey: 'kb.fields.verified_at' },
  { path: 'position', labelKey: 'kb.fields.position' },
  { path: 'module', labelKey: 'kb.fields.module' },
  { path: 'kind', labelKey: 'kb.fields.kind' },
];

/**
 * 字段路径 → `kb.fields.*` 的词典 key；查不到返回 **null**（不是 `key ?? path`）。
 *
 * 返回 null 而不是原始 path 是刻意的：把 `path` 当 key 喂给 `t()` 只是"碰巧"因为 i18next
 * 未命中会原样返回，那种隐式依赖一改 `nsSeparator` 就碎 ⇒ 由调用点显式分流
 * （`RevisionTimeline` 里那句 `labelKey === null ? revision.field_path : t(labelKey)`）。
 *
 * 🔴 取**根字段名**再查（与 `entityFieldLabelKey` 同一手法）：今天 KB 的 path 全是扁平的，
 * 但留痕是历史数据，将来真后端若记 `tags[0]` 这种带下标的深层路径，这里不该退化成裸记号。
 */
export function kbFieldLabelKey(path: string): string | null {
  const root = path.split(/[.[]/)[0];
  const match = KB_FIELDS.find((field) => field.path === root);
  return match === undefined ? null : match.labelKey;
}
