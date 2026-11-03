import type { ResourceBundle } from '../../resources';

/** 设计样张（dev-only）。键集必须与 zh-CN 完全一致（R-G）。 */
const design: ResourceBundle['design'] = {
  title: 'Design gallery',
  subtitle: 'Visible in development only; not in navigation, and calls no commands.',
  note: 'Production builds do not include this route (import.meta.env.DEV gate).',
  devOnly: 'Dev only',

  colors: {
    title: 'Color',
    brand: 'Brand and semantics',
    neutral: 'Neutrals',
    chart: 'Chart categories',
    note: 'The primary color is reserved for primary actions, selection and links; status colors only express status.',
  },

  type: {
    title: 'Type and numbers',
    display: 'Page title 20/28 · 600',
    body: 'Body 14/22',
    meta: 'Meta 12/18',
    number: 'Tabular numerals',
    sample: '42.5%',
  },

  space: {
    title: 'Spacing and radius',
    note: '4-based scale: 4 / 8 / 12 / 16 / 24 / 32. Cards 8, controls 6, chips 4.',
  },

  actions: {
    title: 'Button hierarchy',
    primary: 'Primary',
    secondary: 'Secondary',
    text: 'Text',
    danger: 'Destructive',
  },

  status: {
    title: 'Status language',
    note: 'One chip vocabulary across the app; unavailable and low-sample states are never hidden.',
  },

  metrics: {
    title: 'Metric tiles',
    coverage: 'Brand coverage',
    score: 'GEO score',
    delta: '+13 pp',
    margin: '±5 pp',
    hint: 'Share of prompts whose answers mention this brand',
    insufficient: 'Directional only',
  },

  verdict: {
    title: 'Verdict bar',
    positive: 'Brand coverage is 55%, up 13 pp from the previous round.',
    neutral: 'Sample size is unchanged from the previous round.',
    risk: 'Doubao fact error rate is 18%, with 3 checks to review.',
    insufficient: 'Sample size is 9, below the threshold of 20.',
    kicker: 'This round',
    action: 'Open todos',
  },

  table: {
    title: 'Table',
    name: 'Project',
    status: 'Status',
    coverage: 'Coverage',
    updated: 'Updated',
  },

  states: {
    title: 'Empty and error states',
    emptyTitle: 'No collection results yet',
    emptyBody: 'Run a collection round and reviewable answers will appear here.',
    emptyAction: 'Start collection',
    errorTitle: 'This section is unavailable',
    errorBody: 'ipc/unknown_command: the desktop app does not implement this command yet.',
    retry: 'Retry',
    loading: 'Loading',
  },

  strip: {
    title: 'Demo strip',
    note: '32px, always on, not dismissible; the compliance sentence stays intact.',
  },

  density: {
    title: 'Density',
    comfortable: 'Comfortable 44',
    compact: 'Compact 36',
    note: 'Comfortable by default; switch to compact from the table toolbar.',
  },
};

export default design;
