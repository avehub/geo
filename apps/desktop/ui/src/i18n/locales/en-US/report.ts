import type { ResourceBundle } from '../../resources';

/**
 * M7 reports and sharing (en-US). Keys mirror zh-CN exactly (R-G).
 *
 * 🔴 `disclaimer` ships in every variant: the report is forwarded to executives and clients,
 * so the sampling caveat and the explicit "no ranking promise" wording must not be dropped.
 */
const report: ResourceBundle['report'] = {
  title: 'Reports and Sharing',
  settingsTitle: 'Report settings',
  subtitle: 'One data set, three tellings: executive, detailed and white label',
  staticNote: 'The figures in a report come from the static diagnosis spec; demo mode does not recompute them.',
  round: 'Round',
  render: 'Render report',
  empty: 'Pick a finished collection round, then render the report.',
  roundUnavailable: 'Queued, running and failed rounds cannot produce a report.',
  includeEvidence: 'Include the evidence appendix',
  evidenceHint:
    'The appendix carries raw answer excerpts, engines and collection timestamps, so you can back the numbers up with an executive or a client.',

  variants: {
    executive: 'Executive',
    detailed: 'Detailed',
    white_label: 'White label',
  },

  variantHints: {
    executive: 'One page: conclusion, three numbers, next steps',
    detailed: 'Adds coverage detail, competitor matrix, per-engine differences, funnel, fact check and prescriptions',
    white_label: 'Agency branding, without the funnel and fact-check detail',
  },

  titleOf: {
    executive: '{{brand}} - GEO health brief ({{round}})',
    detailed: '{{brand}} - GEO health report, detailed ({{round}})',
    white_label: '{{brand}} - GEO health report ({{round}})',
  },

  headline: 'Key numbers',
  nextSteps: 'Next steps',

  csvHeader: {
    metric: 'Metric',
    value: 'Value',
    delta: 'Delta',
  },

  sections: {
    conclusion: 'Conclusion',
    coverage: 'Coverage detail',
    competitors: 'Competitor matrix',
    engines: 'Per-engine differences',
    funnel: 'Intent funnel',
    fact_check: 'Fact-check detail',
    actions: 'Prescription summary',
    evidence: 'Evidence appendix',
  },

  metrics: {
    brand_coverage: 'Brand coverage',
    total_score: 'GEO health score',
    sample_size: 'Sample size',
    success_rate: 'Collection success rate',
    share_of_voice: 'Share of voice',
    fact_accuracy: 'Fact accuracy',
    fact_error_count: 'Fact error count',
    top3_rate: 'Top3 rate',
    negative_rate: 'Negative mention rate',
    distinct_cited_domains: 'Distinct cited domains',
  },

  columns: {
    prompt_text: 'Prompt',
    engine: 'Engine',
    collected_at: 'Collected at',
    mention: 'Mentioned',
    rank: 'Rank',
    answer_excerpt: 'Answer excerpt',
    brand: 'Brand',
    coverage: 'Coverage',
    share_of_voice: 'Share of voice',
    top3_rate: 'Top3 rate',
    sentiment: 'Sentiment',
    fact_error_count: 'Fact errors',
    fact_error_rate: 'Fact error rate',
    success_rate: 'Collection success rate',
    avg_latency_ms: 'Average latency',
    title: 'Prescription',
    category: 'Category',
    impact: 'Expected impact',
    status: 'Status',
    stage: 'Funnel stage',
    prompt_count: 'Prompts',
    mention_rate: 'Mention rate',
  },

  methodology: {
    title: 'Methodology',
    round: 'Round',
    sampleSize: 'Sample size',
    grade: 'Sample size grade',
    collectedAt: 'Collection finished at',
    engines: 'Engines',
    modelVersions: 'Model versions',
    promptSet: 'Prompt library',
    promptSetVersion: 'Prompt library version',
    metricSpec: 'Metric spec version',
    repeatCount: 'Repeat sampling',
    repeatNote: 'Key prompts were sampled {{times}} times: ratio metrics are ranges, not single points.',
    insufficientNote:
      'The sample is below the minimum, so this report is directional only and carries no precise score.',
  },

  whiteLabel: {
    title: 'White label',
    agencyName: 'Agency name',
    contact: 'Contact',
    logoUrl: 'Logo URL',
    logoOptional: 'Leave empty to omit the logo',
    defaultHint: 'Leave all three empty to use the default signature (the sample agency in the demo data).',
    applyHint: 'Click "Render report" after editing the white-label details.',
    none: 'No branding',
    preparedBy: 'Prepared by {{agency}}',
  },

  disclaimer:
    'This report is based on sampled collection and a fixed metric spec. It describes how visible this brand is in AI answers and how well the content fits them; it is not a promise about search or AI ranking outcomes.',

  export: {
    title: 'Export and sharing',
    desktopOnly: '{{format}} is provided by the desktop app and is unavailable in demo mode.',
    done: 'Exported: {{path}}',
    cancelled: 'Export cancelled',
    generatedAt: 'Generated at',
    copy: 'Copy body',
    copied: 'Copied to the clipboard',
  },
};

export default report;
