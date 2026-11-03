import type { ResourceBundle } from '../../resources';

/**
 * M5 diagnosis and attribution (en-US). Keys mirror zh-CN exactly (R-G).
 *
 * 🔴 Compliance (AGENTS rule 6): the copy talks about visibility, coverage and share of voice
 * only. No ranking promise, no absolute wording.
 */
const diagnosis: ResourceBundle['diagnosis'] = {
  title: 'Diagnosis and Attribution',
  subtitle: 'Overall score, five dimensions, competitor matrix, intent funnel and per-engine differences',
  staticNote:
    'The overall score and the dimension scores are preset static values in demo mode; the frontend does not reweight them.',
  round: 'Round',
  noData: 'No diagnosis result for this round: no conclusion is drawn while collection is incomplete or the sample is too small.',

  score: {
    total: 'GEO health score',
    outOf: 'out of 100',
    margin: '+/-{{value}}',
    marginNote: 'Ratio metrics come with a range from repeat sampling; do not read them as a single point.',
    sample: 'Sample size',
    coverage: 'Brand coverage',
    coverageHint: 'How many prompts produced an answer that mentions this brand',
    sov: 'Share of voice',
    sovHint: 'Mention share within head-to-head prompts',
    factAccuracy: 'Fact accuracy',
    factAccuracyHint: 'Share of brand-related answers whose facts are correct',
    domains: 'Distinct cited domains',
    domainsHint: 'One component of source health',
    metricSpec: 'Metric spec',
    collectedAt: 'Collection finished at',
  },

  dimensions: {
    title: 'Five dimensions',
    dimension: 'Dimension',
    score: 'Score',
    weight: 'Weight',
    sample: 'Sample',
    detail: 'Detail',
    names: {
      visibility: 'Visibility',
      recommendation: 'Recommendation',
      sentiment: 'Sentiment',
      fact_accuracy: 'Fact accuracy',
      source_health: 'Source health',
    },
    weightNote: 'Weights follow appendix C of the product definition; the UI displays them without renormalizing.',
  },

  trend: {
    title: 'Round-over-round trend',
    coverage: 'Brand coverage',
    totalScore: 'Health score',
    factAccuracy: 'Fact accuracy',
    empty: 'No comparable rounds yet.',
    note: 'A running round is excluded from the trend: its spec is incomplete, so plotting it would fake a change.',
    axisRound: 'Round',
    legend: 'Legend',
  },

  alerts: {
    title: 'Alerts',
    empty: 'No alerts.',
    acknowledge: 'Mark as read',
    unacknowledge: 'Mark as unread',
    acknowledged: 'Read',
    acknowledgeOk: 'Alert state updated',
    raisedAt: 'Raised at',
    metric: 'Metric',
    delta: 'Delta',
    engine: 'Engine',
    round: 'Round',
    severities: {
      info: 'Info',
      warning: 'Warning',
      critical: 'Critical',
    },
    kinds: {
      coverage_drop: 'Coverage drop',
      negative_sentiment: 'Negative mention',
      fact_error: 'Fact error',
      competitor_overtake: 'Competitor overtake',
    },
    metrics: {
      brand_coverage: 'Brand coverage',
      fact_error_count: 'Fact error count',
      negative_rate: 'Negative mention rate',
      share_of_voice: 'Share of voice',
    },
  },

  competitors: {
    title: 'Competitor matrix',
    sample: 'Sample size',
    headToHead: 'Head-to-head prompts',
    headToHeadNote:
      'Share of voice is divided by the {{total}} prompts where several brands appear together, not by all prompts.',
    brand: 'Brand',
    self: 'This brand',
    coverage: 'Coverage',
    shareOfVoice: 'Share of voice',
    top1Rate: 'Top1 rate',
    top3Rate: 'Top3 rate',
    mentionOnlyRate: 'Mention-only rate',
    positiveRate: 'Positive rate',
    negativeRate: 'Negative rate',
    factErrorCount: 'Fact errors',
    citedDomainCount: 'Cited domains',
    empty: 'No competitor matrix for this round.',
  },

  funnel: {
    title: 'Intent funnel',
    stage: 'Stage',
    promptCount: 'Prompts',
    mentionRate: 'Mention rate',
    top3Rate: 'Top3 rate',
    note: 'Diagnosis note',
    empty: 'No funnel data for this round.',
    smallDenominator: 'This stage has only {{total}} prompts, so the ratios swing widely.',
    stages: {
      awareness: 'Awareness',
      recommendation: 'Recommendation',
      decision: 'Decision',
    },
  },

  engines: {
    title: 'Per-engine differences',
    note: 'Sorted by fact error rate, descending: see first which engines get this brand wrong most often.',
    engine: 'Engine',
    sample: 'Sample',
    coverage: 'Coverage',
    top3Rate: 'Top3 rate',
    positiveRate: 'Positive rate',
    factErrorRate: 'Fact error rate',
    successRate: 'Collection success rate',
    avgLatency: 'Average latency',
    empty: 'No per-engine data for this round yet.',
  },
};

export default diagnosis;
