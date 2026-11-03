/**
 * Knowledge base (M1.2b) dictionary, en-US mirror of `zh-CN/kb.ts`.
 * Key set must stay identical (parity is asserted by `i18n/dictionary.test.ts`).
 * Compliance (AGENTS rule 6): no absolute claims anywhere in these strings.
 */
const kb = {
  title: 'Knowledge base',
  lead: 'Turn brand facts, cases, selling points, talk tracks, messaging and media into one reusable, editable knowledge set.',
  demoHint: 'Demo mode: sample data only; AI generation does not call a model; images and videos are not fetched.',
  dutyNote:
    'The entity card holds structured facts about who you are; the knowledge base holds reusable wording and assets. They do not sync with each other — use “Import from entity card” for a one-time copy.',
  loadFailed: 'Failed to load the knowledge base',

  stats: {
    modules: 'Modules in use',
    modulesCount: '{{count}}',
    entries: 'Entries',
    scripts: 'Talk tracks',
    pendingReview: 'Pending review',
    unverified: 'Unverified',
    media: 'Media',
  },

  modules: {
    brand: 'Brand overview',
    product: 'Product knowledge',
    selling_point: 'Selling points',
    sales_script: 'Sales talk tracks',
    support_script: 'Support talk tracks',
    case: 'Customer cases',
    competitor: 'Competitor comparison',
    audience: 'Audience and scenarios',
    tone: 'Messaging and compliance',
    qualification: 'Qualifications',
    media: 'Media library',
  },

  modulesHint: {
    brand: 'Who we are: standard name, aliases, founding year and brand story',
    product: 'What we sell: products, specs and pricing wording',
    selling_point: 'Why us: differentiators against local peers',
    sales_script: 'How we sell: reusable talk tracks by sales stage',
    support_script: 'How we answer: response wording by support topic',
    case: 'What we delivered: verifiable customer cases',
    competitor: 'Side by side: competitor names, sites and counter-points',
    audience: 'Who we talk to: target buyers, conditions and decision chains',
    tone: 'How we speak: messaging and compliance red lines',
    qualification: 'Why trust us: certificates, licences and test reports',
    media: 'Evidence: images, videos and documents',
  },

  kinds: {
    statement: 'Statement',
    text: 'Text',
    link: 'Link',
    image: 'Image',
    video: 'Video',
    file: 'Document',
  },

  sources: {
    manual: 'Manual',
    generated: 'AI generated',
    imported: 'Imported',
  },

  scenarios: {
    sales_first_contact: 'First contact',
    sales_needs: 'Needs discovery',
    sales_objection: 'Objection handling',
    sales_quote: 'Quoting',
    sales_closing: 'Closing',
    sales_followup: 'Follow-up',
    support_presale: 'Pre-sales questions',
    support_aftersale: 'After-sales support',
    support_complaint: 'Complaint handling',
    support_return: 'Returns and refunds',
  },

  view: {
    label: 'View',
    group: 'Grouped cards',
    table: 'Table',
    columns: {
      module: 'Module',
      kind: 'Kind',
      title: 'Title',
      scenario: 'Scenario',
      status: 'Status',
      source: 'Source',
      verifiedAt: 'Verified at',
      updatedAt: 'Updated at',
      actions: 'Actions',
    },
  },

  filters: {
    title: 'Filters',
    reset: 'Reset',
    module: 'Module',
    kind: 'Kind',
    status: 'Status',
    source: 'Source',
    all: 'All',
    searchPlaceholder: 'Search title, body or tags',
    noMatch: 'No entry matches the current filters',
    shown: 'Showing {{shown}} / {{total}}',
  },

  entry: {
    add: 'New entry',
    added: 'Added {{added}} entries',
    saved: 'Saved',
    deleted: 'Deleted',
    deleteFailed: 'Delete failed, please retry',
    verified: 'Verified {{selected}} entries',
    copied: 'Copied to clipboard',
    copyFailed: 'Copy failed, please select the text manually',
    empty: 'No knowledge yet',
    emptyBody: 'Start with “New entry” or “Import from entity card”',
    unverified: 'Unverified',
    verifiedAt: 'Verified at {{time}}',
    updatedAt: 'Updated {{time}}',
    expand: 'Expand',
    collapse: 'Collapse',
    preview: 'Preview asset',
    mediaNote: 'Demo mode does not fetch remote media; only the asset card and its address are shown.',
    scenarioLabel: 'Scenario',
  },

  actions: {
    copy: 'Copy',
    edit: 'Edit',
    verify: 'Verify',
    delete: 'Delete',
    deleteConfirm: 'Delete the {{selected}} selected entries? This cannot be undone.',
    batchVerify: 'Verify selected',
    batchDelete: 'Delete selected',
    generate: 'AI generate',
    import: 'Import from entity card',
    exportMarkdown: 'Export Markdown',
    exportJson: 'Export JSON',
    demoModeHint: 'Demo mode: exported content is sample data',
  },

  import: {
    title: 'Import from entity card',
    hint: 'Import is a one-time copy: later edits at the source do not follow into the knowledge base.',
    groupEntity: 'Brand entity card',
    groupProject: 'Project info',
    columnPreview: 'Preview',
    columnModule: 'Target module',
    columnStatus: 'Target status',
    empty: 'Nothing importable in the entity card or project info',
    done: 'Imported {{added}} entries',
    submit: 'Import selected',
    profileTitle: 'Industry, region and tag profile',
  },

  generate: {
    title: 'AI generate knowledge',
    modules: 'Modules to generate into',
    modulesRequired: 'Pick at least one module',
    count: 'Entries',
    submit: 'Generate',
    empty: 'No preset corpus for the selected modules; pick others or add manually',
    done: 'Generated {{added}} entries, pending review',
    demoNote: 'Demo mode does not call a model: rows come verbatim from a preset pool; no compliance scan runs.',
  },

  export: {
    docTitle: 'Brand knowledge base',
    docNote: 'Exported by GDK GEO client; pending-review entries are excluded.',
    markdownTitle: 'Markdown handbook',
    markdownHint: 'A readable version for the content team',
    jsonTitle: 'JSON knowledge pack',
    jsonHint: 'Machine readable, with source and verification metadata',
  },

  editor: {
    titleAdd: 'New entry',
    titleEdit: 'Edit entry',
    module: 'Module',
    kind: 'Kind',
    scenario: 'Talk-track scenario',
    scenarioNone: 'No scenario',
    title: 'Title',
    titleRequired: 'Title is required',
    body: 'Body (Markdown)',
    bodyMediaHint: 'For media entries this holds the caption / note',
    url: 'Address',
    mime: 'Media type',
    tags: 'Tags',
    status: 'Review status',
    submit: 'Save',
  },

  /**
   * Revision history (DR-119): the second tab of the edit side peek, rendered by the **same**
   * `RevisionTimeline` the brand entity card uses.
   * 🔴 The empty state is the knowledge base's own copy (`entity.revisions.empty` belongs to the
   * entity card page and is deliberately not reused).
   */
  revisions: {
    title: 'Revision history',
    // 🔴 Deliberately worded differently from the entity card's `entity.revisions.empty`
    // ("No revisions yet"): this empty state is scoped to **one entry**, and identical copy would
    // make the guard in `KbEntryDrawer` untestable (removing it would stay green).
    empty: 'No revisions for this entry yet',
  },

  /**
   * Labels for the `field_path` values carried by revisions; key names ==
   * `KB_FIELDS[].path` in `components/kb-fields.ts`.
   *
   * 🔴 Kept apart from `editor.*` above even where the wording matches: `editor.*` are input
   * captions in the form, these are ledger labels for "which field changed". They evolve
   * separately (e.g. `verified_at` / `position` are never editable in the form).
   */
  fields: {
    title: 'Title',
    body_markdown: 'Body',
    url: 'Address',
    mime: 'Media type',
    tags: 'Tags',
    status: 'Review status',
    scenario: 'Talk-track scenario',
    verified_at: 'Verified at',
    position: 'Order',
    module: 'Module',
    kind: 'Kind',
  },
};

export default kb;
