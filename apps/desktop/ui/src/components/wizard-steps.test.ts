/**
 * 手动录入的字段集与实体卡**对齐**（Plan B Task 7 · 裁定 3）。
 *
 * # 🔴 为什么判据不是「向导字段集覆盖实体卡字段集」
 * 计划正文写的是「`WIZARD_ALL_FIELDS` 覆盖 `ENTITY_FIELD_KEYS`（所有带 `ai_extracted`/`confirmed`
 * 状态的字段键）」。这两个前提在本仓库都不成立：
 * ① 字段状态只有 `official` / `pending` / `disputed` 三种
 *    （真值源 `crates/geo-domain/src/entity_card.rs:49-54`），没有 `ai_extracted`；
 * ② 向导收的是 **`ProjectDraft`** 的 13 个键（品牌名、竞品、行业、标签…），实体卡是
 *    **`EntityFields`** 的 11 个字段（成立年份、资质、价格区间…），两套键名本来就不同源，
 *    真后端靠 `fields_from_draft`（`entity_card.rs:508-540`）把前者的一部分推成后者。
 * 所以「录入信息数据和页面可以根据自动采集流程」的可执行判据是下面这三条：
 * - **A** 向导字段集 == `ProjectDraft` 的键集（少一个键就建不出合法的草稿）；
 * - **B** 草稿 → 实体卡的映射表逐条落在真实的 `ENTITY_FIELDS` 上，且**恰好**等于真后端
 *   `fields_from_draft` 推得出的那 6 个字段（多写一个 = 界面承诺了后端给不了的东西）；
 * - **C** 「草稿推得出的 6 个」+「只能靠抓取/抽取补齐的 5 个」== 实体卡全部 11 个字段
 *   ⇒ 两条入口最终落在**同一张卡**上，没有一个字段两边都够不着。
 * 反向判据（计划里那句「向导里没有实体卡不认的字段」）由 **D** 承担：每个向导字段要么进映射表、
 * 要么在 `PROJECT_ONLY_FIELDS` 里被点名（竞品、行业、标签这些是**项目级**资料，本来就不进实体卡），
 * 冒出第三个来历不明的字段就红。
 */
import { describe, expect, it } from 'vitest';

import { ENTITY_FIELDS } from './entity-fields';
import {
  DRAFT_TO_ENTITY_FIELDS,
  PROJECT_ONLY_FIELDS,
  WIZARD_ALL_FIELDS,
  WIZARD_STEP_FIELDS,
} from './wizard-steps';
import { toProjectDraft } from '../store/wizard-draft';

/**
 * 真后端 `fields_from_draft`（`crates/geo-domain/src/entity_card.rs:508-540`）从建项草稿
 * 推得出的实体卡字段。**逐字钉死**——它是判据 C 的对照面，不是从被测代码算出来的，
 * 否则「映射表 == 映射表的值域」就是永真式。改这张表必须同时改 Rust 真值源。
 *
 * 🔴 本轮少了 `official_tone`：它已退出实体卡、迁进知识库的 `tone` 模块（spec 2026-10-01 · DR-59），
 * 而 Rust 的 `fields_from_draft` 还在推它 ⇒ 差异 E-58（Plan C 收口时两边一起改）。
 */
const ENTITY_FIELDS_FROM_DRAFT = [
  'aliases',
  'contact',
  'products',
  'service_regions',
  'standard_name',
];

/**
 * 只能由抓取 + 模型抽取补齐的 **2** 个字段（`fields_from_draft` 不填它们，建项后一律 `pending`）。
 * 这 2 个正是「自动采集」这条入口存在的理由：手动录入不逼用户填，抽取完之后在实体卡里逐字段确认。
 *
 * 🔴 本轮由 5 个减到 2 个：`cases` / `differentiators` 迁进知识库、`price_range` 并进
 * `products[].price`（spec 2026-10-01 · DR-59 / DR-60）⇒ 它们不再是实体卡字段。
 */
const ENTITY_FIELDS_FROM_EXTRACTION_ONLY = [
  'founded_year',
  'qualifications',
];

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

describe('wizard-steps · 两条建项入口落在同一张实体卡上（裁定 3）', () => {
  it('A · WIZARD_ALL_FIELDS 是 5 步展平去重的结果，且与 ProjectDraft 的键集逐字相等', () => {
    expect(WIZARD_ALL_FIELDS).toEqual(sortedUnique(WIZARD_STEP_FIELDS.flat()));
    // `toProjectDraft({})` 的键集就是草稿契约本身（真值源 `api/types.ts` 的 `ProjectDraft`）。
    expect(WIZARD_ALL_FIELDS).toEqual(sortedUnique(Object.keys(toProjectDraft({}))));
    // 防空跑：判据 A 对空数组也成立的话就没有意义了。
    expect(WIZARD_ALL_FIELDS.length).toBeGreaterThanOrEqual(13);
  });

  it('B · 映射表的每一头都真实存在：草稿键在向导里，实体卡键在 ENTITY_FIELDS 里', () => {
    const entityPaths = ENTITY_FIELDS.map((field) => field.path);
    expect(Object.keys(DRAFT_TO_ENTITY_FIELDS).length).toBeGreaterThanOrEqual(6);
    for (const [draftField, targets] of Object.entries(DRAFT_TO_ENTITY_FIELDS)) {
      expect(WIZARD_ALL_FIELDS, `${draftField} 不是向导字段`).toContain(draftField);
      expect(targets.length, `${draftField} 映射到空`).toBeGreaterThanOrEqual(1);
      for (const target of targets) {
        expect(entityPaths, `${target} 不是实体卡字段`).toContain(target);
      }
    }
  });

  it('C · 草稿推得出的 + 只能抽取的 == 实体卡全部字段（没有一个字段两条入口都够不着）', () => {
    const fromDraft = sortedUnique(Object.values(DRAFT_TO_ENTITY_FIELDS).flat());
    expect(fromDraft, '映射表的值域漂了 ⇒ 与 Rust `fields_from_draft` 不一致').toEqual(
      ENTITY_FIELDS_FROM_DRAFT,
    );
    expect(sortedUnique([...ENTITY_FIELDS_FROM_DRAFT, ...ENTITY_FIELDS_FROM_EXTRACTION_ONLY])).toEqual(
      sortedUnique(ENTITY_FIELDS.map((field) => field.path)),
    );
    // 两张清单不许重叠：一个字段既"手动录入能给"又"只能抽取"是自相矛盾的。
    expect(
      ENTITY_FIELDS_FROM_DRAFT.filter((field) => ENTITY_FIELDS_FROM_EXTRACTION_ONLY.includes(field)),
    ).toEqual([]);
  });

  it('D · 反向：每个向导字段要么进映射表，要么被 PROJECT_ONLY_FIELDS 点名（项目级资料）', () => {
    const accounted = sortedUnique([
      ...Object.keys(DRAFT_TO_ENTITY_FIELDS),
      ...PROJECT_ONLY_FIELDS,
    ]);
    expect(accounted, '有向导字段来历不明 ⇒ 手动录入与自动采集的口径对不上').toEqual(
      WIZARD_ALL_FIELDS,
    );
    // 项目级字段本身不许出现在映射表里（它们不进实体卡）。
    expect(
      PROJECT_ONLY_FIELDS.filter((field) => field in DRAFT_TO_ENTITY_FIELDS),
    ).toEqual([]);
  });
});
