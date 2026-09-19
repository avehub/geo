/**
 * 「这句错误文案能不能端给用户」的判据（Plan A Task 7b · 裁定 B-1）。
 *
 * 这份判定**同时**被生产码与门禁用，这是它单独成文件的唯一理由：
 *
 * - `src/api/errors.ts` 在词典渲染完成后过一遍，不合格就 `console.warn` 后回落
 *   `common.unknownError`（B-1③）；
 * - `src/i18n/dictionary.test.ts` 拿它当渲染面的门禁判据（B-5 / B-1②）。
 *
 * 共用同一个函数，两份判定就不可能漂移——Task 7 的教训正是「门禁判据只活在测试里」：
 * 门禁绿，而界面照样能把 `不存在（ID：）` 端给用户。反过来也**不许**把测试文件里的
 * 判据 import 进生产码（B-1③ 明令），所以判据住在这里，两边都往下依赖它。
 *
 * 返回**问题清单**而不是布尔值：门禁失败时能把原因直接打进断言消息，
 * 生产码则把它塞进 `console.warn` 供排障。空数组 = 合格。
 */

/** 需要检查的括号/引号对。`（ID：）` 这类空洞在 zh 用全角、en 用半角，两边都要认。 */
const BRACKETS: ReadonlyArray<readonly [open: string, close: string]> = [
  ['（', '）'],
  ['(', ')'],
  ['【', '】'],
  ['[', ']'],
  ['「', '」'],
];

/**
 * 渲染结果里「信息字符」（字母 + 数字，含 CJK）的下限。
 *
 * 阈值是**实测**出来的，不是拍的：`dictionary.test.ts` 那四轮共 272 次合格渲染中，
 * 信息字符最少的是 **7**（zh `品牌名不能为空`）；而复审 §A-2 数出的真空洞 zh `链接` 只有 2。
 * 取 5 ⇒ 空洞被抓、272 条合格渲染一条不误伤（实测 `PROBE_NEW_CRITERIA_FALSE_POSITIVES=0`）。
 *
 * **更正**（Task 7b 第 4 个 commit · 报告 §9.3 / N-3）：这里原先写的是 **6**（zh `链接不能为空`），
 * 那是本轮**第 1 个** commit 时的实测值；**第 2 个** commit 的 F-2g 把 zh `crawler/invalid_url`
 * 的模板从 `链接{{reason}}` 改成 `链接{{reason}}：{{url}}`，那条渲染随之变长，
 * 272 次合格渲染里的最短值因此升到 7。阈值 5 未变，余量比原先记的更宽（2 → 3）。
 *
 * 改这个常量前请先跑那四轮，`每条 code 用「契约声明的全部 params」渲染` 那条用例
 * 会把「最短合格渲染」与本常量对账。
 */
export const MIN_INFO_CHARS = 5;

/** 信息字符数：去掉标点、空白、括号之后还剩多少字母/数字。 */
function infoChars(text: string): number {
  return text.replace(/[^\p{L}\p{N}]/gu, '').length;
}

/**
 * 找出第一个「空洞括号」：括号里只剩空白、只剩一个标签（尾部悬着 `：`/`:`），
 * 或者占位符被填空后在括号内留下了内边距（`(command )`）。
 *
 * 为什么不用「括号里只有 ASCII 字母」这种更宽的写法：实测它会误伤
 * `（custom）`（`llm/config` 的 provider id，是该显示的数据），
 * 复审 M-1 建议的 `/[（(]\s*[A-Za-z]*\s*[：:]?\s*[）)]/` 正是这个形态，
 * 在 272 次合格渲染上有 2 处假阳性。
 */
function hollowBracket(text: string): string | null {
  for (const [open, close] of BRACKETS) {
    let cursor = text.indexOf(open);
    while (cursor !== -1) {
      const end = text.indexOf(close, cursor + open.length);
      if (end === -1) break;
      const raw = text.slice(cursor + open.length, end);
      const inner = raw.trim();
      if (inner === '' || inner !== raw || /[：:]$/.test(inner)) return `${open}${raw}${close}`;
      cursor = text.indexOf(open, end + close.length);
    }
  }
  return null;
}

/** B-5 / B-1 的「干净输出」判据：返回问题清单，空数组即合格。 */
export function problemsOf(text: string): string[] {
  const problems: string[] = [];
  if (text === '') problems.push('渲染成空串');
  if (text.includes('{{') || text.includes('}}')) problems.push('残留 {{…}} 占位符');
  if (/\bundefined\b/.test(text)) problems.push('字面 undefined');
  if (/\bnull\b/.test(text)) problems.push('字面 null');
  if (text.includes('  ')) problems.push('连续两个空格');
  if (text !== text.trim()) problems.push('首尾空白');
  if (/[，、；：,;:（(【[]$/.test(text)) problems.push('结尾悬空标点');
  if (text.includes('（）') || text.includes('()') || text.includes('（ ）')) problems.push('空括号');

  const hollow = hollowBracket(text);
  if (hollow !== null) problems.push(`HOLLOW_BRACKETS（括号里只剩标签或空白：${hollow}）`);
  if (infoChars(text) < MIN_INFO_CHARS) problems.push(`TOO_SHORT（信息字符少于 ${MIN_INFO_CHARS} 个）`);

  return problems;
}
