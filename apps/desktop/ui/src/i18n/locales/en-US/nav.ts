import type { ResourceBundle } from '../../resources';

/**
 * 左侧导航。标注 `ResourceBundle['nav']` 让 zh/en 的键集在 `tsc -b` 阶段就必须相等（R-G）：
 * 少一个键或多一个键都会编译不过。
 */
const nav: ResourceBundle['nav'] = {
  projects: 'Projects',
  // Four-stage navigation groups (2026-10-30 visual refresh, option A). Order = UI order.
  groups: {
    prepare: 'Prepare',
    monitor: 'Monitor',
    diagnose: 'Diagnose & act',
    deliver: 'Deliver',
  },
  switchProject: 'Switch project',
  collapseNav: 'Collapse navigation',
  expandNav: 'Expand navigation',
  allProjects: 'All projects',
  portfolio: 'Portfolio',
  // The “+” action on the Projects row (DR-26: it is an action, not a navigation target).
  newProject: 'New project',
  noProjects: 'No projects yet. Use the + button on the Projects row to create one.',
  loadFailed: 'Failed to load the project list',
  projectsAria: 'Project navigation',
  settingsAria: 'Settings navigation',
  overview: 'Overview',
  entityCard: 'Brand Entity Card',
  // M1.2 knowledge base (2026-10-01, spec DR-69): right after the entity card — the card holds
  // the structured facts, the knowledge base holds every reusable material built on them.
  knowledge: 'Knowledge Base',
  // M1.5 material layer (2026-09-30, spec DR-37): right after the entity card and before the
  // prompt library, because keywords and FAQ entries are the material the prompt set references.
  keywords: 'Keyword Library',
  faq: 'FAQ Library',
  prompts: 'Prompt Library',
  collection: 'Collection',
  insight: 'Insights and Fact Check',
  // M5.5 Webmaster Data (2026-10-12, spec DR-91): after Insights and Fact Check and before
  // Diagnosis — collection and insights are the sample *we* collected by asking the AI engines,
  // while webmaster data is what the platforms officially report back. Both feed the diagnosis,
  // so this sits before it; it depends on neither the prompt set nor collection, so it sits after.
  webmasterData: 'Webmaster Data',
  diagnosis: 'Diagnosis',
  action: 'Action Center',
  // M6 Article Studio (2026-10-10, spec DR-83): after the Action Center and before Site
  // Connect — prescriptions come first, the content ones become reviewable drafts here, and
  // the ones that land on the customer's own site become patches in Site Connect.
  articles: 'Article Studio',
  // M6.5 Site Connect (2026-09-30, spec DR-54): right after the Action Center — the
  // prescriptions that land on the customer's own site become shippable, revertible patches here.
  site: 'Site Connect',
  report: 'Reports',
  settings: 'Settings',
};

export default nav;
