/**
 * 「AI 生成」两个弹窗的**默认档**（M1.5 素材层，spec DR-42）。
 *
 * # 为什么不写在弹窗里
 * `react-refresh/only-export-components` 不许组件文件再导出别的形状（`eslint --max-warnings 0`
 * 下是硬红），所以默认档必须另找一处住。放这里是照 `wizard-steps.ts` / `format.ts` 的既有先例：
 * `components/` 下的**非组件数据模块**，被组件与测试同时引用。
 *
 * # 🔴 为什么测试要引它，而不是各抄一份
 * 「默认档在预置语料池里挑得出几条」是**默认档与种子数据的联合性质**：
 * - `demo/seed.test.ts` 用它算出"默认一次生成 6 条"，把池子的覆盖面钉住；
 * - 两个页面测试里那个 6 因此是**算出来的**，不是抄来的——改了池子或改了默认档，
 *   红的那条会直接指向数据，而不是指向一个对不上的行数。
 * 两边各写一份类型/意图清单，就会静默漂移（同 `i18n/enum-label-prefixes.test.ts` 拦的那个缺陷类）。
 */
import type { FaqGenerateOptions, KeywordGenerateOptions } from '../api/types';

/**
 * 关键词默认勾「核心词 + 长尾词」、要 8 条：需求原文点名的就是"关键词、长尾词"这两类。
 * 池子里这两类一共 6 行 ⇒ 默认一次实际生成 6 条（handler 取 `min(target_count, 命中数)`）。
 */
export const DEFAULT_KEYWORD_GENERATE_OPTIONS: KeywordGenerateOptions = {
  kinds: ['core', 'long_tail'],
  target_count: 8,
};

/**
 * FAQ 默认勾「采购推荐 + 售后口碑 + 专业长尾」、要 6 条：这三类是官网 FAQ 版块最常覆盖的问法。
 * 池子里这三类正好 6 行 ⇒ 默认一次生成 6 条。
 */
export const DEFAULT_FAQ_GENERATE_OPTIONS: FaqGenerateOptions = {
  intents: ['purchase_recommendation', 'after_sales_reputation', 'professional_long_tail'],
  target_count: 6,
};
