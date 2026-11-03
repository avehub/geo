/**
 * 知识库条目**修订留痕**的写路径零件（DR-119，照品牌实体卡 `entity_card_update_field` 的姿态）。
 *
 * # 为什么单独一个文件
 * `handlers/kb.ts` 加上留痕那半会越过 400 行软线（AGENTS「代码风格」），所以照
 * `site.ts` / `site-patch.ts` 与 `article.ts` / `article-schedule.ts` 的同款拆分：
 * 6 条命令的编派留在 `kb.ts`，"怎么把一次改动变成几条留痕"落在这里。
 * 🔴 依赖方向单向：`kb.ts` → 本文件；本文件只 import `api/types` 与 `./shared`。
 *
 * # 口径三条（DR-119）
 * ① **逐字段**：`kb_entry_update` 改两个字段就记两条，`old_value` / `new_value` 并排；
 *    没改的字段一条都不记（留痕只回答"谁把哪个字段从什么改成了什么"）；
 * ② **`body_markdown` 截断到 120 字符**再留痕（🔴 库里的正文不截断，截断只是呈现口径）；
 * ③ **`add` / `delete` / `generate` 不留痕**：创建与删除不是"修订"，生成物的待审状态由
 *    `status: 'pending_review'` 表达（与差异台账 E-66 同族）。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本文件非注释 CJK 必须为 0 ⇒ `field_path` 与状态投影表全是 ASCII；中文只出现在 `seed/kb.ts`。
 */
import type { ContentStatus, FieldStatus, KbEntry, KbEntryRevision } from '../../api/types';
import { newId } from './shared';

/**
 * `body_markdown` 进留痕前的截断上限（DR-119 写死 120 字符）。
 *
 * 🔴 只截**留痕里的副本**：`db.kbEntries` 里存的仍是全文——改一次正文就丢内容是不可接受的。
 * 全文进留痕会把时间线变成文档副本，而"改没改、改了多少"由截断串 + `note` 已经回答。
 * ⚠ `demo/seed/kb.ts` 的截断样例用的是同一个数（那边刻意不 import 本常量：
 * handler → seed 才是正向依赖，反过来就是环）。改上限要两处一起改。
 */
export const KB_REVISION_BODY_LIMIT = 120;

/**
 * 会被逐字段比对的 **9** 个可改字段（`kb_entry_update` 真正写回库里的那些）。
 *
 * 🔴 `project_id` / `position` / `created_at` / `source` / `verified_at` / `id` **不在表里**：
 * 前五个前端改不动（一律取库里那份）⇒ 永远比不出差异；`verified_at` 的留痕由
 * `kb_entry_verify` 自己记（见下面的 `verifyRevision`），不该被编辑接口顺手带出来
 * ——否则"改个错别字"就能伪造一次核实。
 */
const TRACKED_FIELDS: readonly (keyof KbEntry & string)[] = [
  'module',
  'kind',
  'title',
  'body_markdown',
  'url',
  'mime',
  'tags',
  'status',
  'scenario',
];

/**
 * 条目审核态 → 留痕上的可信态（`KbEntryRevision.status` 是 `FieldStatus`，六键同构的要求）。
 *
 * 留痕由 `components/RevisionTimeline.tsx` + `FieldStatusTag` 渲染（绿=官方 / 橙=待确认 / 红=存疑），
 * 与实体卡**共用同一个组件** ⇒ 这里做一次投影，而不是把 `ContentStatus` 直接塞进 `status` 键
 * （塞进去界面上会渲染出一个查不到标签的裸记号）。
 */
const FIELD_STATUS_OF: Record<ContentStatus, FieldStatus> = {
  approved: 'official',
  pending_review: 'pending',
  rejected: 'disputed',
};

/** 两个字段值等不等（`tags` 是数组 ⇒ 走 JSON 形状比较，顺序不同就算改过）。 */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** `body_markdown` 的新旧值截断到 `KB_REVISION_BODY_LIMIT`；其余字段原样。 */
function clipped(fieldPath: string, value: unknown): unknown {
  if (fieldPath !== 'body_markdown' || typeof value !== 'string') return value;
  return value.length > KB_REVISION_BODY_LIMIT ? value.slice(0, KB_REVISION_BODY_LIMIT) : value;
}

/**
 * 造一条留痕。
 *
 * 🔴 `note` 在 demo 里恒 `null`：`kb_entry_update` 的入参没有备注位（**契约不动**，
 * 命令面不加东西是 DR-119 的硬要求）。键仍然保留，因为 `RevisionLike` 六键同构要求它在。
 */
function build(
  entry: KbEntry,
  fieldPath: string,
  oldValue: unknown,
  newValue: unknown,
  status: FieldStatus,
  stamp: string,
): KbEntryRevision {
  return {
    id: newId(),
    entry_id: entry.id,
    project_id: entry.project_id,
    field_path: fieldPath,
    old_value: oldValue,
    new_value: newValue,
    status,
    note: null,
    edited_at: stamp,
  };
}

/**
 * 逐字段比对"改之前 / 改之后"，只给**真的变了**的字段各记一条（DR-119 的靶心：
 * 变异验证 ⑨ 就是"把这里改成整卡一条 ⇒ 判据必须红"）。
 *
 * @param status 取**改完之后**的审核态：一条留痕回答的是"这次改动之后，这个字段值可不可信"。
 */
export function diffKbRevisions(
  before: KbEntry,
  after: KbEntry,
  stamp: string,
): KbEntryRevision[] {
  const status = FIELD_STATUS_OF[after.status];
  const rows: KbEntryRevision[] = [];
  for (const fieldPath of TRACKED_FIELDS) {
    const oldValue = before[fieldPath] ?? null;
    const newValue = after[fieldPath] ?? null;
    if (sameValue(oldValue, newValue)) continue;
    rows.push(
      build(
        before,
        fieldPath,
        clipped(fieldPath, oldValue),
        clipped(fieldPath, newValue),
        status,
        stamp,
      ),
    );
  }
  return rows;
}

/**
 * `kb_entry_verify` 的那一条：`field_path` 恒 `'verified_at'`，旧值是上一次的核实时间
 * （第一次核实就是 `null`），新值是这次的时间戳，状态恒 `official`（核实即 `approved`）。
 *
 * 🔴 核实**只记这一条**：它顺带把 `status` 翻成 `approved`，但那是核实的**结果**不是被改的字段，
 * 再记一条 `status` 会让"核实一次"在时间线上变成两行噪音。
 */
export function verifyRevision(
  entry: KbEntry,
  previousVerifiedAt: string | null,
  stamp: string,
): KbEntryRevision {
  return build(entry, 'verified_at', previousVerifiedAt, stamp, FIELD_STATUS_OF.approved, stamp);
}
