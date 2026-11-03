import type { ResourceBundle } from '../../resources';

/**
 * M9 portfolio overview. Counts + distributions + per-project rows only —
 * ratios are never averaged across projects (their denominators differ).
 */
const portfolio: ResourceBundle['portfolio'] = {
  title: 'Portfolio Overview',
  subtitle: 'GEO results, risks, and data freshness across projects',
  demoNote:
    'In demo mode each project summary comes from its latest conclusive round. Projects without collection show "To collect" and are never treated as a zero score. Ratios are shown as distributions, never averaged across projects.',
  stats: {
    projects: 'Projects',
    withRound: 'With conclusion',
    insufficient: 'Small sample',
    alerts: 'Unread alerts',
    samples: 'Total sample',
  },
  distribution: {
    title: 'Metric distribution',
    note: 'min / median / max, not an average.',
    countNote: '{{value}} projects have a conclusion',
    archivedNote: 'Archived projects are excluded by default.',
    empty: 'No project has produced a conclusion yet.',
    min: 'min',
    median: 'median',
    max: 'max',
    metrics: {
      coverage: 'Brand coverage',
      score: 'Health score',
      sov: 'Share of voice',
    },
  },
  filters: {
    all: 'All {{value}}',
    concluded: 'Concluded {{value}}',
    onboarding: 'To collect {{value}}',
    risks: 'With alerts {{value}}',
  },
  searchPlaceholder: 'Search project or brand',
  sort: {
    label: 'Sort',
    risk: 'Risk first',
    coverage: 'Coverage low to high',
    recent: 'Recently collected',
  },
  table: {
    title: 'Project list',
    project: 'Project',
    round: 'Latest conclusion',
    coverage: 'Coverage',
    score: 'Score',
    sov: 'Share of voice',
    alerts: 'Unread alerts',
    action: 'Action',
    open: 'Open overview',
    collect: 'Go to collection',
    onboarding: 'To collect',
    failed: 'Read failed',
    noData: '—',
  },
  empty: 'No projects match the current filters.',
  partialError: '{{value}} projects could not be read; the rows are marked.',
};

export default portfolio;
