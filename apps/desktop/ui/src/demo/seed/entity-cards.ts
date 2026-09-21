/**
 * 种子：实体卡 + 修订记录（简报 §B-5）。
 *
 * # 🔴 `completeness` 是**写死的静态值**，不是算出来的（AGENTS 规则 9）
 * 字段完整率是 `crates/geo-domain/src/entity_card.rs` 的 `EntityFields::completeness()`
 * （已填必填字段数 / `REQUIRED_FIELDS.len()`，分母是 10）⇒ demo **不许**自己算。
 * 这里写 `0.9`，并与数据本身自洽：10 个必填字段里刻意留空 1 个（`founded_year`），
 * 于是「静态值」与「真算法会得到的值」一致，界面走查时不会自相矛盾。
 * 一致性由 `src/demo/seed.test.ts` 钉住（`founded_year === null` + `completeness >= 0.8`）。
 *
 * # `field_status` 的键 = **顶层字段名**
 * Rust 侧 `EntityCard.field_status` 的文档注释逐字写着「key 为顶层字段名（如 `products`）」，
 * 所以这里不用 `products[0].name` 这种深层路径。三种状态（官方口径 / 待确认 / 存疑）都要出现，
 * 否则 Task 12 的字段状态筛选在 demo 里走查不出东西。
 *
 * # 修订记录必须有 1 条
 * 否则 Task 12 的修订时间线在 demo 里首屏是空的（简报 §B-5）。
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
          note: '适用于水泥、冶金行业的粉尘治理',
        },
        {
          name: '滤筒除尘器',
          params: ['处理风量 2000~20000 m³/h', '滤芯数量 4~32 支'],
          note: null,
        },
      ],
      price_range: '单台 8 万~60 万元，按风量与工况定制',
      service_regions: ['江苏', '浙江', '安徽', '山东'],
      cases: ['某水泥集团 3 条窑线除尘改造', '某汽车零部件厂焊接烟尘治理'],
      differentiators: ['自有滤料生产线，交付周期 30 天内', '提供第三方检测报告与现场验收支持'],
      official_tone: '以工程数据与交付案例为主，避免绝对化表述',
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
      products: 'official',
      price_range: 'disputed',
      service_regions: 'official',
      cases: 'pending',
      differentiators: 'pending',
      official_tone: 'disputed',
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
    // 静态值，见本文件头注释（规则 9：demo 不算完整率）。
    completeness: 0.9,
    created_at: '2026-09-18T10:00:00Z',
    updated_at: '2026-09-18T11:20:00Z',
  },
];

export const SEED_ENTITY_CARD_REVISIONS: EntityCardRevision[] = [
  {
    id: '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7081',
    project_id: SEED_ACTIVE_PROJECT_ID,
    field_path: 'price_range',
    old_value: '单台 6 万~50 万元',
    new_value: '单台 8 万~60 万元，按风量与工况定制',
    status: 'disputed',
    note: '官网 2026 年 8 月改版后的口径，待市场部确认',
    edited_at: '2026-09-18T11:20:00Z',
  },
];
