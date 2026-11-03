/**
 * 提示词模板的**槽位记号**：解析、光标处插入、实时预览替换（spec 2026-10-10 · DR-84 / DR-86②）。
 *
 * # 为什么单独一个叶子模块
 * 记号形状（`{{brand}}` 这种双花括号）必须**只有一份**：编辑器插入用它、预览替换用它、
 * 落库时算 `slots` 也用它（`handlers/article.ts` 收的是前端算好的清单）。三处各写一个正则
 * 就是三个漂移面。它住在 `components/` 而不是组件文件里，理由与 `kb-view.ts` /
 * `site-patch-filters.ts` 相同：纯函数 + `react-refresh/only-export-components` 会点名。
 *
 * # 🔴 预览替换发生在**前端**（DR-89）
 * `bindings` 与 `kb_modules` 只是"这份模板引用了什么"的**账**，demo 不把它们拼进 prompt 发给模型
 * （AGENTS 规则 9：不在 demo 里顺手实现算法）。所以这里的替换是**给人看的预览**：
 * 让产品负责人看见"槽位换成项目真实值之后这段提示词长什么样"。
 *
 * # 🔴 取不到值的槽位**保留记号**，不替换成空串
 * 空串会让人以为"这一槽不需要绑东西"，而事实是"还没绑"。保留 `{{keyword}}` 才是诚实的显示，
 * 与 `entity-fields.ts` 用 `—` 而不是 `0` 表示空值同一条裁定。
 */
import type { ArticleDirection, ArticleSlot, Competitor, Project } from '../api/types';
import { ARTICLE_SLOT_VALUES } from '../api/types';

/** 槽位记号：`{{brand}}`。容忍花括号内侧的空格（人手写的模板常有）。 */
const SLOT_TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** 槽位 → 记号文本。🔴 记号形状全仓只有这一处定义（见文件头）。 */
export function slotToken(slot: ArticleSlot): string {
  return `{{${slot}}}`;
}

/**
 * 正文里出现过哪些槽位：去重后按 `ARTICLE_SLOT_VALUES` 的**清单序**排（与 handler 的
 * `slotsOf` 同一个顺序 ⇒ 前端算出来存进去的值，与后端收敛出来的值逐字相同）。
 * 契约外的记号（`{{nope}}`）直接忽略：它不是槽位，只是碰巧长得像。
 */
export function parseSlots(prompt: string): ArticleSlot[] {
  const found = new Set<string>();
  for (const match of prompt.matchAll(SLOT_TOKEN)) {
    if ((ARTICLE_SLOT_VALUES as readonly string[]).includes(match[1])) found.add(match[1]);
  }
  return ARTICLE_SLOT_VALUES.filter((slot) => found.has(slot));
}

/**
 * 把一个槽位记号插到**光标处**（DR-86②：chips 点击插入，不是无脑追加到末尾）。
 *
 * @param caret 光标位置；`null` / 越界一律按"末尾"处理（输入框没聚焦过时就是这种情形）。
 * @returns 新正文与插入后的光标位（调用方据此把光标放回记号之后，接着打字才顺）。
 */
export function insertSlotAtCursor(
  value: string,
  caret: number | null,
  slot: ArticleSlot,
): { value: string; caret: number } {
  const at = caret === null || caret < 0 || caret > value.length ? value.length : caret;
  const token = slotToken(slot);
  return { value: `${value.slice(0, at)}${token}${value.slice(at)}`, caret: at + token.length };
}

/** 每个槽位在预览里换成什么值；`null` = 取不到（预览保留记号）。 */
export type ArticleSlotSamples = Partial<Record<ArticleSlot, string | null>>;

/**
 * 预览用的**真实取值**（DR-86②「实时预览用项目真实值替换槽位」）。
 *
 * 🔴 每个槽位的来源是**裁定**，全仓只有这一处：
 * - `brand` → 项目品牌名（`Project.brand_name`）；
 * - `product` / `keyword` → 这份模板自己的 `bindings`（第一个值：预览要的是"长什么样"，
 *   不是把整份清单塞进一句话里）；
 * - `audience` → `bindings.audience`，没填则回落项目的行业标签（`industry_label`）；
 * - `scenario` → 所属**方向的摘要**（方向本身就是"写给谁、在什么场景下写"那一句话，DR-84）；
 * - `competitor` → 项目竞品清单的第一个（真后端接生成管线时应当按方向挑，demo 不挑，规则 9）。
 */
export function slotSampleValues(input: {
  project: Project | null;
  bindings: { product_names: string[]; keyword_texts: string[]; audience: string | null } | null;
  direction: ArticleDirection | null;
  competitors: Competitor[];
}): ArticleSlotSamples {
  const { project, bindings, direction, competitors } = input;
  const first = (values: readonly string[] | undefined) => {
    const hit = values?.find((value) => value.trim() !== '');
    return hit === undefined ? null : hit;
  };
  const audience = bindings?.audience?.trim() ?? '';
  return {
    brand: project?.brand_name.trim() === '' ? null : (project?.brand_name ?? null),
    product: first(bindings?.product_names),
    keyword: first(bindings?.keyword_texts),
    audience:
      audience === ''
        ? project?.industry_label === null || project?.industry_label === undefined
          ? null
          : project.industry_label
        : audience,
    scenario: direction?.summary.trim() === '' ? null : (direction?.summary ?? null),
    competitor: competitors[0]?.name ?? null,
  };
}

/**
 * 预览正文：把槽位记号换成真实值；**取不到值的保留记号**（见文件头）。
 * 契约外的记号原样留着（它不是槽位，替换掉等于悄悄改了用户的提示词）。
 */
export function renderPromptPreview(prompt: string, samples: ArticleSlotSamples): string {
  return prompt.replace(SLOT_TOKEN, (whole, name: string) => {
    if (!(ARTICLE_SLOT_VALUES as readonly string[]).includes(name)) return whole;
    const sample = samples[name as ArticleSlot];
    return sample === null || sample === undefined || sample === '' ? whole : sample;
  });
}

/**
 * 预览字数：**去掉全部空白**之后的字符数。
 *
 * 🔴 这是**展示层计数**，不是后端指标（`Article.word_count` 是预置静态值，规则 9）：
 * 中文按字计、英文按字母计，两者都不等于"词数"。所以词典键叫「预览字数」而不是"词数统计"，
 * 界面上也不拿它跟模板的 `length`（目标字数）做达标判断——那需要真正的分词与统计口径。
 */
export function previewWordCount(preview: string): number {
  return preview.replace(/\s/g, '').length;
}
