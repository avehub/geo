/**
 * 测试专用：从 **Rust 真值源**里解析出来的跨语言常量（只读，配合 `repo-file.ts`）。
 *
 * # 为什么要这一份
 * 有些常量后端是 `pub const`、demo 侧必须用**同一个字面量**，但跨语言 import 不可能
 * （`demo/handlers/project-transfer.ts:6` 就是这么写的）。于是每一处都手抄一份 ⇒ 抄的人各漂一边
 * 也不会红。这里把「解析真值源」收成一份：**测试一律 import 这里的值**，不再各自抄字面量。
 *
 * 与 `#20`（`CSV_TAG_SEPARATOR` ↔ `csv_io.rs` 的 `TAG_SEPARATOR`）同一个手法，同一个理由。
 *
 * ⚠ 抛错文案一律 ASCII：本文件在 `i18n/no-hardcoded-strings.test.ts` 的残留扫描面里。
 */
import { readRepoFile } from './repo-file';

const PROJECT_TRANSFER_RS = readRepoFile(
  'apps',
  'desktop',
  'src-tauri',
  'src',
  'services',
  'project_transfer.rs',
);

const INSIGHT_RS = readRepoFile('crates', 'geo-domain', 'src', 'insight.rs');

/**
 * `REVIEW_CONFIDENCE_FLOOR`（真值源 `crates/geo-domain/src/insight.rs`）。
 *
 * M4 解析（Rust）与 demo 种子 / 页面共用同一个门槛；两边不一致时这条会先红。
 */
export const RUST_REVIEW_CONFIDENCE_FLOOR: number = (() => {
  const parsed = /pub const REVIEW_CONFIDENCE_FLOOR: f64 = ([0-9.]+);/.exec(INSIGHT_RS)?.[1];
  if (parsed === undefined) {
    throw new Error('REVIEW_CONFIDENCE_FLOOR not found in insight.rs');
  }
  return Number(parsed);
})();

/**
 * `pub const EXPORT_FORMAT_VERSION: &str = "...";`（真值源 `project_transfer.rs:19`）。
 *
 * 解析失败就抛，**不回落**到任何默认值：回落等于把「后端把常量挪走了」这件事变成静默的假绿。
 */
export const RUST_EXPORT_FORMAT_VERSION: string = (() => {
  const parsed = /pub const EXPORT_FORMAT_VERSION: &str = "([^"]*)";/.exec(PROJECT_TRANSFER_RS)?.[1];
  if (parsed === undefined) {
    throw new Error('EXPORT_FORMAT_VERSION not found in project_transfer.rs');
  }
  return parsed;
})();
