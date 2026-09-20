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

  export: {
    json: '项目 JSON（全量）',
    competitorsCsv: '竞品 CSV',
    assetsCsv: '资产 CSV',
  },
};

export default project;
