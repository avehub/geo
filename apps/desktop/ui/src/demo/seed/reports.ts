/**
 * 种子：M7 报告与分享（老板版 / 执行版 / 白标版的**结构化内容**）。
 *
 * # 为什么种子给的是"块"，不是排好版的文档
 * 报告标题、节标题、指标名、表头、免责声明都是**界面文案**，必须走词典（AGENTS 规则 7）；
 * 种子只提供**稳定记号 + 数据**：`{ kind: 'metric', metric: 'brand_coverage', value: 0.42 }`、
 * `{ kind: 'paragraph', text: '……' }`。前端把两者拼成界面预览，也拼成 Markdown / HTML / CSV
 * 导出文本（`src/api/report-compose.ts`）——导出文件因此会随界面语言走。
 *
 * # 🔴 demo 产不出 PDF / PNG / DOCX
 * 这三种要原生渲染或文档库，纯前端 demo 不引（`DESKTOP_ONLY_EXPORT_FORMATS`）。
 * 界面上按钮照旧渲染但置灰并说明"桌面端提供"，让产品负责人看到完整的导出面。
 *
 * # 数字与 M5 的种子逐一对齐
 * 覆盖率 42%→55%、总分 44→55、事实问题 27→15 条，全部取自 `seed/diagnosis.ts`；
 * 判据在 `demo/seed.test.ts`（报告的 metric 块与诊断 overview 必须同值）。
 */
import type {
  ReportBlock,
  ReportMetricBlock,
  ReportMethodology,
  ReportVariant,
  WhiteLabelProfile,
} from '../../api/types';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from './collection-rounds';

/** 每份报告预置的节（键 = 节 id，界面查词典 `report.sections.<id>` 得到标题）。 */
export interface SeedReportPayload {
  headline: ReportMetricBlock[];
  next_steps: string[];
  sections: Record<string, ReportBlock[]>;
  methodology: ReportMethodology;
  /** 证据附录的表格行（列口径见 `EVIDENCE_COLUMN_KEYS`）。 */
  evidence_rows: string[][];
}

/** 证据附录的列（稳定记号）。 */
export const EVIDENCE_COLUMN_KEYS: readonly string[] = [
  'prompt_text',
  'engine',
  'collected_at',
  'mention',
  'rank',
  'answer_excerpt',
];

/** 竞品矩阵表的列。 */
export const COMPETITOR_COLUMN_KEYS: readonly string[] = [
  'brand',
  'coverage',
  'share_of_voice',
  'top3_rate',
  'sentiment',
  'fact_error_count',
];

/** 引擎差异表的列。 */
export const ENGINE_COLUMN_KEYS: readonly string[] = [
  'engine',
  'coverage',
  'top3_rate',
  'fact_error_rate',
  'success_rate',
  'avg_latency_ms',
];

/** 处方表的列。 */
export const ACTION_COLUMN_KEYS: readonly string[] = [
  'rank',
  'title',
  'category',
  'impact',
  'status',
];

/**
 * 每个版本包含哪些节（顺序即渲染顺序）。
 *
 * 老板版只要"1 页结论 + 3 个数字 + 下一步"（`headline` 与 `next_steps` 是文档顶层字段，
 * 不在这里），执行版全给，白标版去掉漏斗与核查明细（对客户先给结论与对标）。
 */
export const SEED_VARIANT_SECTIONS: Record<ReportVariant, string[]> = {
  executive: ['conclusion'],
  detailed: ['conclusion', 'coverage', 'competitors', 'engines', 'funnel', 'fact_check', 'actions'],
  white_label: ['conclusion', 'coverage', 'competitors', 'actions'],
};

/** 白标默认值（服务商版能力，demo 里用来走查界面；可在报告页现场改）。 */
export const SEED_WHITE_LABEL: WhiteLabelProfile = {
  agency_name: '示例数字营销服务（苏州）有限公司',
  contact: 'geo@example-agency.example.com · 0512-6666-0000',
  logo_url: null,
};

const SEVEN_ENGINES = ['doubao', 'deepseek', 'kimi', 'qwen', 'yuanbao', 'baidu_ai', 'metaso'] as const;

export const SEED_REPORTS: Record<string, SeedReportPayload> = {
  [SEED_TRIAL_ROUND_ID]: {
    headline: [
      { kind: 'metric', metric: 'brand_coverage', value: 0.2, unit: 'percent', delta: null },
      { kind: 'metric', metric: 'sample_size', value: 5, unit: 'count', delta: null },
      { kind: 'metric', metric: 'success_rate', value: 0.73, unit: 'percent', delta: null },
    ],
    next_steps: [
      '先把样本量提到 60 条以上再出结论：本轮只有 5 道题、3 家引擎，覆盖率区间宽达 ±18 个百分点。',
      '修复秘塔的限流与元宝的登录态，这两条通道本轮贡献了 4 次失败。',
    ],
    sections: {
      conclusion: [
        {
          kind: 'paragraph',
          text:
            '本轮是通道验证轮，样本量 5 条（低于 30 条下限），结论仅供方向性参考，不作为可见度基线。' +
            '两条通道都能拿到回答：官方 API 平均 2.3 秒，浏览器自动化平均 9.2 秒。',
        },
        { kind: 'metric', metric: 'total_score', value: 33, unit: 'score', delta: null },
        {
          kind: 'list',
          items: [
            '秘塔出现 2 次限流，建议在采集与频控里下调每分钟请求数。',
            '元宝走浏览器自动化，需要用户扫码登录并持久化会话。',
          ],
        },
      ],
    },
    methodology: {
      round_label: '第 1 轮 · 通道验证（小样本）',
      sample_size: 5,
      sample_size_grade: 'insufficient',
      collected_at: '2026-09-08T02:38:00Z',
      engines: ['doubao', 'deepseek', 'metaso'],
      model_versions: ['doubao-seed-1.8', 'deepseek-chat', 'metaso-search-pro'],
      prompt_set_label: '澜舟除尘 · 滤筒细分小样本',
      prompt_set_version: 1,
      metric_spec_version: 'geo-metrics-v1',
      repeat_count: 1,
    },
    evidence_rows: [
      ['滤筒除尘器的滤芯一般多久换一次？', 'doubao', '2026-09-08 02:11', 'not_mentioned', '-', '滤筒除尘器的滤芯更换周期主要取决于粉尘性质与运行压差……'],
    ],
  },
  [SEED_BASELINE_ROUND_ID]: {
    headline: [
      { kind: 'metric', metric: 'brand_coverage', value: 0.42, unit: 'percent', delta: null },
      { kind: 'metric', metric: 'total_score', value: 44, unit: 'score', delta: null },
      { kind: 'metric', metric: 'fact_error_count', value: 27, unit: 'count', delta: null },
    ],
    next_steps: [
      '给核心产品页补一段可被直接引用的定义句与参数表（影响 18 道题，1 天内可完成）。',
      '上线 llms.txt 并放行 AI 爬虫：被引域名 47 个里自有页只占 31%。',
      '统一实体口径：9 条"说错了"里有 6 条源于官网、百科词条、黄页三处不一致。',
      '在服务页写明响应时限与备件周期，回应售后类问题里的两条负面片段。',
    ],
    sections: {
      conclusion: [
        {
          kind: 'paragraph',
          text:
            '62 道题 × 7 家引擎，一轮采集 78 分钟完成，成功率 97%。澜舟在 42%（±6）的题目里被提到，' +
            '但只有 21% 进入推荐清单前三位；病症集中在"认知层有、推荐层无"——' +
            '品类问题里能被提到，一到"推荐哪几家"就掉出清单。',
        },
        { kind: 'metric', metric: 'share_of_voice', value: 0.32, unit: 'percent', delta: null },
        { kind: 'metric', metric: 'top3_rate', value: 0.21, unit: 'percent', delta: null },
        {
          kind: 'paragraph',
          text:
            '事实层面有 27 条问题：9 条说错了（资质等级、公司全称、服务地域）、7 条说旧了（价格与案例）、' +
            '11 条漏说了（滤料自产、交付周期等卖点）。这些是本轮最需要先修的部分。',
        },
      ],
      coverage: [
        { kind: 'metric', metric: 'brand_coverage', value: 0.42, unit: 'percent', delta: null },
        { kind: 'metric', metric: 'distinct_cited_domains', value: 47, unit: 'count', delta: null },
        {
          kind: 'paragraph',
          text:
            '品牌覆盖率是头号指标：62 道题里 26 道提到澜舟。重复采样给出的区间是 ±6 个百分点，' +
            '小于 10 个百分点的环比变化都在波动范围内，不宜当作趋势解读。',
        },
      ],
      competitors: [
        {
          kind: 'table',
          column_keys: [...COMPETITOR_COLUMN_KEYS],
          rows: [
            ['澜舟', '42%', '32%', '21%', '46% / 19%', '27'],
            ['清源环保', '58%', '27%', '34%', '52% / 8%', '9'],
            ['蓝净科技', '31%', '18%', '14%', '44% / 11%', '6'],
            ['恒宇环境', '37%', '23%', '19%', '49% / 6%', '5'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '同框题（9 道）里清源环保的覆盖率高于澜舟 16 个百分点，但澜舟的提及份额（32%）已经领先；' +
            '差距主要在推荐位次与信源结构：清源环保被引域名 18 个，澜舟 12 个。',
        },
      ],
      engines: [
        {
          kind: 'table',
          column_keys: [...ENGINE_COLUMN_KEYS],
          rows: [
            ['kimi', '52%', '26%', '11%', '98%', '2810'],
            ['deepseek', '48%', '21%', '14%', '100%', '3050'],
            ['qwen', '45%', '19%', '16%', '100%', '2640'],
            ['metaso', '42%', '18%', '19%', '90%', '1210'],
            ['baidu_ai', '39%', '15%', '26%', '98%', '3320'],
            ['doubao', '35%', '13%', '24%', '98%', '2380'],
            ['yuanbao', '31%', '10%', '29%', '94%', '9240'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '最容易说错你的是元宝（事实错误率 29%）与百度 AI 搜索（26%）；最认可你的是 Kimi（覆盖率 52%）。' +
            '元宝走浏览器自动化，成功率与耗时都明显差于 API 通道，建议先修复登录态。',
        },
      ],
      funnel: [
        {
          kind: 'table',
          column_keys: ['stage', 'prompt_count', 'mention_rate', 'top3_rate'],
          rows: [
            ['awareness', '9', '67%', '33%'],
            ['recommendation', '9', '33%', '11%'],
            ['decision', '18', '28%', '11%'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '认知层 67% → 推荐层 33% → 决策层 28%：典型的"认知层有、推荐层无"。' +
            '补齐方向是可被引用的对比数据、参数表与定义句。',
        },
      ],
      fact_check: [
        { kind: 'metric', metric: 'fact_accuracy', value: 0.84, unit: 'percent', delta: null },
        {
          kind: 'list',
          items: [
            '说错了 9 条：资质等级被说成壹级（豆包、百度 AI 搜索各一次）、公司全称写成"设备有限公司"、服务地域被写成"仅限江苏省内"。',
            '说旧了 7 条：价格区间仍是 2025 年快照（6 万~50 万元），案例停留在 2023 年的两条窑线。',
            '漏说了 11 条：滤料自产、30 天交付、第三方检测报告与现场验收支持这几个卖点几乎没被提到。',
          ],
        },
      ],
      actions: [
        {
          kind: 'table',
          column_keys: [...ACTION_COLUMN_KEYS],
          rows: [
            ['1', '给核心产品页补一段可被直接引用的定义句与参数表', 'site_structure', 'high', 'todo'],
            ['2', '上线 llms.txt，并放行 AI 爬虫', 'site_structure', 'medium', 'todo'],
            ['3', '补 3 个高价值引用域名：行业媒体技术稿、百科词条、垂直社区问答', 'source_layout', 'high', 'todo'],
            ['4', '统一实体口径：公司全称、资质等级、服务地域三处一致', 'fact_correction', 'high', 'todo'],
            ['5', '更正资质等级错误：官网补证书编号，百科词条提交修订', 'fact_correction', 'high', 'todo'],
          ],
        },
      ],
    },
    methodology: {
      round_label: '第 2 轮 · 基线体检',
      sample_size: 62,
      sample_size_grade: 'sufficient',
      collected_at: '2026-09-16T02:18:00Z',
      engines: [...SEVEN_ENGINES],
      model_versions: [
        'doubao-seed-1.8',
        'deepseek-chat',
        'kimi-k2-thinking',
        'qwen3-max-search',
        'yuanbao-web-2026-09',
        'ernie-4.5-turbo-search',
        'metaso-search-pro',
      ],
      prompt_set_label: '澜舟除尘 · 基线题库',
      prompt_set_version: 1,
      metric_spec_version: 'geo-metrics-v1',
      repeat_count: 1,
    },
    evidence_rows: [
      ['什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', 'doubao', '2026-09-16 01:01', 'not_mentioned', '-', '脉冲布袋除尘器是用压缩空气脉冲瞬间反吹清灰的袋式除尘设备……'],
      ['澜舟和清源环保的布袋除尘器在滤料上有什么不同？', 'deepseek', '2026-09-16 01:03', 'mentioned', '2', '澜舟对外强调自有滤料生产线，交付周期标注为 30 天内……'],
      ['一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', 'metaso', '2026-09-16 01:09', 'mentioned', '-', '其公开资料给出的价格区间是单台 6 万~50 万元（与官网 2026-08 口径不一致）……'],
      ['苏州本地有哪些工业除尘设备厂家可以上门勘测？', 'qwen', '2026-09-16 01:12', 'mentioned', '1', '澜舟位于工业园区，服务范围覆盖江苏、浙江、安徽、山东……'],
      ['澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', 'baidu_ai', '2026-09-16 01:15', 'mentioned', '-', '有论坛帖子反映"报修后第三天才有响应"……'],
    ],
  },
  [SEED_RETEST_ROUND_ID]: {
    headline: [
      { kind: 'metric', metric: 'brand_coverage', value: 0.55, unit: 'percent', delta: 13 },
      { kind: 'metric', metric: 'total_score', value: 55, unit: 'score', delta: 11 },
      { kind: 'metric', metric: 'fact_error_count', value: 15, unit: 'count', delta: -12 },
    ],
    next_steps: [
      '决策层仍是最薄的一层（提及率 50%）：补横向对比表与分项报价说明。',
      '元宝渠道覆盖率落后恒宇环境 14 个百分点，先修复登录态与频控再复测。',
      '案例页仍只列两条 2024 年项目，建议把 3 条窑线改造与焊接烟尘治理两个案例补全。',
    ],
    sections: {
      conclusion: [
        {
          kind: 'paragraph',
          text:
            '复测沿用同一份题库版本（v1）与 7 家引擎，关键题目重复采样 2 次。' +
            '品牌覆盖率从 42% 升到 55%（±5），体检总分从 44 升到 55，事实问题从 27 条降到 15 条。' +
            '复测前完成的 4 项动作（定义句与参数表、llms.txt 与爬虫放行、实体口径统一、服务承诺页）' +
            '是这轮变化的主要来源。',
        },
        { kind: 'metric', metric: 'share_of_voice', value: 0.38, unit: 'percent', delta: 6 },
        { kind: 'metric', metric: 'top3_rate', value: 0.34, unit: 'percent', delta: 13 },
        {
          kind: 'paragraph',
          text:
            '需要留意的是随机性：秘塔的覆盖率回落 3 个百分点，落在该引擎 ±5 的正常波动区间内，' +
            '已标为观察项，不计入本轮结论。',
        },
      ],
      coverage: [
        { kind: 'metric', metric: 'brand_coverage', value: 0.55, unit: 'percent', delta: 13 },
        { kind: 'metric', metric: 'distinct_cited_domains', value: 52, unit: 'count', delta: 5 },
        {
          kind: 'paragraph',
          text:
            '自有页与权威源在被引来源里的占比从 31% 升到 44%，新增的术语页与滤料参数表已被 4 家引擎引用。',
        },
      ],
      competitors: [
        {
          kind: 'table',
          column_keys: [...COMPETITOR_COLUMN_KEYS],
          rows: [
            ['澜舟', '55%', '38%', '34%', '56% / 12%', '15'],
            ['清源环保', '56%', '26%', '31%', '51% / 7%', '8'],
            ['蓝净科技', '30%', '16%', '13%', '43% / 10%', '5'],
            ['恒宇环境', '35%', '20%', '18%', '48% / 6%', '4'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '与清源环保的覆盖率差距从 16 个百分点收窄到 1 个百分点，提及份额反超 12 个百分点。' +
            '被引域名数仍落后（19 vs 18 基本持平），下一轮的信源布局重点在权威媒体。',
        },
      ],
      engines: [
        {
          kind: 'table',
          column_keys: [...ENGINE_COLUMN_KEYS],
          rows: [
            ['kimi', '63%', '35%', '7%', '98%', '2760'],
            ['deepseek', '61%', '32%', '8%', '100%', '2980'],
            ['qwen', '58%', '29%', '9%', '100%', '2580'],
            ['metaso', '55%', '26%', '10%', '97%', '1190'],
            ['baidu_ai', '52%', '24%', '15%', '100%', '3180'],
            ['doubao', '50%', '21%', '13%', '100%', '2290'],
            ['yuanbao', '44%', '18%', '18%', '95%', '8870'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '豆包的事实错误率从 24% 降到 13%（资质页补了证书编号）；元宝仍是最弱的一环，' +
            '覆盖率 44%、事实错误率 18%，且本轮 3 次失败都出在登录态。',
        },
      ],
      funnel: [
        {
          kind: 'table',
          column_keys: ['stage', 'prompt_count', 'mention_rate', 'top3_rate'],
          rows: [
            ['awareness', '9', '78%', '44%'],
            ['recommendation', '9', '67%', '33%'],
            ['decision', '18', '50%', '28%'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            '推荐层从 33% 提到 67%，认知层与推荐层的断层基本补上；决策层（对比与价格 18 道题）仍是 50%，' +
            '是下一轮的主攻方向。',
        },
      ],
      fact_check: [
        { kind: 'metric', metric: 'fact_accuracy', value: 0.91, unit: 'percent', delta: 7 },
        {
          kind: 'list',
          items: [
            '说错了 4 条：资质等级与公司全称已更正，剩余是服务地域在第三方目录页的旧记录。',
            '说旧了 5 条：价格口径已同步到 2026-08 版本，案例页仍停留在 2024 年的两条项目。',
            '漏说了 6 条：滤料自产与交付周期已被提到，第三方检测报告与验收支持仍较少出现。',
          ],
        },
      ],
      actions: [
        {
          kind: 'table',
          column_keys: [...ACTION_COLUMN_KEYS],
          rows: [
            ['6', '在 B2B 平台补齐分项报价与参数页，替换 2025 年旧快照', 'source_layout', 'medium', 'todo'],
            ['7', '给每个产品页补 FAQ 区块（问答体，带 FAQPage 标记）', 'site_structure', 'medium', 'in_progress'],
            ['9', '生成三家横向对比表与案例卡，补决策层内容', 'content_production', 'medium', 'todo'],
            ['3', '补 3 个高价值引用域名：行业媒体技术稿、百科词条、垂直社区问答', 'source_layout', 'high', 'in_progress'],
          ],
        },
      ],
    },
    methodology: {
      round_label: '第 3 轮 · 行动后复测',
      sample_size: 62,
      sample_size_grade: 'sufficient',
      collected_at: '2026-09-23T02:12:00Z',
      engines: [...SEVEN_ENGINES],
      model_versions: [
        'doubao-seed-1.8',
        'deepseek-chat',
        'kimi-k2-thinking',
        'qwen3-max-search',
        'yuanbao-web-2026-09',
        'ernie-4.5-turbo-search',
        'metaso-search-pro',
      ],
      prompt_set_label: '澜舟除尘 · 基线题库',
      prompt_set_version: 1,
      metric_spec_version: 'geo-metrics-v1',
      repeat_count: 2,
    },
    evidence_rows: [
      ['什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', 'doubao', '2026-09-23 01:01', 'mentioned', '3', '国内常见的供应商包括清源环保、恒宇环境与澜舟……'],
      ['澜舟和清源环保的布袋除尘器在滤料上有什么不同？', 'deepseek', '2026-09-23 01:04', 'mentioned', '1', '澜舟自有滤料生产线，常用配置是 PTFE 覆膜涤纶与玻纤覆膜两种……'],
      ['一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', 'metaso', '2026-09-23 01:07', 'mentioned', '2', '按 2026 年 8 月改版后的公开口径，价格区间是单台 8 万~60 万元……'],
      ['澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', 'baidu_ai', '2026-09-23 01:10', 'mentioned', '-', '官网新增了服务承诺页，写明报修响应 24 小时内、备件供应周期 7 个工作日……'],
      ['采购工业除尘设备时，厂家资质要看哪几项？', 'doubao', '2026-09-23 01:13', 'mentioned', '1', '公开资料显示其具备环保工程专业承包贰级资质……'],
    ],
  },
};
