/**
 * 种子：站点接入与补丁工作台（M6.5 落地层）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`（spec §10）。
 *
 * # 🔴 三张静态表 + 两张有写路径的表
 * - `SEED_SITE_PAGES`（页面清单）与 `SEED_SITE_CHANNEL_PROBES`（自检结论）**只读**：
 *   handler 直接 `structuredClone` 端出去，不进内存库（与 `SEED_ATTRIBUTION_CARDS` 同族取舍）。
 *   🔴 页面清单不是爬出来的、自检不联网（AGENTS 规则 9 / 规则 2，spec DR-56②③）；
 * - `SEED_SITE_PROFILE` / `SEED_SITE_CHANNELS` / `SEED_SITE_PATCHES`（+ 事件）**进库**：
 *   它们各自都有写路径（保存档案、配置通道、生成/编辑/发布补丁）。
 *
 * # 与 M6 处方、M5 归因的咬合（`demo/seed.test.ts` 逐条钉住）
 * - 每条补丁的 `action_id` 都指向 `seed/actions.ts` 里**存在**的处方；
 * - 处方 `done` ⇒ 名下至少一条补丁 `published`，且 `published_at` **逐字等于**处方的
 *   `completed_at`（"做完这件事"与"这处改动上线"是同一刻）；
 * - 处方 `todo` ⇒ 名下补丁只能是 `draft`（还没开始的事不该有线上改动）；
 * - `source_layout` 两类处方（`demo-act-005` / `demo-act-006`）**既没有初始补丁、也不在生成池里**
 *   ⇒ 界面上那个按钮置灰，理由是"这条落在站外平台"（spec DR-46 / 产品定义 §3.12 ❌）。
 *
 * # 合规（AGENTS 规则 6）
 * 补丁正文与交接单里不出现"保证排名 / 霸屏 / 第一 / 最"一类绝对化表述；资质等级照
 * `demo-act-007` 的口径写"贰级"（种子里那条事实纠错处方纠正的正是"壹级"这个错法）。
 */
import type {
  CheckDetail,
  SiteChannel,
  SiteChannelKind,
  SiteChannelStatus,
  SitePage,
  SitePatch,
  SitePatchEvent,
  SiteProfile,
} from '../../api/types';
import type { SitePatchSeedRow } from '../types';
import { SEED_BASELINE_ROUND_ID } from './collection-rounds';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

/** 站点根域名（与 `SEED_PROJECTS[0].website` 逐字一致，`seed.test.ts` 钉住）。 */
export const SEED_SITE_DOMAIN = 'https://www.lanzhou-hb.example.com';

export const SEED_SITE_PROFILE: SiteProfile = {
  id: 'demo-site-profile-001',
  project_id: SEED_ACTIVE_PROJECT_ID,
  domain: SEED_SITE_DOMAIN,
  platform: 'custom',
  ownership: 'agency',
  note: '服务器与模板由外包代管，客户手里只有 CMS 后台账号；改根目录文件（llms.txt / robots.txt）需要提工单给外包，通常 1~2 个工作日。',
  created_at: '2026-09-12T02:00:00Z',
  updated_at: '2026-09-26T02:20:00Z',
};

/**
 * 受管页面清单（静态）。URL 与 `seed/projects.ts` 的 `SEED_ASSETS`（`owned_page`）同域同路径口径。
 * 🔴 `crawlable` 是**预置判断**，不是真探测结果：界面上有常驻说明（`site.staticNote`）。
 */
export const SEED_SITE_PAGES: SitePage[] = [
  {
    id: 'demo-site-page-001', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/`, role: 'home', title: '澜舟官网首页',
    last_checked_at: '2026-09-26T01:00:00Z', crawlable: true,
  },
  {
    id: 'demo-site-page-002', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/products/bag-filter`, role: 'product',
    title: '脉冲布袋除尘器产品页', last_checked_at: '2026-09-26T01:00:00Z', crawlable: true,
  },
  {
    id: 'demo-site-page-003', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/qualification`, role: 'qualification',
    title: '企业资质与荣誉证书页', last_checked_at: '2026-09-26T01:00:00Z', crawlable: true,
  },
  {
    id: 'demo-site-page-004', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/service`, role: 'service', title: '售后服务与备件承诺页',
    last_checked_at: '2026-09-26T01:00:00Z', crawlable: false,
  },
  {
    id: 'demo-site-page-005', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/about`, role: 'about', title: '关于澜舟',
    last_checked_at: '2026-09-26T01:00:00Z', crawlable: true,
  },
  {
    id: 'demo-site-page-006', project_id: SEED_ACTIVE_PROJECT_ID,
    url: `${SEED_SITE_DOMAIN}/news/dust-retrofit-case`, role: 'news',
    title: '水泥厂除尘改造案例报道', last_checked_at: null, crawlable: true,
  },
];

export const SEED_SITE_CHANNELS: SiteChannel[] = [
  {
    id: 'demo-site-channel-bundle', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'bundle',
    status: 'ready', endpoint: null, username: null,
    note: '默认通道：把补丁渲染成可上传的文件与交接单，交给站长或外包执行。',
    credentials_state: 'not_required', secret_ref: null,
    checked_at: '2026-09-26T01:10:00Z',
    check_detail: { code: 'site_bundle_verified', params: { date: '2026-09-25' } },
    updated_at: '2026-09-26T01:10:00Z',
  },
  {
    id: 'demo-site-channel-edge', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'edge',
    status: 'pending_verify', endpoint: 'https://www.lanzhou-hb.example.com/*', username: null,
    note: '客户站点在腾讯云 EdgeOne 上；边缘函数已生成，等外包把函数贴进控制台。',
    credentials_state: 'missing',
    secret_ref: `keyring://site/edge/${SEED_ACTIVE_PROJECT_ID}`,
    checked_at: '2026-09-26T01:12:00Z',
    check_detail: { code: 'site_edge_not_deployed', params: { status: '404' } },
    updated_at: '2026-09-26T01:12:00Z',
  },
  {
    id: 'demo-site-channel-cms', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'cms',
    status: 'not_configured', endpoint: null, username: null,
    note: null, credentials_state: 'missing',
    secret_ref: `keyring://site/cms/${SEED_ACTIVE_PROJECT_ID}`,
    checked_at: null, check_detail: null, updated_at: '2026-09-12T02:00:00Z',
  },
  {
    id: 'demo-site-channel-repo', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'repo',
    status: 'not_configured', endpoint: null, username: null,
    note: null, credentials_state: 'not_required', secret_ref: null,
    checked_at: null, check_detail: null, updated_at: '2026-09-12T02:00:00Z',
  },
];

/**
 * `site_channel_test` 的**预置结论**（🔴 不联网，规则 2 / 规则 9）。
 * 按 kind 取一份：真后端要真发一次探测（HEAD 请求 / REST 认证 / Worker 拉取），
 * demo 只把"探测完会长什么样"端出来，界面上明写这一点。
 */
export const SEED_SITE_CHANNEL_PROBES: Record<
  SiteChannelKind,
  { status: SiteChannelStatus; check_detail: CheckDetail }
> = {
  bundle: {
    status: 'ready',
    check_detail: { code: 'site_bundle_ready', params: {} },
  },
  cms: {
    status: 'failed',
    check_detail: { code: 'site_cms_not_configured', params: {} },
  },
  edge: {
    status: 'pending_verify',
    check_detail: { code: 'site_edge_not_deployed', params: { status: '404' } },
  },
  repo: {
    status: 'not_configured',
    check_detail: { code: 'site_repo_not_configured', params: {} },
  },
};

/**
 * 初始补丁台账的**字面量行**（8 条）。导出的是下面那份 `SEED_SITE_PATCHES`。
 *
 * 🔴 三态都要看得见：`published` 6 条、`unpublished` 1 条（发布后被外包的模板改动覆盖，
 * 撤回了）、`draft` 1 条。
 * 🔴 **已完成的处方名下必须至少有一条已发布的补丁，且 `published_at` 逐字等于处方的
 * `completed_at`**（`seed.test.ts` 钉住）：M6 说"这件事做完了"、M6.5 说"这处改动上线了"，
 * 两个时间对不上就是产品负责人一眼能看出的自相矛盾。
 * 🔴 这里的 `published_body` 一律写 `null`，由下面那一步补齐：把几百字的 HTML / JSON-LD
 * 正文**抄两遍**必然漂移（改了一处忘了另一处，回滚就会把补丁滚回一个旧版本），
 * 所以行里只声明"发布之后没再改过"，快照由不变式派生。
 */
const SITE_PATCH_ROWS: SitePatch[] = [
  {
    id: 'demo-site-patch-001', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-001', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'html_fragment',
    title: '产品页首屏补一段可被直接引用的定义句与参数表',
    target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
    target_hint: '产品页首屏标题之下、"产品特点"之上；参数表用真表格（不要用图片）。',
    body: [
      '<section id="definition" aria-labelledby="definition-title">',
      '  <h2 id="definition-title">什么是脉冲布袋除尘器</h2>',
      '  <p>脉冲布袋除尘器是以压缩空气脉冲清灰的袋式除尘设备，含尘气体经滤袋过滤后排出，',
      '粉尘被脉冲气流反向吹落进灰斗。澜舟的整机处理风量覆盖 3,000~120,000 m³/h，',
      '适用于水泥、钢铁、木工与化工车间的粉尘治理。</p>',
      '  <table>',
      '    <caption>脉冲布袋除尘器主要参数</caption>',
      '    <thead><tr><th>项目</th><th>范围</th><th>说明</th></tr></thead>',
      '    <tbody>',
      '      <tr><td>处理风量</td><td>3,000~120,000 m³/h</td><td>按滤袋数量与袋长组合</td></tr>',
      '      <tr><td>过滤风速</td><td>0.8~1.2 m/min</td><td>常规工况取值，高浓度工况下调</td></tr>',
      '      <tr><td>出口排放</td><td>≤10 mg/m³</td><td>配覆膜滤料时的实测区间</td></tr>',
      '      <tr><td>清灰方式</td><td>在线 / 离线脉冲</td><td>离线清灰适合高浓度工况</td></tr>',
      '    </tbody>',
      '  </table>',
      '  <p class="doc-meta">更新时间：<time datetime="2026-09-19">2026-09-19</time> · 供稿：澜舟技术部</p>',
      '</section>',
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'generated', position: 0,
    published_at: '2026-09-19T08:00:00Z',
    created_at: '2026-09-17T02:00:00Z', updated_at: '2026-09-19T08:00:00Z',
  },
  {
    id: 'demo-site-patch-002', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-001', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'meta_description',
    title: '产品页描述改成"参数 + 适用工况"，去掉营销形容',
    target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
    target_hint: 'CMS 后台的页面设置 → SEO 描述；模板改过一次，这条被覆盖后已撤回。',
    body: '脉冲布袋除尘器：处理风量 3,000~120,000 m³/h，过滤风速 0.8~1.2 m/min，出口排放 ≤10 mg/m³，适用于水泥、钢铁、木工与化工车间的粉尘治理。含参数表与选型要点。',
    published_body: '脉冲布袋除尘器：处理风量 3,000~120,000 m³/h，过滤风速 0.8~1.2 m/min，出口排放 ≤10 mg/m³，适用于水泥、钢铁、木工与化工车间的粉尘治理。含参数表与选型要点。',
    status: 'unpublished', review_status: 'approved',
    channel_kind: 'cms', source: 'generated', position: 1,
    published_at: '2026-09-19T09:00:00Z',
    created_at: '2026-09-17T02:05:00Z', updated_at: '2026-09-22T03:00:00Z',
  },
  {
    id: 'demo-site-patch-003', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-002', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'llms_txt', title: '上线 llms.txt：把四个核心页面与官方口径列给检索层',
    target_url: `${SEED_SITE_DOMAIN}/llms.txt`,
    target_hint: '站点根目录（与 robots.txt 同级）。外包代管 ⇒ 走工单，附上这份文件即可。',
    body: [
      '# 澜舟工业除尘设备',
      '',
      '> 苏州澜舟环保科技有限公司（品牌名：澜舟）生产脉冲布袋除尘器、滤筒除尘器与焊接烟尘净化设备，',
      '> 服务水泥、钢铁、木工与化工车间的粉尘治理。资质：环保工程专业承包贰级、ISO 9001:2015。',
      '',
      '## 核心页面',
      `- [脉冲布袋除尘器产品页](${SEED_SITE_DOMAIN}/products/bag-filter)：处理风量 3,000~120,000 m³/h、过滤风速 0.8~1.2 m/min，含参数表与选型要点。`,
      `- [企业资质与荣誉证书页](${SEED_SITE_DOMAIN}/qualification)：环保工程专业承包贰级、ISO 9001:2015，含证书编号与有效期。`,
      `- [售后服务与备件承诺页](${SEED_SITE_DOMAIN}/service)：报修响应 24 小时内、常用备件 7 个工作日到货。`,
      `- [关于澜舟](${SEED_SITE_DOMAIN}/about)：公司全称、成立年份、服务地域与官方口径。`,
      '',
      '## 联系',
      '- 官方邮箱：service@lanzhou-hb.example.com',
      '- 服务热线：+86-512-0000-0000（工作日 08:30~17:30）',
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'generated', position: 2,
    published_at: '2026-09-20T02:30:00Z',
    created_at: '2026-09-17T02:10:00Z', updated_at: '2026-09-20T02:30:00Z',
  },
  {
    id: 'demo-site-patch-004', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-002', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'robots_txt', title: 'robots.txt 放行 AI 爬虫，同时保住后台与报价单目录',
    target_url: `${SEED_SITE_DOMAIN}/robots.txt`,
    target_hint: '站点根目录。追加到现有文件末尾，不要整份替换（现有规则里已经有 sitemap 行）。',
    body: [
      '# ---- 放行 AI 检索与抓取（追加段，勿整份替换）----',
      'User-agent: GPTBot',
      'Allow: /',
      '',
      'User-agent: OAI-SearchBot',
      'Allow: /',
      '',
      'User-agent: ChatGPT-User',
      'Allow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'User-agent: PerplexityBot',
      'Allow: /',
      '',
      'User-agent: Bytespider',
      'Allow: /',
      '',
      '# ---- 这两处仍然要挡：后台与未公开的分项报价单 ----',
      'User-agent: *',
      'Disallow: /admin/',
      'Disallow: /download/price-list/',
      '',
      `Sitemap: ${SEED_SITE_DOMAIN}/sitemap.xml`,
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'generated', position: 3,
    published_at: '2026-09-20T02:30:00Z',
    created_at: '2026-09-17T02:15:00Z', updated_at: '2026-09-20T02:30:00Z',
  },
  {
    id: 'demo-site-patch-005', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-003', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'entity_consistency',
    title: 'About 页统一实体口径：公司全称、资质等级、服务地域',
    target_url: `${SEED_SITE_DOMAIN}/about`,
    target_hint: 'About 页"公司简介"整段替换；百科词条与黄页两处由市场部另行提交修订。',
    body: [
      '## 实体口径对照表（官网 About 页按此改写）',
      '',
      '| 字段 | 统一口径 | 常见错法（要改掉） |',
      '| --- | --- | --- |',
      '| 公司全称 | 苏州澜舟环保科技有限公司 | 澜舟环保设备有限公司、苏州澜舟环保 |',
      '| 品牌名 | 澜舟 | 蓝净、澜洲 |',
      '| 资质等级 | 环保工程专业承包贰级 | 壹级（❌ 豆包与百度 AI 搜索各错一次） |',
      '| 成立年份 | 2009 年 | 2011 年 |',
      '| 服务地域 | 江苏、浙江、安徽、山东（含现场勘测） | 全国 |',
      '',
      '> 改完之后：官网 About、百科词条、黄页三处逐字一致；三处的修改记录各留一张截图归档。',
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'manual', position: 4,
    published_at: '2026-09-21T06:00:00Z',
    created_at: '2026-09-17T02:20:00Z', updated_at: '2026-09-21T06:00:00Z',
  },
  {
    id: 'demo-site-patch-006', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-004', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'jsonld', title: '产品页 FAQ 区块的 FAQPage 结构化标记',
    target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
    target_hint: '页面 </body> 之前；问答文字要与页面上肉眼可见的 FAQ 区块逐字一致（否则算标记与内容不符）。',
    body: [
      '<script type="application/ld+json">',
      '{',
      '  "@context": "https://schema.org",',
      '  "@type": "FAQPage",',
      '  "mainEntity": [',
      '    {',
      '      "@type": "Question",',
      '      "name": "脉冲布袋除尘器的过滤风速怎么选？",',
      '      "acceptedAnswer": {',
      '        "@type": "Answer",',
      '        "text": "常规工况取 0.8~1.2 m/min；粉尘浓度高或粒径细时下调到 0.8 m/min 以下，并相应增加滤袋数量。"',
      '      }',
      '    },',
      '    {',
      '      "@type": "Question",',
      '      "name": "出口排放能做到多少？",',
      '      "acceptedAnswer": {',
      '        "@type": "Answer",',
      '        "text": "配覆膜滤料时实测区间在 10 mg/m³ 以内，具体数值以第三方检测报告与现场验收为准。"',
      '      }',
      '    },',
      '    {',
      '      "@type": "Question",',
      '      "name": "常用备件多久能到？",',
      '      "acceptedAnswer": {',
      '        "@type": "Answer",',
      '        "text": "滤袋、脉冲阀与控制器等常用备件 7 个工作日内到货；报修响应在 24 小时内。"',
      '      }',
      '    }',
      '  ]',
      '}',
      '</script>',
    ].join('\n'),
    published_body: null, status: 'draft', review_status: 'pending_review',
    channel_kind: 'edge', source: 'generated', position: 5,
    published_at: null,
    created_at: '2026-09-24T02:00:00Z', updated_at: '2026-09-26T02:20:00Z',
  },
  {
    id: 'demo-site-patch-007', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-007', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'html_fragment', title: '资质页补证书编号与有效期区块（纠正"壹级"错法）',
    target_url: `${SEED_SITE_DOMAIN}/qualification`,
    target_hint: '资质页证书列表之下；每张证书都要有编号与有效期，图片旁边配一份等价的文字。',
    body: [
      '<section id="certificates" aria-labelledby="certificates-title">',
      '  <h2 id="certificates-title">资质与证书</h2>',
      '  <table>',
      '    <thead><tr><th>证书</th><th>编号</th><th>有效期</th></tr></thead>',
      '    <tbody>',
      '      <tr><td>环保工程专业承包贰级</td><td>A2-32050000-2024-0117</td><td>2027-06-30</td></tr>',
      '      <tr><td>ISO 9001:2015 质量管理体系</td><td>00124Q33000R0M</td><td>2027-03-15</td></tr>',
      '      <tr><td>安全生产许可证</td><td>(苏)JZ安许证字[2023]0512</td><td>2026-12-31</td></tr>',
      '    </tbody>',
      '  </table>',
      '  <p>以上编号可在发证机关公开渠道核验；如与任何第三方页面的表述不一致，以本页为准。</p>',
      '</section>',
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'generated', position: 6,
    published_at: '2026-09-25T03:40:00Z',
    created_at: '2026-09-24T02:10:00Z', updated_at: '2026-09-25T03:40:00Z',
  },
  {
    id: 'demo-site-patch-008', project_id: SEED_ACTIVE_PROJECT_ID,
    action_id: 'demo-act-010', round_id: SEED_BASELINE_ROUND_ID,
    kind: 'html_fragment', title: '服务页写明报修响应时限与备件供应周期',
    target_url: `${SEED_SITE_DOMAIN}/service`,
    target_hint: '服务页顶部；robots.txt 的放行段先上了（否则 AI 爬虫读不到这一段），本段随后贴上去。',
    body: [
      '<section id="service-promise" aria-labelledby="service-promise-title">',
      '  <h2 id="service-promise-title">服务承诺</h2>',
      '  <ul>',
      '    <li>报修响应：24 小时内电话或远程响应，48 小时内给出处置方案。</li>',
      '    <li>常用备件：滤袋、脉冲阀、控制器 7 个工作日内到货。</li>',
      '    <li>现场服务：江苏、浙江、安徽、山东可安排现场勘测与维保。</li>',
      '  </ul>',
      '  <p class="doc-meta">更新时间：<time datetime="2026-09-26">2026-09-26</time> · 供稿：澜舟售后服务部</p>',
      '</section>',
    ].join('\n'),
    published_body: null, status: 'published', review_status: 'approved',
    channel_kind: 'bundle', source: 'generated', position: 7,
    published_at: '2026-09-22T09:00:00Z',
    created_at: '2026-09-17T02:25:00Z', updated_at: '2026-09-22T09:00:00Z',
  },
];

/**
 * 进库的那份台账：把**已发布**的补丁的 `published_body` 补齐成与 `body` 逐字相同。
 *
 * 🔴 这一步不是"程序化生成语料"（AGENTS 规则 9 禁的是那一种），而是声明一条**数据不变式**：
 * `published_body` 是"上一次发布时的正文快照"（`api/types-site.ts` DR-47），
 * 而演示数据的叙事是"这几条发布之后没再动过" ⇒ 快照与草案必然逐字相同。
 * 留 `null` 会同时踩两个坑：
 * ① 界面据 `body !== published_body` 派生"有未发布的修改"，5 条已发布补丁会**全部**挂上这个标记；
 * ② `rollback` 的落点就是这份快照，`null` ⇒ 一条都回滚不了（`handlers/site-patch.ts`）。
 * `demo-site-patch-002`（已撤回）在行里已经写了快照，这一步不动它。
 */
export const SEED_SITE_PATCHES: SitePatch[] = SITE_PATCH_ROWS.map((row) => {
  if (row.status !== 'published' && row.published_body === null) return row;
  return {
    ...row,
    published_body: row.published_body ?? row.body,
    published_kind: row.published_kind ?? row.kind,
    published_target_url: row.published_target_url ?? row.target_url,
    published_channel_kind: row.published_channel_kind ?? row.channel_kind,
  };
});

/**
 * 补丁的历史事件（种子部分）。
 *
 * 🔴 事件的时间戳与所属补丁的 `created_at` / `published_at` / `updated_at` **逐字对齐**
 * （`seed.test.ts` 钉住）：界面上"最后更新"与历史里最后一条事件对不上，是最容易被产品负责人
 * 抓住的自相矛盾。
 */
export const SEED_SITE_PATCH_EVENTS: SitePatchEvent[] = [
  {
    id: 'demo-site-event-001', patch_id: 'demo-site-patch-001', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:00:00Z',
  },
  {
    id: 'demo-site-event-002', patch_id: 'demo-site-patch-001', kind: 'published',
    channel_kind: 'bundle', note: '外包按交接单改的产品页模板，改完截图已归档。',
    created_at: '2026-09-19T08:00:00Z',
  },
  {
    id: 'demo-site-event-003', patch_id: 'demo-site-patch-002', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:05:00Z',
  },
  {
    id: 'demo-site-event-004', patch_id: 'demo-site-patch-002', kind: 'published',
    channel_kind: 'cms', note: null, created_at: '2026-09-19T09:00:00Z',
  },
  {
    id: 'demo-site-event-005', patch_id: 'demo-site-patch-002', kind: 'unpublished',
    channel_kind: 'cms', note: '外包换了 SEO 模板，这条描述被模板默认值覆盖，先撤回等新模板确认后再发。',
    created_at: '2026-09-22T03:00:00Z',
  },
  {
    id: 'demo-site-event-006', patch_id: 'demo-site-patch-003', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:10:00Z',
  },
  {
    id: 'demo-site-event-007', patch_id: 'demo-site-patch-003', kind: 'published',
    channel_kind: 'bundle', note: 'llms.txt 已上传到根目录，抓取验证记录见证据附录。',
    created_at: '2026-09-20T02:30:00Z',
  },
  {
    id: 'demo-site-event-008', patch_id: 'demo-site-patch-004', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:15:00Z',
  },
  {
    id: 'demo-site-event-009', patch_id: 'demo-site-patch-004', kind: 'published',
    channel_kind: 'bundle', note: '放行 6 个 AI 爬虫；后台与报价单目录仍然挡着。',
    created_at: '2026-09-20T02:30:00Z',
  },
  {
    id: 'demo-site-event-010', patch_id: 'demo-site-patch-005', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:20:00Z',
  },
  {
    id: 'demo-site-event-011', patch_id: 'demo-site-patch-005', kind: 'published',
    channel_kind: 'bundle', note: null, created_at: '2026-09-21T06:00:00Z',
  },
  {
    id: 'demo-site-event-012', patch_id: 'demo-site-patch-006', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-24T02:00:00Z',
  },
  {
    id: 'demo-site-event-013', patch_id: 'demo-site-patch-006', kind: 'saved',
    channel_kind: null, note: '问答文字按 FAQ 库人工审核后的版本改过一遍。',
    created_at: '2026-09-26T02:20:00Z',
  },
  {
    id: 'demo-site-event-014', patch_id: 'demo-site-patch-007', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-24T02:10:00Z',
  },
  {
    id: 'demo-site-event-015', patch_id: 'demo-site-patch-007', kind: 'published',
    channel_kind: 'bundle', note: '证书编号区块已上线；百科词条的修订由市场部另行提交。',
    created_at: '2026-09-25T03:40:00Z',
  },
  {
    id: 'demo-site-event-016', patch_id: 'demo-site-patch-008', kind: 'created',
    channel_kind: null, note: null, created_at: '2026-09-17T02:25:00Z',
  },
  {
    id: 'demo-site-event-017', patch_id: 'demo-site-patch-008', kind: 'published',
    channel_kind: 'bundle', note: '外包按交接单在服务页顶部加的服务承诺段；robots.txt 放行已在 09-20 生效。',
    created_at: '2026-09-22T09:00:00Z',
  },
];

/**
 * `site_patch_generate` 的**预置池**：按处方分组，逐字端出（🔴 不调模型，规则 9）。
 *
 * 🔴 与 `SEED_SITE_PATCHES` **刻意不重叠**（`seed.test.ts` 按 `(action_id, kind, target_url)`
 * 钉住互斥）：池子里放的是"这条处方**还**可以打哪些补丁"，已经在台账里的不重复放，
 * 免得"从处方生成"永远回空数组。
 * 🔴 `source_layout` 那两条处方（`demo-act-005` / `demo-act-006`）**不在池子里**：
 * 它们的落点是站外平台（百科词条、行业媒体、B2B 平台），产品定义 §3.12 明确不自动发布。
 */
export const SEED_SITE_PATCH_POOL: Record<string, SitePatchSeedRow[]> = {
  'demo-act-001': [
    {
      kind: 'meta_title', title: '产品页标题改成"品类 + 关键参数 + 品牌"',
      target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
      target_hint: 'CMS 后台的页面设置 → SEO 标题；控制在 30 个汉字以内。',
      body: '脉冲布袋除尘器_3000-120000 m³/h 处理风量_澜舟',
      channel_kind: 'cms',
    },
  ],
  'demo-act-003': [
    {
      kind: 'meta_description', title: 'About 页描述统一到"全称 + 资质 + 服务地域"',
      target_url: `${SEED_SITE_DOMAIN}/about`,
      target_hint: 'CMS 后台的页面设置 → SEO 描述。',
      body: '苏州澜舟环保科技有限公司（品牌名：澜舟），2009 年成立，环保工程专业承包贰级、ISO 9001:2015，服务江苏、浙江、安徽、山东的工业粉尘治理，提供现场勘测与维保。',
      channel_kind: 'cms',
    },
  ],
  'demo-act-004': [
    {
      kind: 'html_fragment', title: '产品页补 6 组问答体的 FAQ 区块（人能看见的那一份）',
      target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
      target_hint: '产品页"选型要点"之下；文字要与 FAQPage 标记里的问答逐字一致。',
      body: [
        '<section id="faq" aria-labelledby="faq-title">',
        '  <h2 id="faq-title">常见问题</h2>',
        '  <h3>脉冲布袋除尘器的过滤风速怎么选？</h3>',
        '  <p>常规工况取 0.8~1.2 m/min；粉尘浓度高或粒径细时下调到 0.8 m/min 以下，并相应增加滤袋数量。</p>',
        '  <h3>出口排放能做到多少？</h3>',
        '  <p>配覆膜滤料时实测区间在 10 mg/m³ 以内，具体数值以第三方检测报告与现场验收为准。</p>',
        '  <h3>常用备件多久能到？</h3>',
        '  <p>滤袋、脉冲阀与控制器等常用备件 7 个工作日内到货；报修响应在 24 小时内。</p>',
        '</section>',
      ].join('\n'),
      channel_kind: 'bundle',
    },
  ],
  'demo-act-007': [
    {
      kind: 'jsonld', title: '资质页的 Organization + 证书结构化标记',
      target_url: `${SEED_SITE_DOMAIN}/qualification`,
      target_hint: '页面 </body> 之前；`legalName` 必须写公司全称，不要写品牌简称。',
      body: [
        '<script type="application/ld+json">',
        '{',
        '  "@context": "https://schema.org",',
        '  "@type": "Organization",',
        '  "name": "澜舟",',
        '  "legalName": "苏州澜舟环保科技有限公司",',
        '  "foundingDate": "2009",',
        `  "url": "${SEED_SITE_DOMAIN}/",`,
        '  "areaServed": ["江苏", "浙江", "安徽", "山东"],',
        '  "hasCredential": [',
        '    { "@type": "EducationalOccupationalCredential", "name": "环保工程专业承包贰级", "identifier": "A2-32050000-2024-0117" },',
        '    { "@type": "EducationalOccupationalCredential", "name": "ISO 9001:2015 质量管理体系", "identifier": "00124Q33000R0M" }',
        '  ]',
        '}',
        '</script>',
      ].join('\n'),
      channel_kind: 'edge',
    },
  ],
  'demo-act-008': [
    {
      kind: 'html_fragment', title: '术语页《什么是脉冲布袋除尘器》正文骨架',
      target_url: `${SEED_SITE_DOMAIN}/glossary/pulse-jet-baghouse`,
      target_hint: '新建页面；定义句放在首屏第一段，控制在 150 字以内，后面接原理与选型要点。',
      body: [
        '<article id="glossary-pulse-jet-baghouse">',
        '  <h1>什么是脉冲布袋除尘器</h1>',
        '  <p>脉冲布袋除尘器是以压缩空气脉冲清灰的袋式除尘设备：含尘气体从下部进入箱体，',
        '粉尘被滤袋外表面截留，净化后的气体经净气室排出；清灰时脉冲阀在毫秒级喷出压缩空气，',
        '把滤袋上的粉尘层吹落进灰斗。</p>',
        '  <h2>工作原理</h2>',
        '  <p>过滤 → 粉尘层形成 → 压差上升 → 脉冲清灰 → 压差回落，循环进行。压差是判断清灰是否到位的直接指标。</p>',
        '  <h2>选型要点</h2>',
        '  <ul>',
        '    <li>处理风量与过滤风速决定滤袋面积，浓度高时风速取低值。</li>',
        '    <li>滤料按烟气温度与化学性质选：常温涤纶、高温 PPS 或覆膜滤料。</li>',
        '    <li>在线清灰结构简单，离线清灰适合高浓度与低排放要求。</li>',
        '  </ul>',
        '  <p class="doc-meta">供稿：澜舟技术部 · 审稿：售后与工艺工程师</p>',
        '</article>',
      ].join('\n'),
      channel_kind: 'bundle',
    },
    {
      kind: 'jsonld', title: '术语页的 DefinedTerm 结构化标记',
      target_url: `${SEED_SITE_DOMAIN}/glossary/pulse-jet-baghouse`,
      target_hint: '与术语页正文同一个页面；`description` 用首屏那段定义句的原文。',
      body: [
        '<script type="application/ld+json">',
        '{',
        '  "@context": "https://schema.org",',
        '  "@type": "DefinedTerm",',
        '  "name": "脉冲布袋除尘器",',
        '  "description": "以压缩空气脉冲清灰的袋式除尘设备，含尘气体经滤袋过滤后排出，粉尘被脉冲气流反向吹落进灰斗。",',
        '  "inDefinedTermSet": "工业除尘术语",',
        `  "url": "${SEED_SITE_DOMAIN}/glossary/pulse-jet-baghouse"`,
        '}',
        '</script>',
      ].join('\n'),
      channel_kind: 'edge',
    },
  ],
  'demo-act-009': [
    {
      kind: 'html_fragment', title: '三家横向对比表（含口径说明）与两张案例卡',
      target_url: `${SEED_SITE_DOMAIN}/compare/baghouse-vendors`,
      target_hint: '新建页面；对比表下面必须写清口径（数据截止时间、哪些是第三方检测值）。',
      body: [
        '<section id="vendor-compare">',
        '  <h1>三家布袋除尘器供应商横向对比</h1>',
        '  <table>',
        '    <thead><tr><th>对比项</th><th>澜舟</th><th>清源环保</th><th>恒宇环境</th></tr></thead>',
        '    <tbody>',
        '      <tr><td>处理风量范围</td><td>3,000~120,000 m³/h</td><td>5,000~90,000 m³/h</td><td>2,000~60,000 m³/h</td></tr>',
        '      <tr><td>出口排放（第三方检测）</td><td>≤10 mg/m³</td><td>≤20 mg/m³</td><td>≤30 mg/m³</td></tr>',
        '      <tr><td>常用备件到货</td><td>7 个工作日</td><td>10 个工作日</td><td>15 个工作日</td></tr>',
        '      <tr><td>现场服务地域</td><td>江苏、浙江、安徽、山东</td><td>华东</td><td>华北、华东</td></tr>',
        '    </tbody>',
        '  </table>',
        '  <p class="doc-meta">口径：数据截止 2026-09；排放数值取自各自公开的第三方检测报告，工况不同不可直接横比。</p>',
        '</section>',
      ].join('\n'),
      channel_kind: 'bundle',
    },
  ],
  'demo-act-010': [
    {
      kind: 'internal_link', title: '产品页与服务页之间补两条互链（带说明性锚文本）',
      target_url: `${SEED_SITE_DOMAIN}/products/bag-filter`,
      target_hint: '产品页参数表之下加一条；服务页"服务承诺"里加一条回指产品页。',
      body: [
        '<!-- 产品页 → 服务页 -->',
        `<p>整机交付后的报修响应与备件周期见 <a href="${SEED_SITE_DOMAIN}/service">售后服务与备件承诺</a>。</p>`,
        '',
        '<!-- 服务页 → 产品页 -->',
        `<p>常用备件的型号对照见 <a href="${SEED_SITE_DOMAIN}/products/bag-filter">脉冲布袋除尘器产品页</a> 的参数表。</p>`,
      ].join('\n'),
      channel_kind: 'bundle',
    },
  ],
};
