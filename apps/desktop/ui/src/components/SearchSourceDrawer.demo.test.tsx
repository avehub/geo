/**
 * Bing 凭据入口的**演示模式门禁**：demo 里不渲染「开始 Bing 授权」、API Key 面板与
 * 回调地址提示。凭据只存在于真后端钥匙串（规则 3 / 规则 8），演示界面不得让人以为
 * 填一下就能拿到数据。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import SearchSourceDrawer from './SearchSourceDrawer';
import type { SearchSource } from '../api/types';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const source: SearchSource = {
  id: 'src-bing',
  project_id: '00000000-0000-4000-8000-000000000001',
  kind: 'bing_wmt',
  auth_mode: 'oauth',
  ingest_modes: ['api', 'file_import', 'paste_parse'],
  status: 'not_configured',
  region: 'global',
  group: 'webmaster_global',
  binding: { siteUrl: 'https://example.com/', client_id: 'bing-client' },
  credentials_state: 'missing',
  secret_ref: 'keyring://search/bing_wmt',
  data_through: null,
  checked_at: null,
  check_detail: null,
  note: null,
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
};

describe('SearchSourceDrawer · Bing demo 门禁', () => {
  it('demo 下不渲染 Bing 授权按钮、API Key 面板与回调地址提示', () => {
    renderWithProviders(
      <SearchSourceDrawer
        source={source}
        busy={false}
        onClose={() => undefined}
        onSave={() => undefined}
        onTest={() => undefined}
        onRemove={() => undefined}
        asOf="2026-10-12"
      />,
    );

    // 字面量：这两个键已随 Bing 改走 API Key 从词典里移除，断言的是「界面上不出现」。
    expect(screen.queryByText('开始 Bing 授权')).toBeNull();
    expect(screen.queryByText('Bing API Key')).toBeNull();
    expect(screen.queryByText(/17654/)).toBeNull();
  });
});
