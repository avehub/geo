/**
 * M7 报告与分享的 1 条命令（`report_render`）的内存实现。
 *
 * # 🔴 demo 只**组装**、不生成
 * 报告的叙述段、数字、表格行全部预置在 `seed/reports.ts`（数字与 `seed/diagnosis.ts` 逐一对齐，
 * 判据在 `demo/seed.test.ts`）。这条命令做的是三件纯搬运：
 * ① 按 `variant` 挑节（老板版只要结论，执行版全给，白标版去掉漏斗与核查明细）；
 * ② 按 `include_evidence` 追加一节证据附录；③ 按 `white_label` 决定署名信息。
 * **不调 LLM、不算指标、不排版**（AGENTS 规则 9）。
 *
 * # 标题与表头不在种子里
 * 报告标题、节标题、指标名、表头、免责声明都是**界面文案**，必须走词典（AGENTS 规则 7）⇒
 * 种子只给稳定记号 + 数据。前端把两者拼成预览，也拼成 Markdown / HTML / CSV 导出文本
 * （`src/api/report-compose.ts`），导出文件因此随界面语言走。
 *
 * # 🔴 demo 产不出 PDF / PNG / DOCX
 * 这三种要原生渲染或文档库，纯前端 demo 不引（`DESKTOP_ONLY_EXPORT_FORMATS`）。
 * 界面上按钮照旧渲染但置灰并说明"桌面端提供"。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb, roundById } from '../db';
import type {
  ReportBlock,
  ReportDocument,
  ReportSection,
  ReportVariant,
  WhiteLabelProfile,
} from '../../api/types';
import { REPORT_VARIANT_VALUES } from '../../api/types';
import { EVIDENCE_COLUMN_KEYS, SEED_REPORTS, SEED_VARIANT_SECTIONS, SEED_WHITE_LABEL } from '../seed/reports';
import { asBoolean, asRecord, asString, nowIso, requireProject } from './shared';

/** 证据附录那一节的稳定 id（词典 `report.sections.evidence`）。 */
export const EVIDENCE_SECTION_ID = 'evidence';

/**
 * 报告版本：契约外的值**不回落**（悄悄出一份别的版本比报错更糟），发 `validation/failed`。
 * 这是 M3–M7 里唯一一处不做收敛的枚举入参，理由见上。
 */
function requireVariant(value: unknown): ReportVariant {
  const variants = REPORT_VARIANT_VALUES as readonly string[];
  const variant = asString(value);
  if (!variants.includes(variant)) {
    throw demoError('validation/failed', {
      field: 'variant',
      reason: 'invalid_format',
      value: variant,
    });
  }
  return variant as ReportVariant;
}

/** 白标信息：调用方给了就用给的（报告页可现场改），没给则白标版回落到种子默认、其余版本为 null。 */
function whiteLabelOf(raw: unknown, variant: ReportVariant): WhiteLabelProfile | null {
  if (raw === undefined || raw === null) {
    return variant === 'white_label' ? structuredClone(SEED_WHITE_LABEL) : null;
  }
  const profile = asRecord(raw);
  return {
    agency_name: asString(profile.agency_name).trim(),
    contact: asString(profile.contact).trim(),
    logo_url: typeof profile.logo_url === 'string' && profile.logo_url !== '' ? profile.logo_url : null,
  };
}

/**
 * `report_render`：按版本渲染一份可直接预览 / 导出的报告。
 *
 * 进行中的轮次（第 4 轮）在种子里刻意**没有**报告——采集没跑完就出结论是造假。
 * 界面因此把 `queued` / `running` / `failed` 的轮次在报告页置灰（词典 `report.roundUnavailable`），
 * 这里的 `validation/failed` 只是防御性的兜底。
 */
export const reportRender: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  const project = requireProject(db, projectId);

  const roundId = asString(args.round_id);
  const round = roundById(db, roundId);
  if (!round || round.project_id !== projectId) {
    throw demoError('validation/failed', { field: 'round_id', reason: 'invalid_id', value: roundId });
  }

  const payload = SEED_REPORTS[roundId];
  if (!payload) {
    throw demoError('validation/failed', {
      field: 'round_id',
      reason: 'invalid_format',
      value: roundId,
    });
  }

  const options = asRecord(args.options);
  const variant = requireVariant(options.variant);
  const includeEvidence = asBoolean(options.include_evidence);

  // 没有数据的节**整节省略**，而不是渲染一个空标题：报告是要发给老板与客户的，
  // 一个空的「竞品对标」看起来像"这一项是 0"，比不出现更糟。小样本的通道验证轮只预置了
  // 「结论」一节（它连竞品矩阵都没有），于是三个版本在那一轮都只剩结论 + 关键数字 + 下一步。
  const sections: ReportSection[] = SEED_VARIANT_SECTIONS[variant]
    .filter((id) => (payload.sections[id]?.length ?? 0) > 0)
    .map((id) => ({
      id,
      blocks: structuredClone(payload.sections[id]) as ReportBlock[],
    }));
  if (includeEvidence) {
    sections.push({
      id: EVIDENCE_SECTION_ID,
      blocks: [
        {
          kind: 'table',
          column_keys: [...EVIDENCE_COLUMN_KEYS],
          rows: structuredClone(payload.evidence_rows),
        },
      ],
    });
  }

  const document: ReportDocument = {
    project_id: project.id,
    round_id: round.id,
    variant,
    // 品牌名是数据（实体卡 / 项目上的那个），标题由前端按 `report.title.<variant>` 组合。
    brand_name: project.brand_name,
    round_label: round.label,
    generated_at: nowIso(),
    headline: structuredClone(payload.headline),
    next_steps: structuredClone(payload.next_steps),
    sections,
    methodology: structuredClone(payload.methodology),
    white_label: whiteLabelOf(options.white_label, variant),
  };
  return document;
};
