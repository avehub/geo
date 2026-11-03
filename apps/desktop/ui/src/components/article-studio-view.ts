/**
 * 文章管理页面的**派生视图**（M6，spec `2026-10-10-kb-redesign-and-article-studio-design.md` DR-86）。
 *
 * 与 `kb-view.ts` / `site-patch-filters.ts` 同族：纯函数 + 住在 `components/` 而不是页面里
 * （`react-refresh/only-export-components` 会点名从组件文件导出的非组件）。
 *
 * # 🔴 三张表都不自己去取"第二份数据"
 * 模板表要显示**方向标题**、排期表要显示**模板名**、评审队列两样都要：这些都在页面层
 * 已有的清单里，所以由页面算好一个 `id → 文案` 的查找函数传下去。表格组件因此是纯展示的，
 * 也不会为了一个标题多打一条 IPC。
 *
 * # 🔴 查不到一律回落**空串**，由调用方决定怎么显示
 * 空串是"没有这个关联"的信号：表格与抽屉把它渲染成空值占位符 `—`。
 * 回落成裸 id 等于把内部记号端给用户（本轮删模板会连带删排期，但**已生成的文章保留**，
 * 它们的 `template_id` 就真的指向一份不存在的模板 ⇒ 这一支不是防御性写法，是会走到的）。
 */
import type { ArticleDirection, ArticleTemplate } from '../api/types';

/** 方向 id → 挂在它下面的行数（模板数 / 累计产出文章数，方向卡的脚注）。 */
export function countByDirection(rows: readonly { direction_id: string }[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const row of rows) acc[row.direction_id] = (acc[row.direction_id] ?? 0) + 1;
  return acc;
}

/** 方向清单 → `id → 标题` 的查找函数（认不出回空串，见文件头）。 */
export function directionTitleLookup(
  directions: readonly ArticleDirection[],
): (directionId: string) => string {
  const index = new Map(directions.map((row) => [row.id, row.title]));
  return (directionId) => index.get(directionId) ?? '';
}

/** 模板清单 → `id → 名称` 的查找函数。 */
export function templateNameLookup(
  templates: readonly ArticleTemplate[],
): (templateId: string) => string {
  const index = new Map(templates.map((row) => [row.id, row.name]));
  return (templateId) => index.get(templateId) ?? '';
}
