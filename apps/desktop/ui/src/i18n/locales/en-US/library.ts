import type { ResourceBundle } from '../../resources';

/**
 * Keyword library / FAQ library (en-US).
 *
 * Annotated as `ResourceBundle['library']` so the zh/en key sets must be identical at
 * `tsc -b` time (ruling R-G): a missing or extra key fails the build.
 *
 * ⚠ No CJK on this side: the `EN_DICT_CJK` guard in `pages/en-us-page-residual.test.tsx`
 * pins the deliberate exceptions to exactly two entries, neither of which belongs here.
 */
const library: ResourceBundle['library'] = {
  kinds: {
    core: 'Core term',
    long_tail: 'Long-tail term',
    brand: 'Brand term',
    competitor: 'Competitor term',
    question: 'Question term',
  },

  sources: {
    manual: 'Manual entry',
    generated: 'AI generated',
    imported: 'Bulk import',
  },

  columns: {
    intent: 'Intent',
    status: 'Status',
    source: 'Source',
    note: 'Note',
    search: 'Webmaster data',
    updatedAt: 'Updated',
    category: 'Category',
    // Per-row accessible name for the inline review-state Select (mirrors `prompt.table.weightAria`).
    statusAria: 'Review status for {{text}}',
  },

  filters: {
    allKinds: 'All kinds ({{total}})',
    allStatuses: 'All statuses',
    allSources: 'All sources',
    allCategories: 'All categories ({{total}})',
    allIntents: 'All intents ({{total}})',
    uncategorized: 'Uncategorized',
    kindAria: 'Filter by kind',
    statusAria: 'Filter by status',
    sourceAria: 'Filter by source',
    categoryAria: 'Filter by category',
    intentAria: 'Filter by intent',
    filtered: 'Showing {{shown}} of {{total}}',
  },

  actions: {
    add: 'Add manually',
    generate: 'Generate with AI',
    reference: 'Reference in Prompt Library',
    deleteSelected: 'Delete selected',
    deleteSelectedCount: 'Delete selected ({{selected}})',
    exportCsv: 'Export CSV',
    exportJsonLd: 'Export FAQPage JSON-LD',
    demoModeHint: 'In demo mode the export goes through the browser download; the file name is echoed in the toast.',
  },

  keyword: {
    title: 'Keyword Library',
    subtitle:
      'Core, long-tail, brand, competitor and question terms, ready to reference for site optimization or the Prompt Library',
    staticNote:
      'Monthly volume and competition difficulty are preset static values in demo mode; the frontend neither fetches nor computes them.',
    empty: 'No keywords yet. Add them manually or generate a batch with AI.',
    text: 'Keyword',
    kind: 'Kind',
    monthlyVolume: 'Monthly volume',
    difficulty: 'Competition',
    priority: 'Priority',
    searchPlaceholder: 'Search keywords',
    searchAria: 'Search keywords',
    textPlaceholder: 'e.g. baghouse dust collector manufacturer',
    addTitle: 'Add keyword',
    editTitle: 'Edit keyword',
    generateTitle: 'Generate keywords with AI',
    kindsLabel: 'Which kinds',
    targetCountLabel: 'How many',
    demoBody:
      'Demo mode does not call a model: results come from a preset corpus pool, so review the shape of the output (kind, intent, review state) rather than the term quality.',
    generated: 'Generated {{total}} keywords',
    generatedNone:
      'The preset corpus pool has no new terms for these kinds. Pick other kinds or add them manually.',
    saved: 'Keyword saved',
    deleted: 'Deleted {{total}} keywords',
    deleteConfirmTitle: 'Delete keywords',
    deleteConfirmContent: 'This deletes {{total}} keywords and cannot be undone.',
    requiredText: 'Enter the keyword text',
    priorityAria: 'Priority {{text}}',
  },

  faq: {
    title: 'FAQ Library',
    subtitle:
      'Question and answer pairs you can export as FAQPage structured data for your site, or reference in the Prompt Library',
    staticNote:
      'AI-generated answers come from a preset corpus in demo mode and have not been compliance-scanned; review them before adopting.',
    empty: 'No FAQ entries yet. Add them manually or generate a batch with AI.',
    question: 'Question',
    answer: 'Answer',
    answerPreview: 'Answer preview',
    searchPlaceholder: 'Search questions or answers',
    searchAria: 'Search FAQ entries',
    questionPlaceholder: 'e.g. How do I choose between a baghouse and a cartridge collector?',
    answerPlaceholder:
      'Write it as conclusion, evidence, applicable conditions. The answer goes into the JSON-LD verbatim.',
    addTitle: 'Add FAQ entry',
    editTitle: 'Edit FAQ entry',
    generateTitle: 'Generate FAQ entries with AI',
    intentsLabel: 'Which intents to cover',
    targetCountLabel: 'How many',
    demoBody:
      'Demo mode does not call a model: entries come from a preset corpus pool, so review the shape of the output (category, intent, review state, JSON-LD) rather than the wording.',
    generated: 'Generated {{total}} FAQ entries',
    generatedNone:
      'The preset corpus pool has no new entries for these intents. Pick other intents or add them manually.',
    saved: 'FAQ entry saved',
    deleted: 'Deleted {{total}} FAQ entries',
    deleteConfirmTitle: 'Delete FAQ entries',
    deleteConfirmContent: 'This deletes {{total}} FAQ entries and cannot be undone.',
    requiredQuestion: 'Enter the question',
    requiredAnswer: 'Enter the answer',
    complianceUnchecked: 'Not compliance-scanned in demo mode',
    exportDisabled:
      'Nothing to export: the JSON-LD only includes entries that passed review.',
    jsonldTitle: 'FAQPage structured data preview',
    jsonldHint:
      'Put this JSON-LD in the head of the page so search engines and AI assistants can read the Q&A pairs directly.',
    jsonldIncluded: 'Includes {{total}} approved entries',
  },

  reference: {
    title: 'Reference in Prompt Library',
    targetSet: 'Target prompt set',
    targetSetPlaceholder: 'Choose a prompt set',
    noSets:
      'This project has no prompt set yet. Generate or create one on the Prompt Library page first, then come back.',
    willAdd: 'This adds {{total}} prompts',
    // Split per material type (mirrors zh-CN): the weight half differs, since FAQ entries have
    // no priority field and fall back to the prompt-set default (DR-43).
    keywordMappingNote:
      'The keyword text becomes the prompt, the intent is carried over, and the keyword priority becomes the weight; group and tags stay empty.',
    faqMappingNote:
      'The question becomes the prompt, the intent is carried over, and the weight falls back to the prompt-set default; group and tags stay empty.',
    sourceNote:
      'Referenced items are recorded as manual entries: the AI-generated mark from the library is not carried into the prompt set.',
    confirm: 'Reference',
    done: 'Referenced {{total}} prompts into {{label}}',
    needSelection: 'Select the items to reference first',
  },

  export: {
    title: 'Export preview',
    fileName: 'File name',
    download: 'Download',
    downloaded: 'Exported: {{path}}',
    lines: '{{total}} lines',
  },
};

export default library;
