import type { TFunction } from 'i18next';

/**
 * 枚举 id → 展示标签（Task 9b §B-4）。
 *
 * 全仓**只有这一份**：意图 / 来源 / 行业 / 字段状态 / 样本量告警五个枚举族共用，
 * 不许在各组件里各抄一份，也不许塞进 `src/api/errors.ts`（那是错误渲染的 4 级阶梯，
 * 语义不同）。机制逐字照 `components/ProviderSelect.tsx` 的 `providerLabel`。
 *
 * **查不到时回退 id 本身，绝不回退中文标签**：回退中文等于把泄漏面原地留着，而且会把
 * 「词典漏了一个 id」从**显眼的机器记号**变成**静默的中文串**。
 *
 * `nsSeparator: false` 必须带（与 `src/api/errors.ts` 的 `LOOKUP_OPTIONS` 同理）：key 是从
 * 数据拼出来的，i18next 默认的 `:` 分隔符会把带冒号的 key 切成两半，未命中时返回的是
 * **冒号后面那半截**，于是 `rendered !== key` 这个 miss 判据当场失效。
 *
 * ⚠ 动态键对 `i18n/no-hardcoded-strings.test.ts` 结构性不可见（它只匹配字面量单参 `t('…')`，
 * 且明令不许为了抓动态键去改它的匹配机制）⇒「词典漏了某个 id」只有
 * `src/i18n/enum-label.test.tsx` 的五段式哨兵抓得到。
 *
 * 本文件是 `.ts`，不会被 Tailwind oxide 扫到（`src/index.css` 的常驻警告：工具类写在 `.ts`
 * 里静默失效），所以**不要往里放 class 名**。
 *
 * @param values 插值变量（`prompt.sampleSize.warnings.*` 用）。参数名**不许叫 `count`**：
 *   i18next 见到 `count` 会走复数分支去找 `key_one` / `key_other`，本词典没有这两条 ⇒ 静默回落。
 */
export function enumLabel(
  t: TFunction,
  keyPrefix: string,
  id: string,
  values?: Record<string, string>,
): string {
  const key = `${keyPrefix}.${id}`;
  const rendered: unknown = t(key, { nsSeparator: false, ...values });
  return typeof rendered === 'string' && rendered !== '' && rendered !== key ? rendered : id;
}
