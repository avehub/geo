/**
 * 项目列表 + 建项向导（Task 8 填入）。
 *
 * # 键集的真值源在这一侧
 *
 * en-US 侧标着 `: ResourceBundle['project']`，而 `ResourceBundle` 是从 zh-CN 侧推出来的
 * （裁定 R-G）⇒ 这里多一个键，en 侧 `tsc -b` 就红；这里少一个键，en 侧多出来的键
 * 由 `src/i18n/index.test.ts` 的运行期双向键集断言抓住。两侧都不许靠 `fallbackLng` 兜。
 *
 * # 向导步骤键用**稳定 slug** 而不是 index（裁定 B-3）
 *
 * `wizard.steps.brand` 而不是 `wizard.steps.0`：步骤重排时 index 键会**静默错位**——
 * `steps.2.title` 仍查得到，只是内容变成了另一步的标题，界面不报错、门禁不红。
 * slug 重排后仍指向同一步，且与 `components/wizard-steps.ts` 的 `WIZARD_STEPS` 一一对应。
 *
 * # 覆盖断言
 *
 * `WIZARD_STEPS` 里的 key 是从**数据表**读出来的变量，B-1 的字面量扫描抓不到 ⇒
 * 新增步骤时忘建词条是静默的（界面露出裸 key）。所以 `src/i18n/no-hardcoded-strings.test.ts`
 * 遍历 `WIZARD_STEPS`，断言每个 `titleKey` / `descriptionKey` 在两侧都 `exists`（裁定 B-4）。
 *
 * 插值变量一律经 `{{…}}` 传进来（`{{max}}` / `{{total}}` / `{{step}}` / `{{brand}}` …），
 * 组件里不做字符串拼接——拼接在 en 下语序就是错的。`aliasesPlaceholder` 里保留了一个
 * 中文示例值，那是**该显示的数据**（示例品牌名），不是待抽的文案。
 */
const project = {
  wizard: {
    steps: {
      brand: {
        title: '品牌与别名',
        description: '品牌名、常见叫法',
      },
      website: {
        title: '官网与核心页',
        description: '自动建档的抓取入口',
      },
      products: {
        title: '产品线与服务范围',
        description: '产品、参数与服务边界',
      },
      region: {
        title: '地域与语言',
        description: '服务地域、行业与标签',
      },
      competitors: {
        title: '竞品 3–5 家',
        description: '同框对比与 SOV 基础',
      },
    },

    stepOf: '第 {{step}} 步',
    stepSummary: ' / 共 {{total}} 步 · {{title}}',

    brandName: '品牌名',
    brandNameRequired: '请输入品牌名',
    brandNameTooLong: '品牌名不能超过 {{max}} 字',
    brandNameExtra: '用户搜索时最常提到的那个名字，例如「宏宇泵业」',
    brandNamePlaceholder: '例如：宏宇泵业',

    aliases: '品牌别名',
    aliasesExtra: '输入后回车，可添加多个',
    aliasesPlaceholder: '例如：宏宇、HongYu',

    projectName: '项目名',
    projectNameTooLong: '项目名不能超过 {{max}} 字',
    projectNameExtra: '留空则与品牌名相同',
    projectNamePlaceholder: '例如：宏宇泵业 GEO（2026 Q4）',

    website: '官网',
    websiteExtra: '自动建档会抓取官网首页与站内页面，仅抓自有域名',
    corePages: '核心页面',
    corePagesExtra: '输入完整 URL 后回车，可添加多个',
    /**
     * Task 15a 第 19 条（台账 #10 #23）：原先硬编码在 `components/WizardSteps.tsx` 的
     * `core_pages` 那个 `<Select mode="tags">` 上。裁定是**进词典**而不是进残留例外表——
     * 它是会被用户看见的占位提示（界面文案），不是 `tokenSeparators` 那种输入契约。
     * 值刻意与原来的字面量**逐字相同**：改措辞（例如补上兄弟键那种「例如：」前缀）属文案变更，
     * 按 AGENTS 规则 8 要先在 demo 里定稿并经产品负责人确认，不在收口轮的授权内。
     */
    corePagesPlaceholder: 'https://www.example.com/about',

    products: '产品线',
    productsExtra: '产品名必填，参数用于生成「专业长尾」prompt',
    productCount: '共 {{total}} 个产品',
    productNameTooLong: '产品名不能超过 {{max}} 字',
    productNamePlaceholder: '例如：离心泵',
    productParamsPlaceholder: '关键参数，回车添加',
    removeProductAria: '删除该产品',
    addProduct: '添加产品',
    serviceScope: '服务范围',
    serviceScopePlaceholder: '例如：面向市政供水与工业循环水，提供选型、安装指导与售后维保',

    region: '服务地域',
    regionTooLong: '地域不能超过 {{max}} 字',
    regionExtra: '留空默认「全国」，用于生成「本地服务」类 prompt',
    regionPlaceholder: '例如：浙江杭州',
    language: '语言',
    languageZhCn: '简体中文',
    languageEnUs: '英文',
    industry: '行业',
    industryExtra: '决定 prompt 模板库',
    industryLabel: '行业名称',
    industryLabelPlaceholder: '例如：宠物医疗',
    tags: '标签',
    tagsExtra: '输入后回车，便于多项目检索',
    tagsPlaceholder: '例如：水泵、市政',

    // ---- Task 9：`pages/ProjectWizardPage.tsx` 自己的文案 ----
    title: '新建项目',
    created: '项目「{{name}}」已创建',
    /**
     * 非 `IpcRequestError` 那一支的兜底（裁定 B-5）。**刻意不共用** `common.unknownError`：
     * 「请检查填写内容」是这一支唯一能给出的可操作提示，降级成通用文案会减少用户拿到的信息量。
     */
    createFailed: '创建失败，请检查填写内容',
    incomplete: '请先补全必填项（品牌名必填，竞品官网需为合法 URL）',
    /** `{{min}}` 由 `MIN_COMPETITORS` 插值，不许写死（既有「数字同源」做法）。 */
    tooFewCompetitors:
      '竞品不足：请补齐到 {{min}} 家后再创建，否则无法生成「品牌对比」类同框 prompt',
    draftFound: '检测到上次未完成的建档草稿',
    draftBrand: '品牌：{{brand}}',
    draftBrandEmpty: '（未填写）',
    draftRestored: '草稿已恢复',
    restoreDraft: '恢复草稿',
    discardDraft: '丢弃',
    prev: '上一步',
    next: '下一步',
    submit: '创建项目',
  },

  /**
   * 项目列表页（Task 9）。
   *
   * # 导出文件名也是文案
   *
   * `exportJsonFileName` / `exportCsvFileName` 走词典不是为了好看：原实现把
   * `-geo-项目档案.json` 与 `${label}.csv` 拼在组件里，en locale 下会产出中文文件名。
   * 语序与分隔符在两种语言里不同，所以整份文件名模板都进词典，组件只传插值。
   *
   * # `hint` 里的 `20`
   *
   * 它是 `crates/geo-domain/src/project.rs` 的 `MAX_TAGS`，前端**没有**对应常量
   * （`src/api/constants.ts` 是它的镜像模块，但不在本轮写集内）⇒ 暂时留在文案里，
   * 已在 task-9-report.md 里显式请求扩权，不要当成漏抽。
   */
  list: {
    title: '项目',
    searchPlaceholder: '搜索项目名或品牌名',
    showArchived: '显示已归档',
    refresh: '刷新',
    newProject: '新建项目',
    loadFailed: '加载项目失败',
    hint: '提示：标签列可直接输入后回车增删（最多 20 个）；每行「导出」可下载项目 JSON（含实体卡、竞品、资产与题库），或单独的竞品 / 资产 CSV。',
    archived: '已归档',
    unarchived: '已取消归档',
    deleted: '项目已删除',
    tagsUpdated: '标签已更新',
    jsonExported: '项目 JSON 已导出',
    csvExported: '{{label}} CSV 已导出',
    competitorsLabel: '竞品',
    assetsLabel: '资产',
    exportJsonFileName: '{{brand}}-geo-项目档案.json',
    exportCsvFileName: '{{brand}}-{{label}}.csv',
    deleteConfirmTitle: '删除项目「{{name}}」？',
    deleteConfirmContent: '项目下的实体卡、竞品、资产与 prompt 题库都会一并删除，且不可恢复。',
  },

  table: {
    name: '项目名',
    brand: '品牌：{{brand}}',
    aliases: '（别名 {{aliases}}）',
    industry: '行业',
    region: '地域',
    tags: '标签',
    tagsPlaceholder: '输入标签后回车',
    tagsAria: '编辑「{{name}}」的标签',
    status: '状态',
    archived: '已归档',
    active: '进行中',
    updatedAt: '更新时间',
    openEntityCard: '实体卡',
    openPrompts: '题库',
    archive: '归档',
    unarchive: '取消归档',
    export: '导出',
    deleteHint: '删除后不可恢复',
    empty: '还没有项目，点右上角「新建项目」开始',
  },

  /**
   * 行业枚举标签（`Industry`）。键名逐字 = 枚举值本身；zh 值逐字抄自被删掉的
   * `api/types.ts` `INDUSTRY_LABELS`。运行时清单是语言中立的 `INDUSTRY_VALUES`，
   * 查标签走 `src/i18n/enum-label.ts` 的 `enumLabel`，哨兵在 `enum-label.test.tsx`。
   *
   * ⚠ `ProjectTable` 的行业列在 `industry === 'other'` 且后端给了 `industry_label` 时，
   * 优先显示**用户自己填的那个字符串**——那是数据不是标签，不查词典。
   */
  industries: {
    b2b_manufacturing: 'B2B 制造与工业品',
    enterprise_saas: '企业服务/SaaS',
    local_service: '本地生活与专业服务',
    cross_border_ecommerce: '跨境电商',
    franchise: '招商加盟',
    other: '其他行业',
  },

  export: {
    json: '项目 JSON（全量）',
    competitorsCsv: '竞品 CSV',
    assetsCsv: '资产 CSV',
  },
};

export default project;
