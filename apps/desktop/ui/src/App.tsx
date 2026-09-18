import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from './components/AppLayout';
import EntityCardPage from './pages/EntityCardPage';
import ProjectListPage from './pages/ProjectListPage';
import ProjectWizardPage from './pages/ProjectWizardPage';
import PromptSetPage from './pages/PromptSetPage';
import SettingsPage from './pages/SettingsPage';

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
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/new/wizard" element={<ProjectWizardPage />} />
          <Route path="/projects/:id/wizard" element={<ProjectWizardPage />} />
          <Route path="/projects/:id/entity-card" element={<EntityCardPage />} />
          <Route path="/projects/:id/prompts" element={<PromptSetPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
