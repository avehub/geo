/**
 * 种子：实体卡 + 修订记录（简报 §B-5；字段面收窄见 spec 2026-10-01 · DR-59 … DR-61）。
 *
 * # 🔴 字段面由 11 键收窄到 **7 键**（DR-59）
 * `price_range` / `cases` / `differentiators` / `official_tone` 四个字段退出实体卡：
 * 报价并进 `products[].price`（DR-60），案例 / 卖点 / 口径迁进**知识库**的
 * `case` / `differentiator` / `tone` 三个模块（`demo/seed/kb.ts` 里那几条 `source: 'imported'`）。
 * ⚠ Rust 侧的 `ALL_FIELDS`（11）/ `REQUIRED_FIELDS`（10）**本轮一行未改** ⇒ 差异 E-58 / E-59。
 *
 * # 🔴 `completeness` 是**写死的静态值**，不是算出来的（AGENTS 规则 9）
 * 字段完整率是 `crates/geo-domain/src/entity_card.rs` 的 `EntityFields::completeness()`
 * （已填必填字段数 / `REQUIRED_FIELDS.len()`）⇒ demo **不许**自己算。
 * 这里写 `0.86`，并与数据本身自洽：**新字段面上 7 个必填字段**里刻意留空 1 个（`founded_year`），
 * 6/7 = 0.857 ⇒ 「静态值」与「真算法在**新**字段面上会得到的值」一致，界面走查时不会自相矛盾。
 * 🔴 真后端今天算的是 6/10 = 0.6（分母还是 10）⇒ 这条口径差异登记为 E-58，Plan C 改分母时收口。
 * 一致性由 `src/demo/seed.test.ts` 钉住（`founded_year === null` + `completeness >= 0.8`）。
 *
 * # `field_status` 的键 = **顶层字段名**
 * Rust 侧 `EntityCard.field_status` 的文档注释逐字写着「key 为顶层字段名（如 `products`）」，
 * 所以这里不用 `products[0].price` 这种深层路径。三种状态（官方口径 / 待确认 / 存疑）都要出现，
 * 否则 Task 12 的字段状态筛选在 demo 里走查不出东西。
 *
 * # 修订记录必须有 1 条
 * 否则 Task 12 的修订时间线在 demo 里首屏是空的（简报 §B-5）。
 * 🔴 这一条的 `field_path` 是**深层路径** `products[0].price`（价格现在住在产品里）：
 * `RevisionTimeline` 的 `fieldLabelKey` 会取根字段名查标签（显示「产品与参数」），
 * 具体改了哪个产品的哪个字段由 `note` 与新旧值本身说明。
 */
import type { EntityCard, EntityCardRevision } from '../../api/types';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

export const SEED_ENTITY_CARDS: EntityCard[] = [
  {
    project_id: SEED_ACTIVE_PROJECT_ID,
    fields: {
      standard_name: '苏州澜舟环保科技有限公司',
      aliases: ['澜舟', '澜舟除尘', '澜舟环保科技'],
      founded_year: null,
      qualifications: [
        '环保工程专业承包贰级',
        'ISO 9001 质量管理体系认证',
        '高新技术企业证书',
      ],
      products: [
        {
          name: '脉冲布袋除尘器',
          params: ['处理风量 10000~120000 m³/h', '过滤风速 0.8~1.2 m/min'],
          // DR-60：报价是**产品**的属性（一个厂家多款产品价格差一个量级，一个区间串说不清）。
          price: '单台 12 万~60 万元，按风量与工况定制',
          note: '适用于水泥、冶金行业的粉尘治理',
        },
        {
          name: '滤筒除尘器',
          params: ['处理风量 2000~20000 m³/h', '滤芯数量 4~32 支'],
          price: '单台 8 万~25 万元，按滤芯数量与工况定制',
          note: null,
        },
      ],
      service_regions: ['江苏', '浙江', '安徽', '山东'],
      contact: {
        phone: '0512-8888-0000',
        email: 'hello@lanzhou-hb.example.com',
        address: '江苏省苏州市工业园区示例路 88 号',
      },
    },
    field_status: {
      standard_name: 'official',
      aliases: 'official',
      founded_year: 'pending',
      qualifications: 'official',
      // 报价口径待市场部确认 ⇒ 整个 `products` 字段标存疑（状态挂在顶层字段上，见文件头）。
      products: 'disputed',
      service_regions: 'official',
      contact: 'official',
    },
    source: {
      crawled_pages: [
        'https://www.lanzhou-hb.example.com/about',
        'https://www.lanzhou-hb.example.com/products/bag-filter',
        'https://www.lanzhou-hb.example.com/cases',
        'https://www.lanzhou-hb.example.com/news/2026-08-qualification',
      ],
      llm_provider: 'deep_seek',
      llm_model: 'deepseek-chat',
      generated_at: '2026-09-18T10:05:00Z',
    },
    // 静态值，见本文件头注释（规则 9：demo 不算完整率）。6/7 = 0.857 ⇒ 0.86。
    completeness: 0.86,
    created_at: '2026-09-18T10:00:00Z',
    updated_at: '2026-09-18T11:20:00Z',
  },
];

export const SEED_ENTITY_CARD_REVISIONS: EntityCardRevision[] = [
  {
    id: '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7081',
    project_id: SEED_ACTIVE_PROJECT_ID,
    field_path: 'products[0].price',
    old_value: '单台 6 万~50 万元',
    new_value: '单台 12 万~60 万元，按风量与工况定制',
    status: 'disputed',
    note: '脉冲布袋除尘器的报价：官网 2026 年 8 月改版后的口径，待市场部确认',
    edited_at: '2026-09-18T11:20:00Z',
  },
];
