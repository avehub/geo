/**
 * 种子：项目 / 竞品 / 资产（demo 假后端的静态数据，简报 §B-1、§B-4）。
 *
 * # 为什么是 `.ts` 而不是计划正文写的 `.json`
 * `tsconfig.app.json` 虽然开了 `resolveJsonModule`，但 JSON 模块的类型是**推断出来的宽类型**
 * （`{ "status": "active" }` 推成 `status: string`，不是 `ProjectStatus`）⇒ 标注成
 * `Project[]` 在 `tsc -b` 就红，只能 `as unknown as Project[]` 硬转（本分支禁止未经检查的 cast）
 * 或者凭空写一套结构化校验器。用 `.ts` + 显式标注，编译期就能逐字段核对（简报 §A-3 / §B-1）。
 *
 * # 确定性（简报 §B-4，这是硬判据不是风格偏好）
 * id 与时间戳**一律是固定字面量**：不用 `Date.now()` / `new Date()` / `Math.random()` /
 * `crypto.randomUUID()`。「刷新即重置」要求每次重建得到同一份数据，测试也要能写精确断言。
 * id 是 uuid v4 的形状（仓库口径），时间戳是 RFC3339（`chrono::DateTime<Utc>` 的存库口径）。
 *
 * # 域名一律用 `example.com` 家族
 * 保留域名（RFC 2606），所以演示数据**永远不会**指向一个真实站点。品牌名、竞品名也都是虚构的。
 *
 * # 中文是**数据**，不是界面文案（简报 §B-11、AGENTS 规则 7）
 * 品牌名、别名、备注这些是「后端数据」的替身，必须真实好看，因此照实写中文；
 * 界面文案一律走词典，`src/demo/{types,db,latency,backend}.ts` 的代码生成串一律 ASCII。
 * 合规（AGENTS 规则 6）：种子里不出现绝对化用语。
 */
import type { Competitor, Project, ProjectAsset } from '../../api/types';

/** 活跃项目（实体卡与两份题库都挂在它下面）。 */
export const SEED_ACTIVE_PROJECT_ID = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';
/** 归档项目：用来走查「归档态 + 空题库」这两个空状态。 */
export const SEED_ARCHIVED_PROJECT_ID = 'b2e4d1c3-5a7f-4b22-8e4d-6c1f9a7b3d25';

export const SEED_PROJECTS: Project[] = [
  {
    id: SEED_ACTIVE_PROJECT_ID,
    name: '澜舟工业除尘设备',
    brand_name: '澜舟',
    aliases: ['澜舟除尘', '澜舟环保', '苏州澜舟'],
    website: 'https://www.lanzhou-hb.example.com',
    region: '江苏·苏州',
    language: 'zh_cn',
    industry: 'b2b_manufacturing',
    industry_label: '工业除尘设备制造',
    tags: ['工业除尘', '布袋除尘器', '环保工程'],
    status: 'active',
    archived_at: null,
    created_at: '2026-09-10T02:40:00Z',
    updated_at: '2026-09-18T11:30:00Z',
  },
  {
    id: SEED_ARCHIVED_PROJECT_ID,
    name: '云栖协作平台',
    brand_name: '云栖',
    aliases: ['云栖协作', 'Yunqi Suite'],
    website: 'https://www.yunqi-suite.example.com',
    region: '浙江·杭州',
    language: 'zh_cn',
    industry: 'enterprise_saas',
    industry_label: '企业协作 SaaS',
    tags: ['SaaS', '协作办公'],
    status: 'archived',
    archived_at: '2026-09-19T08:15:00Z',
    created_at: '2026-09-05T01:20:00Z',
    updated_at: '2026-09-19T08:15:00Z',
  },
];

export const SEED_COMPETITORS: Competitor[] = [
  {
    id: 'c3d5e2f4-6b8a-4c33-9d5e-7f1a2b4c6d38',
    project_id: SEED_ACTIVE_PROJECT_ID,
    name: '清源环保',
    aliases: ['清源环保工程'],
    website: 'https://www.qingyuan-env.example.com',
    note: '同区域老牌除尘工程公司，案例集中在水泥与冶金',
    position: 0,
    created_at: '2026-09-10T03:05:00Z',
  },
  {
    id: 'd4e6f3a5-7c9b-4d44-8e6f-8a2b3c5d7e49',
    project_id: SEED_ACTIVE_PROJECT_ID,
    name: '蓝净科技',
    aliases: ['蓝净'],
    website: 'https://www.lanjing-tech.example.com',
    note: '滤筒除尘与滤芯耗材见长',
    position: 1,
    created_at: '2026-09-10T03:06:00Z',
  },
  {
    id: 'e5f7a4b6-8d0c-4e55-9f7a-9b3c4d6e8f50',
    project_id: SEED_ACTIVE_PROJECT_ID,
    name: '恒宇环境',
    aliases: ['恒宇环境工程'],
    website: 'https://www.hengyu-env.example.com',
    note: '焊接烟尘治理方向',
    position: 2,
    created_at: '2026-09-11T07:20:00Z',
  },
  {
    id: 'f6a8b5c7-9e1d-4f66-8a8b-0c4d5e7f9a61',
    project_id: SEED_ARCHIVED_PROJECT_ID,
    name: '同舟办公',
    aliases: [],
    website: 'https://www.tongzhou-office.example.com',
    note: null,
    position: 0,
    created_at: '2026-09-05T01:35:00Z',
  },
];

/**
 * 活跃项目名下的竞品 id，**顺序即 `position`**。
 * 题库种子里的 `competitors: [0, 2]` 就是按这个数组解析成 `competitor_ids` 的
 * （简报 §B-3：行表只写下标，id 由纯函数推导）。
 */
export const SEED_ACTIVE_COMPETITOR_IDS: string[] = SEED_COMPETITORS.filter(
  (competitor) => competitor.project_id === SEED_ACTIVE_PROJECT_ID,
).map((competitor) => competitor.id);

export const SEED_ASSETS: ProjectAsset[] = [
  {
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    project_id: SEED_ACTIVE_PROJECT_ID,
    kind: 'owned_page',
    url: 'https://www.lanzhou-hb.example.com/products/bag-filter',
    title: '脉冲布袋除尘器产品页',
    note: null,
    created_at: '2026-09-12T02:00:00Z',
  },
  {
    id: '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
    project_id: SEED_ACTIVE_PROJECT_ID,
    kind: 'baike',
    url: 'https://baike.example.com/item/maichong-budai-chuchenqi',
    title: '脉冲布袋除尘器词条',
    note: '词条由市场部维护，改动需走审核',
    created_at: '2026-09-12T02:10:00Z',
  },
  {
    id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    project_id: SEED_ACTIVE_PROJECT_ID,
    kind: 'industry_media',
    url: 'https://www.huanbao-media.example.com/news/2026-08-dust-retrofit',
    title: '水泥厂除尘改造案例报道',
    note: null,
    created_at: '2026-09-13T09:45:00Z',
  },
  {
    id: '3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f70',
    project_id: SEED_ARCHIVED_PROJECT_ID,
    kind: 'owned_page',
    url: 'https://www.yunqi-suite.example.com/pricing',
    title: '价格与套餐页',
    note: null,
    created_at: '2026-09-06T05:30:00Z',
  },
];
