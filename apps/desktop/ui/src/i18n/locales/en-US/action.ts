import type { ResourceBundle } from '../../resources';

/**
 * M6 GEO action center (en-US). Keys mirror zh-CN exactly (R-G).
 */
const action: ResourceBundle['action'] = {
  title: 'GEO Action Center',
  subtitle: 'Prescriptions, execution tracking, closed-loop attribution and content production',
  staticNote:
    'The prescription list and the attribution figures are preset static values in demo mode; the frontend neither re-ranks nor recomputes them.',

  list: {
    title: 'Top prescriptions',
    rank: 'Rank',
    category: 'Category',
    actionTitle: 'Prescription',
    rationale: 'Rationale',
    impact: 'Expected impact',
    difficulty: 'Effort',
    owner: 'Suggested owner',
    deliverable: 'Deliverable',
    affectedPrompts: 'Affected prompts',
    affectedEngines: 'Engines involved',
    evidence: 'Linked evidence',
    status: 'Status',
    updatedAt: 'Last updated',
    completedAt: 'Completed at',
    quickWin: 'Doable within an hour',
    quickWinSummary: '{{total}} of them should take less than an hour.',
    markDone: 'Mark as done',
    markInProgress: 'Mark as in progress',
    markTodo: 'Move back to to-do',
    statusOk: 'Prescription status updated',
    generate: 'Generate deliverable',
    // M6.5 Site Connect (spec DR-50): each prescription row gets an entry point into
    // `/projects/:id/site?from=<action_id>`, which auto-opens the generate modal for that row.
    // 🔴 Rows whose category is `source_layout` render it disabled and reuse
    // `site.generate.sourceLayout` for the tooltip, so the compliance-sensitive sentence
    // lives in exactly one place.
    sitePatch: 'Site patch',
    noEvidence: 'This prescription has no linked fact-check issue',
    empty: 'No prescriptions yet.',
  },

  categories: {
    site_structure: 'Site structure',
    source_layout: 'Source layout',
    fact_correction: 'Fact correction',
    content_production: 'Content production',
  },

  statuses: {
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
  },

  contentStatuses: {
    pending_review: 'Pending review',
    approved: 'Approved',
    rejected: 'Returned',
  },

  levels: {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },

  attribution: {
    title: 'Closed-loop attribution',
    baseline: 'Baseline round',
    retest: 'Retest round',
    actions: 'Actions completed in between',
    before: 'Before',
    after: 'After retest',
    change: 'Change',
    metric: 'Metric',
    empty: 'No retest round to attribute yet.',
    note:
      'AI answers vary between runs and the ranges come from repeat sampling; this card is a round-over-round comparison, not proof of causation.',
    metrics: {
      brand_coverage: 'Brand coverage',
      top3_rate: 'Top3 rate',
      fact_error_count: 'Fact error count',
      negative_rate: 'Negative mention rate',
    },
  },

  templates: {
    title: 'Content templates',
    kind: 'Template',
    sections: 'Section structure',
    formats: 'Export formats',
    targets: 'Fits these prescription categories',
    generate: 'Generate draft',
    empty: 'No template available.',
    kinds: {
      qa_article: 'Q&A article',
      comparison_table: 'Comparison table',
      spec_card: 'Spec card',
      case_card: 'Customer case card',
      faq_page: 'FAQ page',
      glossary_page: 'Glossary page',
    },
  },

  templateSections: {
    term_definition: 'Term definition',
    working_principle: 'Working principle',
    selection_guide: 'Selection guide',
    related_terms: 'Related terms',
    references: 'References',
    question: 'Question',
    short_answer: 'Short answer',
    detail: 'Detail',
    faq: 'Follow-up questions',
    sources: 'Sources',
    scope: 'Comparison scope',
    criteria: 'Comparison criteria',
    table: 'Comparison table',
    how_to_read: 'How to read this table',
    model: 'Model',
    parameters: 'Parameters',
    applications: 'Applications',
    certification: 'Certification',
    delivery: 'Delivery time',
    client_context: 'Client context',
    challenge: 'Challenge',
    solution: 'Solution',
    results: 'Results',
    verification: 'Verifiable information',
    faq_price: 'Pricing questions',
    faq_delivery: 'Delivery questions',
    faq_service: 'After-sales questions',
    schema_note: 'Structured data note',
  },

  contents: {
    title: 'Generated drafts',
    contentTitle: 'Title',
    status: 'Review state',
    createdAt: 'Created at',
    updatedAt: 'Last updated',
    action: 'Linked prescription',
    template: 'Template',
    preview: 'Preview',
    approve: 'Approve',
    reject: 'Reject',
    reopen: 'Send back to review',
    statusOk: 'Review state updated',
    generated: 'Demo draft generated; its state is pending review',
    complianceChecked: 'Compliance scan passed',
    complianceUnchecked: 'Demo mode does not run a compliance scan',
    demoBody:
      'The body is a preset demo draft: demo mode calls no model, so this walks through the shape of the deliverable rather than its writing.',
    pendingNote:
      'Generated content is pending review by default and may only be published externally after approval (compliance red line).',
    empty: 'No draft generated yet.',
    noAction: 'Not linked to a prescription',
  },

  export: {
    title: 'Export',
    desktopOnly: '{{format}} is provided by the desktop app and is unavailable in demo mode.',
    done: 'Exported: {{path}}',
    cancelled: 'Export cancelled',
    onlyApproved: 'Only approved content can be exported. Approve pending or rejected drafts first.',
  },
};

export default action;
