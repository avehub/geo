/**
 * Article Studio (M6 content production) dictionary, en-US mirror of `zh-CN/article.ts`.
 * Key set must stay identical (parity is enforced by `ResourceBundle['article']` at compile time
 * and asserted by `i18n/dictionary.test.ts`).
 * Compliance (AGENTS rule 6): no absolute claims anywhere in these strings.
 *
 * 🔴 The two always-on demo notices (`demoHint` and `schedules.demoBody`) state the limits from
 * DR-85: there is no cron and no model call in demo mode, so `next_run_at` is a display value and
 * generated drafts come verbatim from the preset corpus pool.
 */
import type { ResourceBundle } from '../../resources';

const article: ResourceBundle['article'] = {
  title: 'Article Studio',
  lead: 'Decide what to write (directions), decide how to ask the model (templates), let a schedule produce drafts on a cycle, then review them by hand.',
  demoHint:
    'Demo mode: directions, templates and articles are preset samples. AI generation does not call a model, schedules do not fire on their own, and a reload resets everything.',
  loadFailed: 'Failed to load Article Studio',

  tabs: {
    directions: 'Directions',
    templates: 'Prompt templates',
    pipeline: 'Schedule and articles',
  },

  slots: {
    brand: 'Brand',
    product: 'Product',
    keyword: 'Keyword',
    audience: 'Audience',
    scenario: 'Scenario',
    competitor: 'Competitor',
  },

  freqs: {
    daily: 'Daily',
    weekly: 'Weekly',
  },

  statuses: {
    pending_review: 'Pending review',
    approved: 'Approved',
    rejected: 'Rejected',
  },

  sources: {
    manual: 'Manual',
    generated: 'AI generated',
    scheduled: 'Scheduled run',
  },

  weekdays: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  },

  directions: {
    hint: 'A direction answers what to write and for whom. Several prompt templates can hang off one direction, and a schedule then references a template.',
    empty: 'No directions yet. Add one by hand, or let the AI generate a batch to pick from.',
    add: 'Add direction',
    generate: 'Generate with AI',
    addTitle: 'New content direction',
    titleLabel: 'Direction title',
    titlePlaceholder: 'e.g. How to write a sizing guide',
    summaryLabel: 'Scenario summary',
    summaryPlaceholder:
      'One sentence on the audience and the situation. It also feeds the scenario slot in the template preview.',
    titleRequired: 'Enter a direction title first',
    ok: 'Save',
    archive: 'Archive',
    restore: 'Restore',
    statusArchived: 'Archived',
    templateCount: '{{total}} templates',
    articleCount: '{{total}} articles',
    saved: 'Direction saved',
    archived: 'Direction archived',
    restored: 'Direction restored',
    generated: 'Generated {{total}} directions',
    generatedNone: 'The preset direction pool is exhausted. Add one by hand, or reload to reset the samples.',
    generateDemoBody:
      'Demo mode does not call a model: generated directions come verbatim from the preset corpus pool, de-duplicated by title.',
  },

  templates: {
    hint: 'A template answers how to ask the model. Use slot tokens in the body and click a slot button to insert one at the caret.',
    empty: 'No prompt templates yet. Define a direction first, then come back and create a template.',
    create: 'New template',
    edit: 'Edit',
    delete: 'Delete',
    deleteTitle: 'Delete template',
    deleteCascade:
      'Deleting a template also deletes the schedules bound to it. Articles already generated stay in the review queue. This cannot be undone.',
    deleteOk: 'Delete',
    deleted: 'Deleted {{total}} templates',
    saved: 'Template saved',
    runNow: 'Generate now',
    generated: 'Generated {{total}} drafts for review',
    generatedNone: 'The preset article pool is exhausted: nothing new to generate. Reload to reset the samples.',
    columns: {
      name: 'Template',
      direction: 'Direction',
      slots: 'Slots',
      style: 'Style',
      length: 'Target words',
      updatedAt: 'Updated',
    },
    editor: {
      createTitle: 'New prompt template',
      editTitle: 'Edit prompt template',
      nameLabel: 'Template name',
      nameRequired: 'Enter a template name first',
      directionLabel: 'Direction',
      directionRequired: 'Pick a direction first',
      promptLabel: 'Prompt body',
      promptAria: 'Prompt body',
      promptRequired: 'Enter a prompt body first',
      slotsLabel: 'Click to insert a slot',
      slotsHint: 'The slot token is inserted at the caret. Inserting the same slot twice keeps both tokens.',
      previewLabel: 'Live preview',
      previewAria: 'Live preview',
      previewHint:
        'The preview replaces slots with the real project values. A slot that has no value keeps its token, so you can see which one is still unbound.',
      wordCount: 'Preview words {{total}}',
      kbModules: 'Referenced knowledge modules',
      kbModulesHint:
        'References are recorded only: demo mode does not splice knowledge entries into the prompt. The real generation pipeline does that.',
      bindingsLabel: 'Bound material',
      productNamesLabel: 'Product names',
      productNamesPlaceholder: 'Type a product name and press Enter',
      keywordTextsLabel: 'Keywords',
      keywordTextsPlaceholder: 'Type a keyword and press Enter',
      audienceLabel: 'Audience',
      audiencePlaceholder: 'e.g. Plant engineers at cement works',
      styleLabel: 'Style',
      stylePlaceholder: 'e.g. Technical explainer',
      lengthLabel: 'Target words',
      ok: 'Save',
    },
  },

  schedules: {
    title: 'Generation schedule',
    demoBody:
      'Demo mode runs no real scheduled jobs: the next run time is a display value derived from the frequency and time, and nothing is produced when it passes. Use “Run now” to see the result immediately.',
    empty: 'No schedules yet. Create one to bind a template and pick a frequency.',
    create: 'New schedule',
    edit: 'Edit',
    runNow: 'Run now',
    ran: 'Generated {{total}} drafts for review',
    ranNone: 'The preset article pool is exhausted: this run produced nothing and was not counted.',
    saved: 'Schedule saved',
    columns: {
      template: 'Template',
      freq: 'Frequency',
      time: 'Run time',
      nextRun: 'Next run',
      lastRun: 'Last run',
      runCount: 'Runs',
      enabled: 'Enabled',
    },
    enabledAria: 'Enable schedule {{name}}',
    editor: {
      createTitle: 'New generation schedule',
      editTitle: 'Edit generation schedule',
      templateLabel: 'Template',
      templateRequired: 'Pick a template to bind',
      freqLabel: 'Frequency',
      timeLabel: 'Run time',
      weekdayLabel: 'Weekday',
      weekdayRequired: 'A weekly schedule needs a weekday',
      enabledLabel: 'Enable this schedule',
      ok: 'Save',
    },
  },

  review: {
    title: 'Article review queue',
    hint: 'Everything generated goes through human review first: only approved articles reach the export, so drafts and rejected items are never treated as deliverables.',
    empty: 'No articles yet. Use “Generate now” on a template, or “Run now” on a schedule.',
    filterAria: 'Filter by review status',
    filterAll: 'All statuses',
    approveCount: 'Approve selected ({{selected}})',
    approved: 'Approved {{total}} articles',
    rejectCount: 'Reject selected ({{selected}})',
    rejected: 'Rejected {{total}} articles',
    needSelection: 'Select the articles to review first',
    export: 'Export Markdown',
    exportDisabled: 'No approved article to export: the Markdown book only includes drafts that passed human review.',
    preview: 'Preview',
    previewAria: 'Article body',
    complianceUnchecked: 'Demo mode ran no compliance scan',
    bodyHint: 'The body is shown as raw Markdown, not rendered to HTML: data is not markup, the same rule as FAQ answers.',
    meta: {
      direction: 'Direction',
      template: 'Template',
      source: 'Source',
      status: 'Status',
      words: 'Words',
      generatedAt: 'Generated',
    },
    columns: {
      title: 'Title',
      direction: 'Direction',
      template: 'Template',
      source: 'Source',
      status: 'Status',
      words: 'Words',
      generatedAt: 'Generated',
    },
  },

  export: {
    markdownTitle: 'Export the Markdown article book',
    markdownHint: 'A version the content team can read directly; only approved articles are included.',
    docTitle: 'Generated article book',
    docNote: 'Exported from the GEO desktop client. Pending and rejected articles are not included.',
    metaLine: 'Generated {{time}} · {{words}} words',
  },
};

export default article;
