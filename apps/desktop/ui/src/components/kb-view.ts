/**
 * 知识库的**界面行**模型（M1.2b）。
 * 设计规格 `2026-10-10-kb-redesign-and-article-studio-design.md` DR-73 … DR-78。
 *
 * # 与上一轮的差异
 * 同步块退役（DR-73）后这里**不再有投影组装**（`composeSyncedRow` / `findSyncedBlock` 删除）：
 * 界面行与落库行一一对应，`toKbRows` 只做字段改名（snake → camel）与分组所需的排序键。
 * 语言相关的标签一律**不在这里拼**：组件查词典（`enumLabel`），本文件保持语言中立，
 * 导出物（`api/kb-compose.ts`）复用同一份行模型 ⇒ 界面与文件不可能各说一套。
 */
import type {
  ContentStatus,
  KbEntry,
  KbEntryKind,
  KbModule,
  KbScenario,
  KbSource,
} from '../api/types';
import { KB_MODULE_VALUES, KB_SCENARIO_VALUES, KB_SCRIPT_MODULES } from '../api/types';

/** 界面与导出共用的一行知识。 */
export interface KbRow {
  id: string;
  module: KbModule;
  kind: KbEntryKind;
  /** 话术场景（DR-75）；非话术模块恒 `null`。 */
  scenario: KbScenario | null;
  title: string;
  body: string;
  url: string | null;
  mime: string | null;
  tags: string[];
  status: ContentStatus;
  source: KbSource;
  verifiedAt: string | null;
  updatedAt: string;
  position: number;
}

/** 多媒体三档（画廊格渲染与统计共用）。 */
const MEDIA_KINDS: readonly KbEntryKind[] = ['image', 'video', 'file'];

export function isMediaKind(kind: KbEntryKind): boolean {
  return MEDIA_KINDS.includes(kind);
}

/** 话术两模块（DR-75）：分组视图里按场景出子标题。 */
export function isScriptModule(module: KbModule): boolean {
  return KB_SCRIPT_MODULES.includes(module);
}

/** 落库条目 → 界面行（`position ASC` 由调用方保证，这里保持传入顺序）。 */
export function toKbRows(entries: readonly KbEntry[]): KbRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    module: entry.module,
    kind: entry.kind,
    scenario: entry.scenario,
    title: entry.title,
    body: entry.body_markdown,
    url: entry.url,
    mime: entry.mime,
    tags: [...entry.tags],
    status: entry.status,
    source: entry.source,
    verifiedAt: entry.verified_at,
    updatedAt: entry.updated_at,
    position: entry.position,
  }));
}

/** 一个模块分组（`KB_MODULE_VALUES` 的序，空模块不回）。 */
export interface KbModuleGroup {
  module: KbModule;
  rows: KbRow[];
}

/** 合成整份列表的分组：**模块序**（`KB_MODULE_VALUES`）→ 组内 `position ASC`。 */
export function groupByModule(rows: readonly KbRow[]): KbModuleGroup[] {
  return KB_MODULE_VALUES.map((module) => ({
    module,
    rows: rows
      .filter((row) => row.module === module)
      .slice()
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
  })).filter((group) => group.rows.length > 0);
}

/** 一个场景分组（`KB_SCENARIO_VALUES` 的序；`scenario === null` 的行进 `null` 桶垫底）。 */
export interface KbScenarioGroup {
  scenario: KbScenario | null;
  rows: KbRow[];
}

/** 话术模块内部的二级分组（DR-78：Highspot / Seismic 的 playbook 分段同族）。 */
export function groupByScenario(rows: readonly KbRow[]): KbScenarioGroup[] {
  const groups: KbScenarioGroup[] = KB_SCENARIO_VALUES.map((scenario) => ({
    scenario,
    rows: rows.filter((row) => row.scenario === scenario),
  })).filter((group) => group.rows.length > 0);
  const loose = rows.filter((row) => row.scenario === null);
  if (loose.length > 0) groups.push({ scenario: null, rows: loose });
  return groups;
}
