import type { ResourceBundle } from '../../resources';

/** 品牌实体卡。键集由 zh-CN 侧钉死（R-G），键名逐字等于 `FieldDescriptor.path`。 */
const entity: ResourceBundle['entity'] = {
  fields: {
    standard_name: 'Standard name',
    aliases: 'Brand aliases',
    founded_year: 'Year founded',
    qualifications: 'Qualifications',
    products: 'Products and specs',
    // 🔴 The four labels below are **retired card fields** (spec 2026-10-01 · DR-59 / DR-62):
    // price moved into `products[].price`, and cases / differentiators / official messaging moved
    // into the knowledge base. The labels stay because the Rust backend still has those 11 fields,
    // so historical revisions and fact-check records still carry those `field_path` values —
    // without a label they would render as raw machine tokens.
    price_range: 'Price range',
    service_regions: 'Service regions',
    cases: 'Client cases',
    differentiators: 'Differentiators',
    official_tone: 'Official messaging',
    contact: 'Contact',
  },

  fieldStatuses: {
    official: 'Official',
    pending: 'Unconfirmed',
    disputed: 'Conflicting',
  },

  fieldStatusHint: {
    official: 'Matches official messaging; ready to use for content production',
    pending: 'AI-extracted or awaiting human confirmation; verify before use',
    disputed: 'Conflicts with public information; needs a human decision',
  },

  revisions: {
    empty: 'No revisions yet',
  },

  fieldCard: {
    optional: '(optional)',
    jsonParseFailed: 'Could not parse the JSON: {{detail}}',
    tagsPlaceholder: 'Type and press Enter to add',
    yearPlaceholder: 'e.g. 2006',
  },

  autobuild: {
    title: 'Auto-build from domain',
    scopeHint: 'Own domain only, respects robots.txt, up to 8 pages',
    domainPlaceholder: 'e.g. www.hongyu-pump.com',
    submit: 'Auto-build',
    running: 'Crawling the site and extracting the entity card…',
    emptyDomain: 'Enter the website domain to crawl, e.g. www.example.com',
    success: 'Auto-build finished; field completeness {{percent}}%',
  },

  card: {
    title: 'Brand Entity Card',
    loadFailed: 'Failed to load the entity card',
    fieldUpdated: 'Field updated and the revision was recorded',
    empty: 'No entity card yet. Use “Auto-build” above with your website to create one.',
    completeness: 'Field completeness',
    sourceAi: 'AI-extracted: {{provider}} {{model}}',
    sourceManual: 'Entered by hand',
    revisions: 'Revision history',
  },
};

export default entity;
