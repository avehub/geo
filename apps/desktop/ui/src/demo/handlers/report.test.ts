/**
 * M7 `report_render` 的行为测试。
 *
 * # 分工
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`。
 * - **args 键名漂移** ⇒ 由 `pages/ReportPage` 的测试经 `api/report.ts` 覆盖。
 * - **种子自洽**（报告里的数字与 `seed/diagnosis.ts` 逐一对齐）⇒ `demo/seed.test.ts`。
 * - 本文件管**行为**：按版本挑节、省略空节、追加证据附录、白标署名的回落。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 9）
 * ① 只**组装**、不生成：叙述段 / 数字 / 表格行全部逐字取自 `seed/reports.ts`；
 * ② **没有数据的节整节省略**，不渲染空标题（一个空的「竞品对标」看起来像"这一项是 0"）；
 * ③ `variant` 是 M3–M7 里唯一**不做收敛**的枚举入参：悄悄出一份别的版本比报错更糟；
 * ④ 标题、节标题、表头都不在返回值里——它们是界面文案，由前端查词典拼（规则 7）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ReportDocument, ReportSection } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_PROJECTS } from '../seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../seed/collection-rounds';
import {
  EVIDENCE_COLUMN_KEYS,
  SEED_REPORTS,
  SEED_VARIANT_SECTIONS,
  SEED_WHITE_LABEL,
} from '../seed/reports';
import { EVIDENCE_SECTION_ID } from './report';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function errorCode(cause: unknown): string | null {
  return isIpcErrorPayload(cause) ? cause.code : null;
}

function errorParams(cause: unknown): unknown {
  return isIpcErrorPayload(cause) ? cause.params : null;
}

async function render(
  roundId: string,
  options: Record<string, unknown>,
  projectId: string = SEED_ACTIVE_PROJECT_ID,
): Promise<ReportDocument> {
  return demoInvoke<ReportDocument>('report_render', {
    project_id: projectId,
    round_id: roundId,
    options,
  });
}

function sectionIds(document: ReportDocument): string[] {
  return document.sections.map((section: ReportSection) => section.id);
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/report · report_render（按版本挑节）', () => {
  it('老板版只要结论；执行版全给；白标版去掉漏斗与核查明细', async () => {
    const executive = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'executive',
      include_evidence: false,
    });
    const detailed = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'detailed',
      include_evidence: false,
    });
    const whiteLabel = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'white_label',
      include_evidence: false,
    });

    expect(sectionIds(executive)).toEqual(SEED_VARIANT_SECTIONS.executive);
    expect(sectionIds(detailed)).toEqual(SEED_VARIANT_SECTIONS.detailed);
    expect(sectionIds(whiteLabel)).toEqual(SEED_VARIANT_SECTIONS.white_label);
    expect(SEED_VARIANT_SECTIONS.detailed).toHaveLength(7);
    expect(SEED_VARIANT_SECTIONS.white_label).not.toContain('funnel');
    expect(SEED_VARIANT_SECTIONS.white_label).not.toContain('fact_check');
  });

  it('🔴 没有数据的节整节省略：小样本的通道验证轮三个版本都只剩结论', async () => {
    for (const variant of ['executive', 'detailed', 'white_label'] as const) {
      const document = await render(SEED_TRIAL_ROUND_ID, { variant, include_evidence: false });
      expect(sectionIds(document)).toEqual(['conclusion']);
    }
    // 对照：第 3 轮执行版是满的（同一份代码，差别只在种子有没有那一节的数据）。
    const retest = await render(SEED_RETEST_ROUND_ID, {
      variant: 'detailed',
      include_evidence: false,
    });
    expect(sectionIds(retest)).toEqual(SEED_VARIANT_SECTIONS.detailed);
  });

  it('节内容逐字来自种子（demo 只搬运，不重写、不重算）', async () => {
    const document = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'detailed',
      include_evidence: false,
    });
    const payload = SEED_REPORTS[SEED_BASELINE_ROUND_ID];

    expect(document.headline).toEqual(payload.headline);
    expect(document.next_steps).toEqual(payload.next_steps);
    expect(document.methodology).toEqual(payload.methodology);
    for (const section of document.sections) {
      expect(section.blocks).toEqual(payload.sections[section.id]);
    }
  });

  it('品牌名与轮次名取自项目与轮次（不是报告种子），标题留给前端按词典拼', async () => {
    const document = await render(SEED_RETEST_ROUND_ID, {
      variant: 'executive',
      include_evidence: false,
    });
    const project = SEED_PROJECTS.find((entry) => entry.id === SEED_ACTIVE_PROJECT_ID);
    const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === SEED_RETEST_ROUND_ID);

    expect(document.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(document.round_id).toBe(SEED_RETEST_ROUND_ID);
    expect(document.brand_name).toBe(project?.brand_name);
    expect(document.round_label).toBe(round?.label);
    expect(document.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 🔴 返回值里没有任何界面文案字段（标题 / 节标题 / 表头都由前端查词典）。
    expect(Object.keys(document).sort()).toEqual([
      'brand_name',
      'generated_at',
      'headline',
      'methodology',
      'next_steps',
      'project_id',
      'round_id',
      'round_label',
      'sections',
      'variant',
      'white_label',
    ]);
  });
});

describe('demo/handlers/report · include_evidence（证据附录）', () => {
  it('勾上就在末尾追加一节表格，列口径与行都来自种子', async () => {
    const withEvidence = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'detailed',
      include_evidence: true,
    });
    const payload = SEED_REPORTS[SEED_BASELINE_ROUND_ID];

    expect(sectionIds(withEvidence)).toEqual([
      ...SEED_VARIANT_SECTIONS.detailed,
      EVIDENCE_SECTION_ID,
    ]);
    const appendix = withEvidence.sections.at(-1);
    expect(appendix?.blocks).toHaveLength(1);
    const block = appendix?.blocks[0];
    expect(block?.kind).toBe('table');
    expect(block && 'column_keys' in block ? block.column_keys : null).toEqual([
      ...EVIDENCE_COLUMN_KEYS,
    ]);
    expect(block && 'rows' in block ? block.rows : null).toEqual(payload.evidence_rows);
  });

  it('不勾就没有附录；勾与不勾的其余节完全一致', async () => {
    const without = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'detailed',
      include_evidence: false,
    });
    const withEvidence = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'detailed',
      include_evidence: true,
    });

    expect(sectionIds(without)).not.toContain(EVIDENCE_SECTION_ID);
    expect(withEvidence.sections.slice(0, -1)).toEqual(without.sections);
  });

  it('缺省即不追加（`asBoolean` 只认字面 true）', async () => {
    const document = await render(SEED_BASELINE_ROUND_ID, { variant: 'executive' });

    expect(sectionIds(document)).toEqual(SEED_VARIANT_SECTIONS.executive);
  });
});

describe('demo/handlers/report · white_label（署名信息）', () => {
  it('白标版没给资料就回落种子默认；其余版本没给就是 null', async () => {
    const whiteLabel = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'white_label',
      include_evidence: false,
    });
    expect(whiteLabel.white_label).toEqual(SEED_WHITE_LABEL);

    for (const variant of ['executive', 'detailed'] as const) {
      const document = await render(SEED_BASELINE_ROUND_ID, { variant, include_evidence: false });
      expect(document.white_label).toBeNull();
    }
  });

  it('现场改过的资料就用改过的（值 trim；空 logo_url 收成 null）', async () => {
    const document = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'white_label',
      include_evidence: false,
      white_label: {
        agency_name: '  Suzhou Sample Agency  ',
        contact: ' geo@example-agency.example.com ',
        logo_url: '',
      },
    });

    expect(document.white_label).toEqual({
      agency_name: 'Suzhou Sample Agency',
      contact: 'geo@example-agency.example.com',
      logo_url: null,
    });
  });

  it('非白标版本显式给了资料也会带上（调用方给了就用给的，不按版本抹掉）', async () => {
    const document = await render(SEED_BASELINE_ROUND_ID, {
      variant: 'executive',
      include_evidence: false,
      white_label: { agency_name: 'Suzhou Sample Agency', contact: 'geo@example.com', logo_url: null },
    });

    expect(document.variant).toBe('executive');
    expect(document.white_label?.agency_name).toBe('Suzhou Sample Agency');
  });
});

describe('demo/handlers/report · 入参校验', () => {
  it('🔴 variant 契约外**不回落**：发 validation/failed + field=variant（唯一不做收敛的枚举）', async () => {
    const cause = await capture(() =>
      render(SEED_BASELINE_ROUND_ID, { variant: 'marketing', include_evidence: false }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'variant',
      reason: 'invalid_format',
      value: 'marketing',
    });
  });

  it('options 整个缺省 ⇒ 同样发 variant 的 validation/failed（不默认出一份老板版）', async () => {
    const cause = await capture(() =>
      demoInvoke('report_render', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        round_id: SEED_BASELINE_ROUND_ID,
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'variant',
      reason: 'invalid_format',
      value: '',
    });
  });

  it('进行中的第 4 轮没有报告：轮次存在但拿不出结论 ⇒ field=round_id + invalid_format', async () => {
    const cause = await capture(() =>
      render(SEED_LIVE_ROUND_ID, { variant: 'detailed', include_evidence: false }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'round_id',
      reason: 'invalid_format',
      value: SEED_LIVE_ROUND_ID,
    });
  });

  it('轮次 id 认不出 ⇒ invalid_id；轮次属于别的项目同样按认不出处理', async () => {
    const unknown = await capture(() =>
      render('nope', { variant: 'detailed', include_evidence: false }),
    );
    expect(errorCode(unknown)).toBe('validation/failed');
    expect(errorParams(unknown)).toEqual({
      field: 'round_id',
      reason: 'invalid_id',
      value: 'nope',
    });

    // 越权：轮次真存在，但挂在演示项目下，用归档项目的 id 来取 ⇒ 同一支错误。
    const crossProject = await capture(() =>
      render(
        SEED_BASELINE_ROUND_ID,
        { variant: 'detailed', include_evidence: false },
        SEED_ARCHIVED_PROJECT_ID,
      ),
    );
    expect(errorCode(crossProject)).toBe('validation/failed');
    expect(errorParams(crossProject)).toEqual({
      field: 'round_id',
      reason: 'invalid_id',
      value: SEED_BASELINE_ROUND_ID,
    });
  });

  it('项目 id 认不出 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      render(SEED_BASELINE_ROUND_ID, { variant: 'detailed' }, 'nope'),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});
