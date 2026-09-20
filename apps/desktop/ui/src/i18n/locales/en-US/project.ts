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
    corePages: 'Core pages',
    corePagesExtra: 'Enter a full URL and press Enter; more than one is fine',

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

  export: {
    json: 'Project JSON (full)',
    competitorsCsv: 'Competitors CSV',
    assetsCsv: 'Assets CSV',
  },
};

export default project;
