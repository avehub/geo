import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from './components/AppLayout';
import ActionPage from './pages/ActionPage';
import ArticleStudioPage from './pages/ArticleStudioPage';
import AutoBuildProjectPage from './pages/AutoBuildProjectPage';
import CollectionPage from './pages/CollectionPage';
import DesignGalleryPage from './pages/DesignGalleryPage';
import DiagnosisPage from './pages/DiagnosisPage';
import EntityCardPage from './pages/EntityCardPage';
import FaqLibraryPage from './pages/FaqLibraryPage';
import InsightPage from './pages/InsightPage';
import KeywordLibraryPage from './pages/KeywordLibraryPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import NewProjectPage from './pages/NewProjectPage';
import OverviewPage from './pages/OverviewPage';
import PortfolioPage from './pages/PortfolioPage';
import ProjectListPage from './pages/ProjectListPage';
import ProjectWizardPage from './pages/ProjectWizardPage';
import PromptSetPage from './pages/PromptSetPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import SitePage from './pages/SitePage';
import WebmasterDataPage from './pages/WebmasterDataPage';

/**
 * 路由表。Tauri WebView 没有可用的真实 URL，因此用 `MemoryRouter`；
 * `mise run web` 的浏览器调试走同一份路由。
 */
export default function App() {
  return (
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/projects" element={<ProjectListPage />} />
          {/* 新建项目的两条入口（Plan B Task 7 · spec §7）：`/projects/new` 是岔路口，
              左边去自动采集屏，右边去既有的 5 步向导。顺序要紧挨着 `/projects`：
              React Router v6 按路径**具体度**而不是声明顺序匹配，`/projects/:id/…` 不会吃掉 `new`。 */}
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/new/auto" element={<AutoBuildProjectPage />} />
          <Route path="/projects/new/wizard" element={<ProjectWizardPage />} />
          <Route path="/projects/:id/wizard" element={<ProjectWizardPage />} />
          {/* 项目概览（首页）：点项目默认落到这里（`/projects/:id` 重定向），
              再按闭环顺序往下钻。结果区锚定「最近有结论的一轮」，待办区跨轮累计。 */}
          <Route path="/projects/:id" element={<Navigate to="overview" replace />} />
          <Route path="/projects/:id/overview" element={<OverviewPage />} />
          <Route path="/projects/:id/entity-card" element={<EntityCardPage />} />
          {/* M1.2 知识层（spec 2026-10-01 · DR-69）：紧跟实体卡——实体卡是**源**（结构化事实），
              知识库是**流**（案例 / 卖点 / 口径 / 多媒体等可复用素材），路径段与 `nav.knowledge` 同名。 */}
          <Route path="/projects/:id/knowledge" element={<KnowledgeBasePage />} />
          {/* M1.5 素材层：关键词库与 FAQ 常见问题库（spec 2026-09-30 · DR-37）。
              路径段与 `nav.*` 的键同名，左侧栏的选中态推导因此不需要映射表。 */}
          <Route path="/projects/:id/keywords" element={<KeywordLibraryPage />} />
          <Route path="/projects/:id/faq" element={<FaqLibraryPage />} />
          <Route path="/projects/:id/prompts" element={<PromptSetPage />} />
          {/* M3–M7：采集 → 解析核查 → 诊断 → 行动 → 报告，路径段与 `nav.*` 的键同名，
              于是 `AppLayout` 的 selectedKey 推导与跳转都不需要一张映射表。 */}
          <Route path="/projects/:id/collection" element={<CollectionPage />} />
          <Route path="/projects/:id/insight" element={<InsightPage />} />
          {/* M5.5 站长数据（spec 2026-10-12 · DR-91）：排在解析与核查之后、诊断与归因之前——
              诊断要吃平台第一方的曝光 / 点击 / AI 引用做归因，得先把站外真相接进来；
              路径段与 `nav.webmasterData` 同名，左侧栏的选中态推导因此不需要映射表。 */}
          <Route path="/projects/:id/webmaster-data" element={<WebmasterDataPage />} />
          <Route path="/projects/:id/diagnosis" element={<DiagnosisPage />} />
          <Route path="/projects/:id/action" element={<ActionPage />} />
          {/* M6 文章管理（spec 2026-10-10 · DR-83）：排在行动中心之后、站点接入之前——
              闭环顺序是「开处方 → 定写什么稿子 → 把落点在官网的那几条变成补丁 → 出报告」。 */}
          <Route path="/projects/:id/articles" element={<ArticleStudioPage />} />
          {/* M6.5 站点接入（spec DR-54）：排在文章管理之后、报告之前——闭环顺序是
              「开处方 → 定写什么稿子 → 把落点在官网的那几条变成补丁 → 出报告」。
              🔴 `?from=<action_id>` 是行动中心那个入口带过来的（DR-50），路由本身不关心它。 */}
          <Route path="/projects/:id/site" element={<SitePage />} />
          <Route path="/projects/:id/report" element={<ReportPage />} />
          {/* 设置页的左侧二级菜单（Plan B · spec DR-27）：`/settings` 重定向到默认分段，
              不认识的 `:section` 由 `SettingsPage` 自己回落到 `general`（不白屏）。 */}
          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
          {/* 设计样张（2026-10-30 视觉重做 · 决策 5）：**仅 vite dev 注册**。
              生产构建里 `import.meta.env.DEV` 被静态替换为 false，整条分支与路由串会被剔除
              （验收：`grep -r "__design" dist/assets` 必须为 0）。它不进侧栏，也不调任何命令。 */}
          {import.meta.env.DEV ? <Route path="/__design" element={<DesignGalleryPage />} /> : null}
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
