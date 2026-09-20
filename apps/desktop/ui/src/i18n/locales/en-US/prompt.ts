import type { ResourceBundle } from '../../resources';

/**
 * Prompt 题库。键集由 zh-CN 侧钉死（R-G）。
 *
 * `csv.reasons.not_allowed` 是**独立的合规模板**，刻意不含 `{{value}}`：CSV 导入里这个 reason
 * 只可能来自广告法红线检查，`params.value` 装的是命中的红线词（复审 F-3a）。
 * `csv.reasons.*` 住在 `prompt` 而不是 `errors` namespace 的理由见 zh-CN 侧同名文件的注释。
 */
const prompt: ResourceBundle['prompt'] = {
  generate: {
    title: 'Generate prompt library',
    targetCount: 'Target count',
    repeatCount: 'Repeat sampling',
    industry: 'Industry template',
    intents: 'Intent coverage',
    submit: 'Generate',
    pipeline:
      'Pipeline: template expansion → AI expansion → colloquial rewriting → competitor pairing → dedupe → versioned snapshot',
  },

  sampleSize: {
    detail:
      'This library has {{total}} prompts. Reach {{target}} or more before reporting scores externally.',
  },

  table: {
    intent: 'Intent',
    weight: 'Weight',
    weightAria: 'Weight for {{text}}',
    group: 'Group',
    tags: 'Tags',
    source: 'Source',
    competitors: 'Paired competitors',
    repeatCount: 'Sampling',
    repeatCountAria: 'Sampling repeats for {{text}}',
    deleteHint: 'This cannot be undone; export a CSV backup first',
    empty: 'The library is empty. Use “Generate” above to start.',
  },

  editor: {
    addTitle: 'Add prompt',
    editTitle: 'Edit prompt',
    text: 'Prompt text',
    textRequired: 'Enter the prompt text',
    textTooLong: 'Cannot exceed {{max}} characters',
    intent: 'Intent',
    intentRequired: 'Select an intent',
    weight: 'Weight',
    weightTooltip: '1–5, core-keyword weighting; higher is collected first',
    repeatCount: 'Sampling repeats',
    repeatCountTooltip: '1–3; how many times this prompt is asked during P0-B collection',
    group: 'Group',
    groupTooltip: 'Leave blank to group by intent automatically',
    groupPlaceholder: 'Blank groups by intent',
    tags: 'Tags',
    tagsTooltip:
      'Press Enter to add. Tags applied by the pipeline (such as “competitor pairing”) can also be edited here.',
    tagsPlaceholder: 'Type a tag and press Enter',
  },

  competitors: {
    intro:
      'List {{min}}–{{max}} direct competitors. The library auto-generates “brand vs competitor” prompts, which feed the Share of Voice calculation.',
    tooFew: 'List at least {{min}} competitors (currently {{current}})',
    tooFewDetail:
      'With too few competitors the “brand comparison” prompts cannot be covered, so the SOV metric is unavailable.',
    tooMany: 'No more than {{max}} competitors',
    nameTooLong: 'The competitor name cannot exceed {{max}} characters',
    namePlaceholder: 'Competitor name',
    websitePlaceholder: 'Competitor website (optional)',
    removeAria: 'Remove this competitor',
    add: 'Add competitor',
  },

  csv: {
    export: 'Export CSV',
    import: 'Import CSV',
    exportPreviewTitle: 'Export CSV preview',
    download: 'Download file',
    exported: 'CSV exported: {{path}}',
    exportHint:
      '{{lines}} rows ({{columns}} header columns), UTF-8 with BOM, opens directly in Excel.',
    confirmImport: 'Confirm import',
    emptyWarning: 'Paste the CSV content first',
    importHint:
      'The header must be: {{header}}. Importing replaces the current library items and produces a new content hash.',
    importPlaceholder:
      'text,intent,weight,group_name,tags,source,repeat_count\nIs HongYu Pump reliable?,purchase_recommendation,3,purchase recommendation,,manual,1',
    importSummary: 'Imported {{imported}} items; {{failed}} rows failed',
    rowError: 'Row {{row}}: {{detail}}',
    reasons: {
      required: 'the required prompt text is empty',
      too_long: 'the prompt text exceeds the {{limit}}-character limit',
      not_allowed: 'contains a prohibited advertising claim; revise it and submit again',
      invalid_format: 'this cell is not in a valid format',
      out_of_range: 'the value is outside the allowed range ({{expected}})',
    },
  },

  promptSet: {
    title: 'Prompt Library',
    loadFailed: 'Failed to load the prompt library',
    empty: 'No prompt library yet. Set the generation parameters and start a generation; the system produces 60–100 conversational Chinese prompts covering the 7 intent categories and saves them as a version snapshot with a content hash.',
    version: 'Version {{version}}',
    itemCount: '{{total}} items',
    contentHash: 'Content hash {{hash}}',
    metricSpec: 'Metric spec {{spec}}',
    dedupe: 'Check duplicates',
    dedupeSummary: 'Duplicate pairs: {{pairs}}; merged and removed: {{removed}}; kept: {{kept}}',
    generated: 'Generated {{total}} prompts (version {{version}})',
    added: 'Added 1 item; the library now has {{total}}',
    removed: 'Deleted {{deleted}} items; {{total}} remain',
    updated: 'Updated',
    addPrompt: 'Add prompt',
    deleteSelected: 'Delete selected',
    deleteSelectedCount: 'Delete selected ({{selected}})',
    deleteConfirmTitle: 'Delete the {{total}} selected prompts?',
    deleteConfirmContent:
      'The content hash and the sample-size grade are recomputed after deletion, and this cannot be undone (export a CSV backup first if you need one).',
    deleteConfirmOk: 'Delete',
    filtered: 'Showing {{shown}} of {{total}}',
    intentFilterAll: 'All ({{total}})',
    groupFilterAll: 'All groups',
    groupFilterNoGroup: 'Ungrouped',
    groupFilterAria: 'Filter by group',
    sourceFilterAll: 'All sources',
    sourceFilterAria: 'Filter by source',

    notes: {
      degraded:
        '{{stage}} did not succeed; this batch was filled in from industry templates and local rewriting ({{detail}})',
      stage: {
        expansion: 'AI expansion',
        rewrite: 'Colloquial rewriting',
      },
    },
  },
};

export default prompt;
