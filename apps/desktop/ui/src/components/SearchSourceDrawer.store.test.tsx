/**
 * Store（MSIX）版不含百度站长浏览器取数通道（2026-11-13 裁定 B8）：
 * `VITE_STORE_BUILD=true` 时「打开系统 Chrome」入口不得渲染；直下载版保留。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import SearchSourceDrawer from './SearchSourceDrawer';
import type { SearchSource } from '../api/types';
import { renderWithProviders } from '../test/render';
import zhCN from '../i18n/locales/zh-CN';

vi.mock('../api/runtime', () => ({ runtime: 'tauri' }));

const baiduSource: SearchSource = {
  id: 'src-baidu-ai',
  project_id: '00000000-0000-4000-8000-000000000001',
  kind: 'baidu_ziyuan_ai',
  auth_mode: 'none',
  ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
  status: 'ready',
  region: 'cn',
  group: 'webmaster_cn',
  binding: { siteUrl: 'https://example.com/' },
  credentials_state: 'not_required',
  secret_ref: null,
  data_through: null,
  checked_at: null,
  check_detail: null,
  note: null,
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
};

function openDrawer() {
  renderWithProviders(
    <SearchSourceDrawer
      source={baiduSource}
      asOf="2026-10-12"
      busy={false}
      onSave={() => {}}
      onTest={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('SearchSourceDrawer · Store 版通道门禁（B8）', () => {
  it('VITE_STORE_BUILD=true 时不渲染「打开系统 Chrome」', async () => {
    vi.stubEnv('VITE_STORE_BUILD', 'true');
    openDrawer();
    expect(
      screen.queryByRole('button', { name: zhCN.webmasterData.sourceCards.browserOpen }),
    ).toBeNull();
    vi.unstubAllEnvs();
  });

  it('直下载版（env 为空）保留「打开系统 Chrome」', async () => {
    vi.stubEnv('VITE_STORE_BUILD', '');
    openDrawer();
    expect(
      await screen.findByRole('button', { name: zhCN.webmasterData.sourceCards.browserOpen }),
    ).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
