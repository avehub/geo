/**
 * Store（MSIX）版不含腾讯元宝浏览器自动化通道（2026-11-13 裁定 B8）：
 * `VITE_STORE_BUILD=true` 时引擎勾选与默认 engine_scope 都必须排除 yuanbao；
 * 直下载版（无该 env）不受影响。Rust 侧同裁定见 `src-tauri/src/build_flavor.rs`。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import StartRoundModal from './StartRoundModal';
import { renderWithProviders } from '../test/render';
import zhCN from '../i18n/locales/zh-CN';

vi.mock('../api/runtime', () => ({ runtime: 'desktop' }));

function openModal() {
  renderWithProviders(
    <StartRoundModal
      projectId="00000000-0000-4000-8000-000000000001"
      open
      onClose={() => {}}
      onQueued={() => {}}
    />,
  );
}

describe('StartRoundModal · Store 版通道门禁（B8）', () => {
  it('VITE_STORE_BUILD=true 时不渲染腾讯元宝引擎勾选', async () => {
    vi.stubEnv('VITE_STORE_BUILD', 'true');
    openModal();
    // 其它引擎照常出现，证明不是整组没渲染
    expect(await screen.findByText(zhCN.collection.engines.kimi)).toBeInTheDocument();
    expect(screen.queryByText(zhCN.collection.engines.yuanbao)).toBeNull();
    vi.unstubAllEnvs();
  });

  it('直下载版（env 为空）腾讯元宝照常渲染', async () => {
    vi.stubEnv('VITE_STORE_BUILD', '');
    openModal();
    expect(await screen.findByText(zhCN.collection.engines.yuanbao)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
