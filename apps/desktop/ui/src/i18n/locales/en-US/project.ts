import type { ResourceBundle } from '../../resources';

/** 项目列表 + 建项向导。键集由 zh-CN 侧钉死（R-G），步骤键用稳定 slug 而不是 index。 */
const project: ResourceBundle['project'] = {
  wizard: {
    steps: {
      brand: {
        title: 'Brand and aliases',
        description: 'Brand name and common names',
      },
      website: {
        title: 'Website and core pages',
        description: 'Crawl entry points for auto-build',
      },
      products: {
        title: 'Products and service scope',
        description: 'Products, specs and service boundaries',
      },
      region: {
        title: 'Region and language',
        description: 'Service region, industry and tags',
      },
      competitors: {
        title: '3–5 competitors',
        description: 'Side-by-side comparison and the SOV baseline',
      },
    },

    stepOf: 'Step {{step}}',
    stepSummary: ' of {{total}} · {{title}}',

    brandName: 'Brand name',
    brandNameRequired: 'Enter the brand name',
    brandNameTooLong: 'The brand name cannot exceed {{max}} characters',
    brandNameExtra: 'The name users mention most when searching, e.g. “HongYu Pump”',
    brandNamePlaceholder: 'e.g. HongYu Pump',

    aliases: 'Brand aliases',
    aliasesExtra: 'Press Enter to add; more than one is fine',
    aliasesPlaceholder: 'e.g. HongYu, 宏宇',

    projectName: 'Project name',
    projectNameTooLong: 'The project name cannot exceed {{max}} characters',
    projectNameExtra: 'Leave blank to use the brand name',
    projectNamePlaceholder: 'e.g. HongYu Pump GEO (2026 Q4)',

    website: 'Website',
    websiteExtra: 'Auto-build crawls the homepage and internal pages, own domain only',
    /** 与 zh-CN 同批新增（#47），值逐字相同（URL 示例语言无关，理由见 zh 侧注释）。 */
    websitePlaceholder: 'https://www.example.com',
    corePages: 'Core pages',
    corePagesExtra: 'Enter a full URL and press Enter; more than one is fine',
    /** Task 15a 第 19 条：与 zh-CN 同批新增，值逐字相同（URL 示例语言无关，理由见 zh 侧注释）。 */
    corePagesPlaceholder: 'https://www.example.com/about',

    products: 'Product lines',
    productsExtra: 'The product name is required; specs feed the “professional long-tail” prompts',
    productCount: '{{total}} products',
    productNameTooLong: 'The product name cannot exceed {{max}} characters',
    productNamePlaceholder: 'e.g. centrifugal pump',
    productParamsPlaceholder: 'Key specs; press Enter to add',
    removeProductAria: 'Remove this product',
    addProduct: 'Add product',
    serviceScope: 'Service scope',
    serviceScopePlaceholder:
      'e.g. municipal water supply and industrial circulating water: selection, installation guidance and after-sales maintenance',

    region: 'Service region',
    regionTooLong: 'The region cannot exceed {{max}} characters',
    regionExtra: 'Defaults to “nationwide” when blank; feeds the “local service” prompts',
    regionPlaceholder: 'e.g. Hangzhou, Zhejiang',
    language: 'Language',
    languageZhCn: 'Simplified Chinese',
    languageEnUs: 'English',
    industry: 'Industry',
    industryExtra: 'Decides which prompt template library is used',
    industryLabel: 'Industry name',
    industryLabelPlaceholder: 'e.g. veterinary care',
    tags: 'Tags',
    tagsExtra: 'Press Enter to add; helps searching across projects',
    tagsPlaceholder: 'e.g. pump, municipal',

    title: 'New project',
    created: 'The project “{{name}}” was created',
    createFailed: 'Could not create the project. Check the details you filled in.',
    incomplete:
      'Fill in the required fields first (the brand name is required and each competitor website must be a valid URL)',
    tooFewCompetitors:
      'Not enough competitors: bring the list up to {{min}} before creating the project, otherwise the “brand comparison” side-by-side prompts cannot be generated',
    draftFound: 'An unfinished draft from your last visit was found',
    draftBrand: 'Brand: {{brand}}',
    draftBrandEmpty: '(not filled in)',
    draftRestored: 'Draft restored',
    restoreDraft: 'Restore draft',
    discardDraft: 'Discard',
    prev: 'Back',
    next: 'Next',
    submit: 'Create project',
  },

  /**
   * Project list page (Task 9). The exported file names live here too: they used to be
   * assembled in the component, which produced Chinese file names under the en locale.
   * `20` in `hint` is the backend `MAX_TAGS` (`crates/geo-domain/src/project.rs`); the
   * frontend mirror module `src/api/constants.ts` is outside this task's write set, so the
   * number stays in the copy for now (flagged in task-9-report.md).
   */
  list: {
    title: 'Projects',
    searchPlaceholder: 'Search by project or brand name',
    showArchived: 'Show archived',
    refresh: 'Refresh',
    newProject: 'New project',
    loadFailed: 'Failed to load the projects',
    hint: 'Tip: type in the tags column and press Enter to add or remove tags (up to 20). “Export” on each row downloads the project JSON (entity card, competitors, assets and prompt library), or the competitors / assets CSV on its own.',
    archived: 'Archived',
    unarchived: 'Unarchived',
    deleted: 'The project was deleted',
    tagsUpdated: 'Tags updated',
    jsonExported: 'The project JSON was exported',
    csvExported: 'The {{label}} CSV was exported',
    competitorsLabel: 'competitors',
    assetsLabel: 'assets',
    exportJsonFileName: '{{brand}}-geo-project.json',
    exportCsvFileName: '{{brand}}-{{label}}.csv',
    deleteConfirmTitle: 'Delete the project “{{name}}”?',
    deleteConfirmContent:
      'The entity card, competitors, assets and prompt library under this project are deleted with it. This cannot be undone.',
  },

  table: {
    name: 'Project',
    brand: 'Brand: {{brand}}',
    aliases: '(aliases: {{aliases}})',
    industry: 'Industry',
    region: 'Region',
    tags: 'Tags',
    tagsPlaceholder: 'Type a tag and press Enter',
    tagsAria: 'Edit tags for {{name}}',
    status: 'Status',
    archived: 'Archived',
    active: 'Active',
    updatedAt: 'Updated',
    openEntityCard: 'Entity card',
    openPrompts: 'Prompts',
    archive: 'Archive',
    unarchive: 'Unarchive',
    export: 'Export',
    deleteHint: 'This cannot be undone',
    empty: 'No projects yet. Use “New project” in the top-right corner to start.',
  },

  industries: {
    b2b_manufacturing: 'B2B manufacturing and industrial goods',
    enterprise_saas: 'Enterprise services / SaaS',
    local_service: 'Local life and professional services',
    cross_border_ecommerce: 'Cross-border e-commerce',
    franchise: 'Franchising',
    other: 'Other industries',
  },

  export: {
    json: 'Project JSON (full)',
    competitorsCsv: 'Competitors CSV',
    assetsCsv: 'Assets CSV',
  },
};

export default project;
