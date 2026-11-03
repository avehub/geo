/**
 * 知识库的**导出文本**组装（M1.2，spec `2026-10-01-entity-card-slim-and-knowledge-base-design.md` DR-72）。
 *
 * 与 `library-compose.ts` / `report-compose.ts` 同族：导出物在**前端**组装（标题与节名是界面文案，
 * 必须走词典，AGENTS 规则 7），落盘走既有的 `export_write_file`（🔴 不新增导出命令）。
 *
 * # 两个产物
 * - **Markdown 知识册**：给内容团队 / 代运营直接读，也是喂给撰稿模型最省事的形态；
 * - **JSON 知识包**：机器可读，带 `origin` / `field_path` / `verified_at` 这些**溯源**字段，
 *   供 Prompt 与内容生成当上下文注入（WordLift / Scrunch 的"给 AI 一份澄清过的事实"同族）。
 *
 * # 🔴 闸门：只有**可交付**的行才进产物（DR-72，M1.2b 后只剩一道）
 * 只收 `status === 'approved'`（待审 = AI 生成还没人看过，规则 6）。
 * 零条可用时返回 `null`，界面据此置灰按钮并说明原因（照 FAQ 的 `exportDisabled` 先例），
 * 不导出一份空壳。
 *
 * # 🔴 行来自 `components/kb-view.ts`，不在这里第二次组装
 * 界面上看到的正文与导出文件里的正文因此**不可能不一致**（同 `report-compose.ts` 复用
 * `components/format.ts` 的那条理由）。
 */
import type { TFunction } from 'i18next';

import type { KbRow } from '../components/kb-view';
import { groupByModule } from '../components/kb-view';
import type { KbModule } from './types';

/** 文件名一律 ASCII（下载属性里出现中文会被部分浏览器丢掉，`library-compose.ts` 同一条纪律）。 */
export function kbMarkdownFileName(projectId: string): string {
  return `geo-knowledge-${projectId}.md`;
}

/** JSON 知识包的文件名。 */
export function kbJsonFileName(projectId: string): string {
  return `geo-knowledge-${projectId}.json`;
}

/** 这一行能不能进交付物（见文件头那道闸门）。 */
export function isExportable(row: KbRow): boolean {
  return row.status === 'approved';
}

/** 过完闸门的行；零条时调用方要置灰按钮。 */
export function exportableRows(rows: readonly KbRow[]): KbRow[] {
  return rows.filter(isExportable);
}

function moduleLabel(t: TFunction, module: KbModule): string {
  const key = `kb.modules.${module}`;
  const rendered = t(key, { nsSeparator: false });
  return rendered === key ? module : rendered;
}

function kindLabel(t: TFunction, row: KbRow): string {
  const key = `kb.kinds.${row.kind}`;
  const rendered = t(key, { nsSeparator: false });
  return rendered === key ? row.kind : rendered;
}

/** 一行知识的 Markdown：`statement` 走引用块（它就是要被整段引用的那一句），媒体类走链接。 */
function markdownRow(t: TFunction, row: KbRow): string {
  const lines: string[] = [`### ${row.title}`, `_${kindLabel(t, row)}_`];
  if (row.body.trim() !== '') {
    lines.push(row.kind === 'statement' ? quoteBlock(row.body) : row.body);
  }
  if (row.url !== null && row.url.trim() !== '') {
    lines.push(row.kind === 'link' ? `<${row.url}>` : `[${row.title}](${row.url})`);
  }
  if (row.tags.length > 0) lines.push(row.tags.map((tag) => `\`${tag}\``).join(' '));
  return lines.join('\n\n');
}

function quoteBlock(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Markdown 知识册。零条可交付时返回 `null`（界面置灰按钮并说明原因）。 */
export function composeKbMarkdown(
  rows: readonly KbRow[],
  t: TFunction,
  title: string,
  note: string,
): string | null {
  const kept = exportableRows(rows);
  if (kept.length === 0) return null;
  const parts: string[] = [`# ${title}`, `_${note}_`];
  for (const group of groupByModule(kept)) {
    parts.push(`## ${moduleLabel(t, group.module)}`);
    for (const row of group.rows) parts.push(markdownRow(t, row));
  }
  return `${parts.join('\n\n')}\n`;
}

/** JSON 知识包里一个模块的形状。 */
export interface KbJsonModule {
  id: string;
  label: string;
  items: KbJsonItem[];
}

/**
 * JSON 知识包里一条知识的形状（带溯源字段，供模型上下文与人工核校）。
 * 🔴 同步块退役（DR-73）后溯源字段只剩 `source` / `scenario` / `verified_at`。
 */
export interface KbJsonItem {
  id: string;
  kind: KbRow['kind'];
  title: string;
  body: string;
  url: string | null;
  mime: string | null;
  tags: string[];
  status: KbRow['status'];
  source: KbRow['source'];
  scenario: KbRow['scenario'];
  verified_at: KbRow['verifiedAt'];
}

/** JSON 知识包的顶层形状。 */
export interface KbJsonPack {
  schema: 'geo.knowledge_pack/v1';
  project_id: string;
  modules: KbJsonModule[];
}

/** JSON 知识包。零条可交付时返回 `null`。 */
export function composeKbJson(rows: readonly KbRow[], t: TFunction, projectId: string): string | null {
  const kept = exportableRows(rows);
  if (kept.length === 0) return null;
  const pack: KbJsonPack = {
    schema: 'geo.knowledge_pack/v1',
    project_id: projectId,
    modules: groupByModule(kept).map((group) => ({
      id: group.module,
      label: moduleLabel(t, group.module),
      items: group.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        url: row.url,
        mime: row.mime,
        tags: row.tags,
        status: row.status,
        source: row.source,
        scenario: row.scenario,
        verified_at: row.verifiedAt,
      })),
    })),
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}
