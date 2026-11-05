/**
 * 跨页面复用的通用动作与兜底文案。
 *
 * `unknownError` 是 Task 7 的 `describeIpcError` 在"拿到的不是 IpcRequestError"时的兜底；
 * 文案只描述现象与下一步，不承诺结果（AGENTS.md 规则 6）。
 *
 * Task 8 追加的键分两类：
 * - **跨 surface 复用**的（`edit` / `close` / `actions` / `invalidUrl` / `noteOptional` /
 *   `listSeparator`）：同一条指令在建项向导、竞品编辑器、两张表格里的措辞必须一致，
 *   分开放只会让"改一处忘三处"。
 * - **品牌名与副标题**（`appName` / `tagline`，裁定 B-3）：`appName` 的 **en 值就是同一个
 *   中文串**——专有名词不译。这样做的理由不是好看：Task 15 的残留扫描要求非测试、非
 *   locales 的源码里只剩注释含中文，把品牌名留在 `AppLayout.tsx` 里就得给扫描开白名单，
 *   而白名单是下一个静默洞。两侧值相同完全合法（键集相等断言只看键不看值）。
 */
const common = {
  /** 统一状态语言（StatusChip）：七种状态全站共用一套词。 */
  status: {
    ok: '正常',
    running: '进行中',
    warning: '待处理',
    error: '失败',
    todo: '待开始',
    unavailable: '未接入',
    insufficient: '样本不足',
  },

  save: '保存',
  cancel: '取消',
  delete: '删除',
  confirm: '确认',
  search: '搜索',
  loading: '加载中…',
  unknownError: '操作未成功，请稍后重试',

  appName: '稿得快 GEO',
  tagline: '生成式引擎优化 · 本地优先',

  edit: '编辑',
  close: '关闭',
  actions: '操作',
  more: '更多',
  invalidUrl: '请输入合法的 URL（含 http/https）',
  noteOptional: '备注（可选）',
  /** 列表连接符。zh 用顿号，en 用逗号——所以它必须是词条而不是代码里的字面量。 */
  listSeparator: '、',

  // -------------------------------------------------------------------------
  // M3–M7 追加的**跨 surface 复用**键（采集 / 解析 / 诊断 / 行动 / 报告五个页面共用）
  // -------------------------------------------------------------------------
  refresh: '刷新',
  all: '全部',
  yes: '是',
  no: '否',

  /**
   * 样本量分级标签（`SampleSizeGrade`）。
   *
   * ⚠ 与 `prompt.sampleSize.warnings.*` 分工：那边是**告警句**（`sufficient` 刻意没有键），
   * 这边是**分级名**（三档都要有，表格与 Descriptions 里当标签用）。
   */
  sampleSizeGrades: {
    sufficient: '样本充足',
    directional: '方向性参考',
    insufficient: '样本不足',
  },

  /** 情感倾向（`Sentiment`）：采集证据表、解析结果表、竞品矩阵三处共用。 */
  sentiments: {
    positive: '正面',
    neutral: '中性',
    negative: '负面',
  },

  /**
   * 带单位的数字模板。
   *
   * 单位词在两种语言里形状不同（zh「3 个百分点」/ en「3 pp」），所以单位必须是词条；
   * 数字与符号由 `components/format.ts` 的纯函数算好再插值进来。
   * ⚠ 插值变量一律不叫 `count`（i18next 会走复数分支去找 `_one` / `_other`，本词典没有）。
   */
  units: {
    percentagePoints: '{{value}} 个百分点',
    items: '{{value}} 条',
    prompts: '{{value}} 道题',
    seconds: '{{value}} 秒',
    tokens: '{{value}} token',
  },

  /**
   * 界面语言标签（`enumLabel(t, 'common.languages', locale)`）。
   *
   * 键名 = `i18n/index.ts` 的 `LOCALES`（连字符形态），与 `AppSettings.language`
   * 的下划线形态**刻意不同**：那是生成内容的语言，两者是两个字段（spec DR-32）。
   * en 侧一律 ASCII：语言名写成英文而不是各语言的自称，否则 `EN_DICT_CJK` 那条守卫会红。
   */
  languages: {
    'zh-CN': '简体中文',
    'en-US': '英文',
  },

  /**
   * 导出格式标签（`ExportFormat`）。
   *
   * `docx` / `pdf` / `png` 在演示模式下产不出（`DESKTOP_ONLY_EXPORT_FORMATS`）：
   * 按钮照旧渲染但置灰，提示语在 `report.export.desktopOnly` / `action.export.desktopOnly`。
   */
  exportFormats: {
    markdown: 'Markdown',
    html: 'HTML',
    csv: 'CSV',
    docx: 'Word',
    pdf: 'PDF',
    png: 'PNG',
  },
  /**
   * 自检结论（`CheckDetail.code` → 文案）。后端只回稳定码 + 语言中立 params；
   * 查不到时由 `CheckDetailText` 回落到 code 本身，绝不回落到中文。
   */
  checkDetails: {
    site_bundle_ready: '落地包通道不需要任何凭据；导出走本地文件，已确认导出目录可写。',
    site_bundle_verified: '落地包不需要任何凭据；已确认导出目录可写，最近一次导出为 {{date}} 的资质页交接单。',
    site_edge_not_deployed: '边缘函数尚未部署：patches.json 拉取地址返回 {{status}}。部署后重新自检即可。',
    site_cms_not_configured: '未配置：需要先填站点 URL 与用户名，并在 WordPress 后台创建应用程序密码（演示模式不收密码）。',

    site_credentials_missing: '尚未配置凭据：{{kind}} 需要先在系统钥匙串里保存凭据。',
    site_repo_manual_check: '仓库地址已填写；仓库类通道由用户在托管平台提交合并请求，自检只确认配置存在。',
    site_reachable: '通道可达（HTTP {{status}}）。',
    site_unreachable: '通道不可达：{{reason}}。',
    site_repo_not_configured: '未配置：填仓库地址后可生成 diff 与交接说明，由用户自己在托管平台上提合并请求。',
    search_ai_flow_verified: '站点已验证，《AI 流量分析》在灰度名单内：三段报表都能看到，其中只有「AI 引用热门关键词」带下载按钮（xlsx，无日期列）。',
    search_traffic_keywords_verified: '站点已验证，「数据统计 → 流量与关键词」可导出；平均排名与索引量两列没有规范落点，按原样留在平台独有维度里。',
    search_toutiao_delayed: '站点已验证，但后台只给到 {{through}}：新站数据延时，这一批还没出。距今已 {{days}} 天，界面上会挂陈旧告警。',
    search_gsc_export_verified: '资源库属性已核对（含结尾斜杠的 URL 前缀）；本轮数据由 CSV 导出接入，接口授权还没配。数据延迟 {{lag_days}} 天，且每天每类型最多 {{row_cap}} 行、超出静默采样。',
    search_bing_verified_no_api: '站点已通过 DNS 验证；AI Performance 报表今天只有界面、没有接口，Grounding Queries 这一列按原样留在平台独有维度里。',
    search_tongji_verified: '站点 ID 已核对；会话数与来源分析可读。它是站内分析、量纲是会话，永不进曝光合计，只用于流量来源分布与接入建议。',
    search_binding_missing: '尚未完成必填绑定：{{fields}}。',
    search_binding_blocked: '尚未完成必填绑定：预置探测结论显示平台本身可用，但当前源缺少取数所需的站点绑定；演示模式不发请求。',
    search_credentials_missing: '尚未授权：{{kind}} 需要先完成官方授权。',
    search_reachable: '站点可达（HTTP {{status}}）。',
    search_unreachable: '站点不可达：{{reason}}。',
    search_manual_no_probe: '人工填报不需要探测：没有平台、没有凭据，填的是哪个区间就是哪个区间。',
    search_phase_two: '二期数据源：目录表里已经建齐，界面本轮不渲染接入入口。',
  },
};

export default common;
