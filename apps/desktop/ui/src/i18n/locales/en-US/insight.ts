import type { ResourceBundle } from '../../resources';

/**
 * M4 answer parsing and fact checking (en-US). Keys mirror zh-CN exactly (R-G).
 */
const insight: ResourceBundle['insight'] = {
  title: 'Answer Parsing and Fact Check',
  subtitle: 'Structured extraction plus three classes of factual issues, each traceable to the raw answer',
  sampleOnly: 'Demo data covers sample records only, for both insights and fact-check issues.',
  staticNote:
    'Confidence scores, source classification and accuracy rates are preset static values in demo mode.',
  round: 'Round',
  /** Accessible name for the round picker (the placeholder disappears once a round is chosen). */
  roundAria: 'Select round',
  tabs: {
    insights: 'Insights',
    factCheck: 'Fact check',
  },

  list: {
    prompt: 'Prompt',
    engine: 'Engine',
    mentioned: 'This brand',
    rank: 'Recommendation rank',
    sentiment: 'Sentiment',
    confidence: 'Confidence',
    needsReview: 'Needs review',
    reviewed: 'Reviewed',
    risks: 'Risk flags',
    corrected: 'Manually corrected',
    shape: 'Answer shape',
    sources: 'Citation sources',
    openEvidence: 'View evidence',
    correct: 'Correct',
    empty: 'No insight matches the current filters.',
    reviewedAt: 'Reviewed at',
    confidenceFloor: 'Records below {{floor}} confidence go into the manual review queue.',
  },

  filters: {
    engine: 'Engine',
    /** Accessible names for the four filters (same reason as `insight.roundAria`). */
    engineAria: 'Filter by engine',
    review: 'Review state',
    reviewAria: 'Filter by review state',
    needsReviewOnly: 'Needs review only',
    mentioned: 'Mention',
    mentionedAria: 'Filter by mention',
    mentionedOnly: 'Mentioned only',
    notMentionedOnly: 'Not mentioned only',
    risk: 'Risk flag',
    riskAria: 'Filter by risk flag',
    all: 'All',
    reset: 'Clear filters',
  },

  shape: {
    hasConclusion: 'Gives a conclusion',
    hasTable: 'Has a comparison table',
    asksBack: 'Asks a clarifying question',
    refused: 'Refused to answer',
    plain: 'Plain narrative',
  },

  risks: {
    regulated_claim: 'Regulated claim',
    absolute_wording: 'Absolute wording',
    suspected_hallucination: 'Suspected fabrication',
    negative_buzz: 'Negative buzz',
  },

  mentions: {
    title: 'Brand mention detail',
    brand: 'Brand',
    role: 'Role',
    count: 'Mentions',
    sentiment: 'Sentiment',
    rank: 'Rank',
    inTable: 'In comparison table',
    excerpt: 'Answer excerpt',
    empty: 'This answer does not mention any brand.',
  },

  roles: {
    self: 'This brand',
    competitor: 'Competitor',
    other: 'Other brand',
  },

  correctedFields: {
    self_mentioned: 'Mentioned or not',
    self_rank: 'Recommendation rank',
    self_sentiment: 'Sentiment',
  },

  correct: {
    title: 'Manual correction',
    mentioned: 'Mentions this brand',
    rank: 'Recommendation rank',
    rankPlaceholder: 'Leave empty if it is not in the recommendation list',
    rankInvalid: 'The recommendation rank must be an integer of 1 or greater',
    sentiment: 'Sentiment',
    submit: 'Submit correction',
    ok: 'Correction recorded; this record left the review queue',
    demoNotice:
      'A correction only changes this record and its projection on the evidence row; no ratio is recomputed in demo mode.',
    excerpt: 'Answer excerpt',
  },

  factCheck: {
    title: 'Fact check',
    summary: 'Summary',
    checkedAnswers: 'Answers checked',
    accuracy: 'Fact accuracy',
    accuracyNote:
      'Accuracy is a static figure from collection time: resolving issues manually does not change it, because demo mode does not recompute.',
    falsePositives: 'Marked as false positives',
    byKind: 'Issues by class',
    noSummary: 'This round has no publishable fact-check summary (no accuracy figure when the sample is too small).',
    issues: 'Issue list',
    kind: 'Class',
    field: 'Entity card field',
    answerExcerpt: 'What the answer said',
    entityValue: 'Entity card value',
    confidence: 'Confidence',
    status: 'Status',
    channel: 'Correction channel',
    note: 'Resolution note',
    notePlaceholder: 'Record where you fixed it and what it says now (optional)',
    resolvedAt: 'Resolved at',
    resolve: 'Resolve',
    markCorrected: 'Mark as corrected',
    markFalsePositive: 'Mark as false positive',
    reopen: 'Reopen',
    resolveOk: 'Fact-check issue updated',
    empty: 'No fact-check issues in this round.',
    openEvidence: 'View evidence',
  },

  kinds: {
    wrong: 'Stated incorrectly',
    outdated: 'Outdated',
    missing: 'Omitted',
  },

  issueStatuses: {
    open: 'Open',
    false_positive: 'False positive',
    corrected: 'Corrected',
  },

  channels: {
    official_site: 'Official website',
    baike_entry: 'Encyclopedia entry',
    third_party_page: 'Third-party page',
    service_script: 'Support script',
    business_directory: 'Business directory',
  },
};

export default insight;
