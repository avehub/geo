/**
 * 「从实体卡导入」的草稿组装（M1.2b · DR-81）。
 * 设计规格 `2026-10-10-kb-redesign-and-article-studio-design.md`。
 *
 * # 为什么组装在前端
 * 与 `kb-view.ts` / `kb-compose.ts` 同一条裁定：标题要查词典（`entity.fields.*`）、
 * 列表连接符是语言相关的（`common.listSeparator`）⇒ 语言相关的拼装只能在前端做一份；
 * handler 只负责落库（`kb_entry_add` 的 `source: 'imported'`）。
 *
 * # 🔴 一次性复制，不是活镜像（DR-73 / DR-81）
 * 导入产物就是普通落库条目：源头后续修改**不**跟随，Modal 里写明。
 * 状态映射继承源头可信度：实体卡 `field_status === 'official'` → `approved`，
 * 其余（`pending` / `disputed` / 项目来源）→ `pending_review`（存疑的内容不该直接可交付）。
 *
 * # 空值不进口
 * 与上一轮投影同口径：`null` / 空串 / 空数组不生成行——"没有这条知识"比"这条知识是空的"好读。
 */
import type { TFunction } from 'i18next';

import type {
  EntityCard,
  KbEntryDraft,
  KbEntryKind,
  KbModule,
  ProjectDetail,
} from '../api/types';
import { formatFieldValue } from './entity-fields';

/** 导入预览的一行（Modal 里勾选用）。 */
export interface KbImportRow {
  /** 稳定键（`<group>:<path>`，数组带下标）：勾选态用它做 id。 */
  key: string;
  group: 'entity' | 'project';
  module: KbModule;
  kind: KbEntryKind;
  title: string;
  /** 预览正文（可能多行，Modal 里 ellipsis 展示）。 */
  body: string;
  url: string | null;
  status: 'approved' | 'pending_review';
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function nonEmptyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0;
}

function statusOf(card: EntityCard | null, fieldPath: string): 'approved' | 'pending_review' {
  if (card === null) return 'pending_review';
  return card.field_status[fieldPath] === 'official' ? 'approved' : 'pending_review';
}

/** 实体卡七个字段 → 导入行（逐字清单，空值跳过）。 */
function entityRows(card: EntityCard | null, t: TFunction, sep: string): KbImportRow[] {
  if (card === null) return [];
  const fields = card.fields;
  const label = (path: string): string => t(`entity.fields.${path}`, { nsSeparator: false });
  const rows: KbImportRow[] = [];
  const push = (
    path: string,
    module: KbModule,
    kind: KbEntryKind,
    title: string,
    body: string,
    url: string | null = null,
  ): void => {
    rows.push({ key: `entity:${path}`, group: 'entity', module, kind, title, body, url, status: statusOf(card, path.split('[')[0]) });
  };

  if (nonBlank(fields.standard_name)) {
    push('standard_name', 'brand', 'statement', label('standard_name'), fields.standard_name);
  }
  if (nonEmptyList(fields.aliases)) {
    push('aliases', 'brand', 'statement', label('aliases'), fields.aliases.join(sep));
  }
  if (typeof fields.founded_year === 'number') {
    push('founded_year', 'brand', 'statement', label('founded_year'), String(fields.founded_year));
  }
  if (nonEmptyList(fields.qualifications)) {
    push('qualifications', 'qualification', 'text', label('qualifications'), fields.qualifications.join(sep));
  }
  fields.products.forEach((product, index) => {
    if (!nonBlank(product.name)) return;
    push(
      `products[${index}]`,
      'product',
      'text',
      product.name,
      formatFieldValue(product, sep),
    );
  });
  if (nonEmptyList(fields.service_regions)) {
    push('service_regions', 'audience', 'statement', label('service_regions'), fields.service_regions.join(sep));
  }
  // 🔴 空联系方式不进口：`formatFieldValue` 对"三项全空的对象"会端出一坨 JSON，
  // 所以这里先按 `Contact::is_meaningful` 的口径判一次（三项至少一项非空）。
  const contact = fields.contact;
  const meaningful =
    contact !== null &&
    [contact.phone, contact.email, contact.address].some((item) => nonBlank(item));
  if (meaningful) {
    push('contact', 'brand', 'text', label('contact'), formatFieldValue(contact, sep));
  }
  return rows;
}

/** 项目信息 → 导入行（竞品 / 渠道资产 / 行业地域标签画像）。 */
function projectRows(detail: ProjectDetail, t: TFunction, sep: string): KbImportRow[] {
  const rows: KbImportRow[] = [];
  const { project, competitors, assets } = detail;

  competitors.forEach((competitor, index) => {
    if (!nonBlank(competitor.name)) return;
    const body = [
      nonEmptyList(competitor.aliases) ? competitor.aliases.join(sep) : null,
      nonBlank(competitor.note) ? competitor.note : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    rows.push({
      key: `project:competitors[${index}]`,
      group: 'project',
      module: 'competitor',
      kind: nonBlank(competitor.website) ? 'link' : 'text',
      title: competitor.name,
      body,
      url: competitor.website,
      status: 'pending_review',
    });
  });

  assets.forEach((asset, index) => {
    if (!nonBlank(asset.url)) return;
    rows.push({
      key: `project:assets[${index}]`,
      group: 'project',
      module: 'media',
      kind: 'link',
      title: nonBlank(asset.title) ? asset.title : asset.url,
      body: nonBlank(asset.note) ? asset.note : '',
      url: asset.url,
      status: 'pending_review',
    });
  });

  const profile = [
    nonBlank(project.industry_label) ? project.industry_label : null,
    nonBlank(project.region) ? project.region : null,
    nonEmptyList(project.tags) ? project.tags.join(sep) : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  if (profile !== '') {
    rows.push({
      key: 'project:profile',
      group: 'project',
      module: 'audience',
      kind: 'statement',
      title: t('kb.import.profileTitle', { nsSeparator: false }),
      body: profile,
      url: null,
      status: 'pending_review',
    });
  }
  return rows;
}

/** 整个导入预览清单：实体卡分组在前、项目分组在后（Modal 的渲染顺序）。 */
export function buildImportRows(
  detail: ProjectDetail | null,
  t: TFunction,
  sep: string,
): KbImportRow[] {
  if (detail === null) return [];
  return [...entityRows(detail.entity_card, t, sep), ...projectRows(detail, t, sep)];
}

/** 勾选的行 → `kb_entry_add` 的草稿（`source: 'imported'`，DR-81）。 */
export function toImportDrafts(rows: readonly KbImportRow[]): KbEntryDraft[] {
  return rows.map((row) => ({
    module: row.module,
    kind: row.kind,
    title: row.title,
    body_markdown: row.body,
    url: row.url,
    tags: [],
    scenario: null,
    source: 'imported' as const,
    status: row.status,
  }));
}
