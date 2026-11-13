/**
 * 构建形态门禁（2026-11-13 裁定 B8）：Store（MSIX）版不含浏览器自动化通道。
 *
 * 与 Rust 侧 `apps/desktop/src-tauri/src/build_flavor.rs` 同裁定：Store 认证对
 * 「受控浏览器」行为敏感、MSIX 容器未实测，故 Store 版隐藏腾讯元宝采集通道与
 * 百度站长浏览器取数入口；直下载版不受影响。Rust 侧在 Store 构建下对相应命令
 * 回 `validation/failed`，前端这里只负责隐藏入口。
 *
 * 注入方式：`release.yml` 的 msix job 设 `VITE_STORE_BUILD=true`（vite build 期写入
 * `import.meta.env`）；demo 与直下载构建无该变量 ⇒ false。
 */
import { ENGINE_VALUES, type EngineId } from './types';

export function isStoreBuild(): boolean {
  return import.meta.env.VITE_STORE_BUILD === 'true';
}

/** Store 版不提供的采集引擎（浏览器自动化）。 */
export const BROWSER_ONLY_ENGINES: readonly EngineId[] = ['yuanbao'];

/** Store 版不提供的站长数据源 kind（浏览器取数）。 */
export const BROWSER_ONLY_SOURCE_KINDS: readonly string[] = ['baidu_ziyuan', 'baidu_ziyuan_ai'];

/** 当前构建形态下可选的采集引擎。 */
export function availableEngines(): readonly EngineId[] {
  if (!isStoreBuild()) return ENGINE_VALUES;
  return ENGINE_VALUES.filter((engine) => !BROWSER_ONLY_ENGINES.includes(engine));
}
