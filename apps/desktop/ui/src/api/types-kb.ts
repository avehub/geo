/**
 * 知识库（M1.2b 重构）的对象模型。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`
 * （DR-73 … DR-82）。
 *
 * # 🔴 与上一轮（2026-10-01）的最大差异：同步块退役（DR-73）
 * `KbSyncedBlock` / `KbOrigin` / `KbEntry.origin*` / `field_path` 全部删除：
 * 用户指示"不需要实体卡相同的内容模块卡片"，实体卡与项目字段的**活现镜像**因此整体退役，
 * 取而代之的是**一次性显式导入**（DR-81：`KbEntryDraft.source === 'imported'`）。
 * 知识库从此只装**落库的知识**：人工录入 / AI 生成 / 导入副本，一个知识只出现一次。
 *
 * # 模块是固定枚举（续 DR-63 → DR-74）
 * 11 个模块覆盖"关于我的一切可复用表达"：事实陈述、卖点、**销售话术 / 客服话术**、
 * 案例、竞品对照、人群、口径合规、资质、素材。话术两个模块带**场景**维度（DR-75）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { ContentStatus, FieldStatus } from './types';

/** 知识模块（11 档，DR-74）。键名 == 词典 `kb.modules.*`。 */
export type KbModule =
  | 'brand'
  | 'product'
  | 'selling_point'
  | 'sales_script'
  | 'support_script'
  | 'case'
  | 'competitor'
  | 'audience'
  | 'tone'
  | 'qualification'
  | 'media';

export const KB_MODULE_VALUES = [
  'brand',
  'product',
  'selling_point',
  'sales_script',
  'support_script',
  'case',
  'competitor',
  'audience',
  'tone',
  'qualification',
  'media',
] as const satisfies readonly KbModule[];

/** 带场景维度的两个话术模块（DR-75）；其余模块的 `scenario` 恒 `null`（handler 强制）。 */
export const KB_SCRIPT_MODULES: readonly KbModule[] = ['sales_script', 'support_script'];

/**
 * 话术场景（10 档，DR-75）：销售六段 + 客服四段。
 * 借鉴 Highspot / Seismic 的 playbook 按阶段分组、Intercom 宏按主题分组（survey §2）。
 */
export type KbScenario =
  | 'sales_first_contact'
  | 'sales_needs'
  | 'sales_objection'
  | 'sales_quote'
  | 'sales_closing'
  | 'sales_followup'
  | 'support_presale'
  | 'support_aftersale'
  | 'support_complaint'
  | 'support_return';

export const KB_SCENARIO_VALUES = [
  'sales_first_contact',
  'sales_needs',
  'sales_objection',
  'sales_quote',
  'sales_closing',
  'sales_followup',
  'support_presale',
  'support_aftersale',
  'support_complaint',
  'support_return',
] as const satisfies readonly KbScenario[];

/**
 * 素材形式（6 档，续 DR-64）。
 *
 * 🔴 `statement` 与 `text` 刻意分开：`statement` 是**一句可以被 AI 回答整段引用的定义句 / 主张**，
 * 也是话术卡的主要形式（引文体 + 一键复制，DR-78 / DR-79）；`text` 是 Markdown 长文（三行折叠）。
 */
export type KbEntryKind = 'statement' | 'text' | 'link' | 'image' | 'video' | 'file';

export const KB_ENTRY_KIND_VALUES = [
  'statement',
  'text',
  'link',
  'image',
  'video',
  'file',
] as const satisfies readonly KbEntryKind[];

/**
 * 知识来源（3 档，DR-73 后 `synced` / `detached` 退役）。
 *
 * 🔴 `imported` = 从实体卡 / 项目信息**一次性复制**进来的（DR-81）：它不是活镜像，
 * 源头后续修改**不**跟随，界面上写明。
 */
export type KbSource = 'manual' | 'generated' | 'imported';

export const KB_SOURCE_VALUES = ['manual', 'generated', 'imported'] as const satisfies readonly KbSource[];

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 一条知识条目（知识库现在**只有**落库的这一种行）。 */
export interface KbEntry {
  id: string;
  project_id: string;
  module: KbModule;
  kind: KbEntryKind;
  /** 条目标题（一屏内可读，Guru 的"一个事实一张卡"）。 */
  title: string;
  /**
   * 正文（Markdown 原文）。🔴 demo 不做 Markdown → HTML 渲染（与 FAQ 答案同族取舍）；
   * 媒体类条目这里装的是**说明 / 图注**。
   */
  body_markdown: string;
  /** `link` / `image` / `video` / `file` 四类的地址；纯文本条目为 `null`。 */
  url: string | null;
  /** 媒体类型提示（`image/jpeg` / `video/mp4` / `application/pdf`）；🔴 demo 里是字面量。 */
  mime: string | null;
  /** 自由文本标签（**数据**，不是枚举 ⇒ 不进词典）。 */
  tags: string[];
  /** 审核态：AI 生成默认 `pending_review`，人工录入默认 `approved`。 */
  status: ContentStatus;
  source: KbSource;
  /** 话术场景（DR-75）；非话术模块恒 `null`（handler 强制，不报错）。 */
  scenario: KbScenario | null;
  /** Guru 式核实时间；`null` = 从未核实（界面显示「未核实」而不是空）。 */
  verified_at: string | null;
  /** 0 基，照 `keyword_item` / `prompt_item` 的 `position` 口径。 */
  position: number;
  created_at: string;
  updated_at: string;
}

/** `kb_board` 的返回：一次拿全，界面不再发第二条命令（照 `action_board` / `collection_board`）。 */
export interface KbBoard {
  project_id: string;
  /** 落库条目：`position ASC, id ASC`。 */
  entries: KbEntry[];
  stats: KbStats;
  project_updated_at: string;
  /**
   * 全项目的条目修订留痕，**新的在前**（`edited_at DESC`，口径同 `entity_card_revisions`）。
   *
   * 🔴 这是 DR-119 的**寄生读出口**：留痕跟着 board 一次拿回来，**命令面不加**
   * （不新增 `kb_entry_revisions`）。理由与 DR-118 的 `self_index_summary` 同族——
   * 界面本来就要为这一页发 `kb_board`，多一条命令只会多一次往返与一份缓存失效清单；
   * 界面按 `entry_id` 自己筛出当前编辑那条的历史（编辑侧滑的「修订历史」页签）。
   *
   * ⚠ 删掉一条知识**不会**删掉它的留痕（`kb_entry_delete` 本身也不留痕）：
   * 台账是"改过什么"的账，不是条目的附属物；界面上看不见的 `entry_id` 就没人去筛它。
   */
  revisions: KbEntryRevision[];
}

/**
 * 展示用计数（DR-80，6 个）。🔴 这些是**数数**，不是领域算法（AGENTS 规则 9 允许）：
 * 真后端将来若要算"知识覆盖率 / 可信度评分"，那是 `geo-domain` 的纯函数，demo 不许自己实现。
 */
export interface KbStats {
  /** 有内容（至少一条条目）的模块数。 */
  modules: number;
  entries: number;
  /** 话术条目数（`sales_script` + `support_script`）。 */
  scripts: number;
  /** 待人工审核的条目数（`status === 'pending_review'`）。 */
  pending_review: number;
  /** 从未核实的条目数（`verified_at === null`）。 */
  unverified: number;
  /** 多媒体条目数（`image` / `video` / `file`）。 */
  media: number;
}

/**
 * 录入 / 导入一条知识的入参。
 *
 * 🔴 `source` 只接受 `'imported'` 这一个覆盖值（DR-81），其余一律落 `manual`：
 * 前端自称 `generated` 不算数（照 `keyword_add`）。
 * 🔴 `status` 只在 `source === 'imported'` 时被尊重（且只认 `approved` / `pending_review`）：
 * 导入副本要继承源头字段的可信状态（实体卡 `official` → `approved`，其余 → `pending_review`）；
 * 人工录入恒 `approved`、AI 生成恒 `pending_review`（规则 6）。
 */
export interface KbEntryDraft {
  module: KbModule;
  kind: KbEntryKind;
  title: string;
  body_markdown?: string;
  url?: string | null;
  mime?: string | null;
  tags?: string[];
  scenario?: KbScenario | null;
  source?: 'imported';
  status?: 'approved' | 'pending_review';
}

/** `kb_generate` 的入参。 */
export interface KbGenerateOptions {
  /** 要在哪几个模块里生成；空数组 ⇒ `validation/failed`。 */
  modules: KbModule[];
  /** 期望条数，夹在 `LIBRARY_GENERATE_MIN..MAX`（复用素材库那一档，不新造常量）。 */
  target_count: number;
}

/**
 * 一条知识条目的**字段级修订留痕**（DR-119，2026-10-13 产品负责人第四轮指示：
 * 知识库要像品牌实体卡一样有修订历史）。
 *
 * # 🔴 与 `EntityCardRevision`（`api/types.ts:315`）**六键同构**
 * `field_path` / `old_value` / `new_value` / `status` / `note` / `edited_at` 六键**同名同型**，
 * 所以 `components/RevisionTimeline.tsx` 能靠一个结构子集（`RevisionLike`）同时吃两种留痕
 * ——**不新造第二个时间线组件**（两个组件必然漂移，一个组件 + 两个字段标签 resolver 才不会）。
 * 差别只有两处，都是归属面的：
 * ① 多一个 `entry_id`（实体卡是"项目级单卡"，知识库是"一项目多条"）；
 * ② 字段标签表不同（KB 查 `kb.fields.*`，实体卡查 `entity.fields.*`）。
 *
 * # 🔴 `status` 是 `FieldStatus` 而不是 `ContentStatus`
 * 留痕上的状态喂给 `FieldStatusTag`（绿=官方 / 橙=待确认 / 红=存疑），与实体卡同一个组件。
 * 条目的审核态（`KbEntry.status`）由 handler **投影**过来：`approved → official`、
 * `pending_review → pending`、`rejected → disputed`（投影表在 `demo/handlers/kb.ts`）。
 *
 * # 🔴 `body_markdown` 的新旧值**截断到 120 字符**再留痕
 * 全文进留痕会把时间线变成文档副本；"改没改、改了多少"由截断串 + `note` 已经回答。
 * 上限常量 `KB_REVISION_BODY_LIMIT` 在 handler 侧（demo 的呈现口径，不进契约）。
 */
export interface KbEntryRevision {
  id: string;
  /** 归属的知识条目（`KbEntry.id`）。 */
  entry_id: string;
  project_id: string;
  /** 改的是哪个字段；键名 == `KB_FIELDS` 的 `path`（`kb.fields.*` 的键名后缀）。 */
  field_path: string;
  old_value: unknown | null;
  new_value: unknown | null;
  status: FieldStatus;
  note: string | null;
  edited_at: string;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type KbModuleValuesComplete = AssertComplete<
  ValuesAreComplete<KbModule, typeof KB_MODULE_VALUES>
>;
export type KbScenarioValuesComplete = AssertComplete<
  ValuesAreComplete<KbScenario, typeof KB_SCENARIO_VALUES>
>;
export type KbEntryKindValuesComplete = AssertComplete<
  ValuesAreComplete<KbEntryKind, typeof KB_ENTRY_KIND_VALUES>
>;
export type KbSourceValuesComplete = AssertComplete<
  ValuesAreComplete<KbSource, typeof KB_SOURCE_VALUES>
>;
