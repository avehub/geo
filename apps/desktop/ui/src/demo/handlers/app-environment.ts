/**
 * `app_environment` 的内存实现（Plan B Task 3 · spec DR-35 / §8）。
 *
 * # 🔴 这条命令是 **demo 独有**的
 * Rust 侧本轮零改动（AGENTS 规则 8 的"两侧同时改"在这里表现为：命令进 `IPC_COMMANDS`
 * 与 `demoBackend`，桌面端的 `#[tauri::command]` 留给 Plan C）。差异登记在
 * `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`（E-46 那一族，
 * 与 M3–M7 那 20 条同性质：点进桌面端会报 `ipc/unknown_command`）。
 *
 * # 🔴 权限三项恒为 `unsupported`，不是 `granted`
 * 浏览器**确实**没有 macOS 的通知 / 文件与文件夹 / 屏幕录制授权，回 `granted` 是假声明
 * （spec §8）。界面据此把「去系统设置」置灰，而不是演一个点了没反应的按钮。
 *
 * # 路径与大小是**静态值**（AGENTS 规则 9）
 * 真桌面端要读 `app_data_dir()` 与 `fs::metadata` 的 len；demo 不碰文件系统，
 * 端出一组形状正确的固定值。`export_dir` 是唯一"活的"一项：它读
 * `db.settings.app.storage.last_export_dir`，于是"设置里改了导出目录 ⇒ 这里跟着变"
 * 在 demo 里也成立，不会出现两个各说各话的字段。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 下面的路径常量全是 ASCII。
 */
import { getDemoDb } from '../db';
import type { DemoHandler } from '../types';
import type { AppEnvironment } from '../../api/types';

/** 与 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 同源（判据在 `.test.ts`）。 */
export const DEMO_APP_VERSION = '0.1.0';

/** demo 没有构建号（没有 CI 打包这一步），诚实标出运行形态而不是编一个数字。 */
export const DEMO_BUILD_NUMBER = 'web-demo';

/** macOS 的应用数据目录形状（`tauri.conf.json` 的 identifier 是 `com.gdk.geo`）。 */
const DATA_DIR = '/Users/demo/Library/Application Support/com.gdk.geo';

/** 已应用的迁移数 = `crates/geo-store/migrations/` 下的 `.sql` 文件数（判据在 `.test.ts`）。 */
const MIGRATIONS_APPLIED = 12;

/** 库里那份 SQLite 的大小。静态值：demo 不碰文件系统，也就没有真实字节数可言。 */
const DB_SIZE_BYTES = 3_481_600;

export const appEnvironment: DemoHandler = () => {
  const db = getDemoDb();
  const environment: AppEnvironment = {
    app_version: DEMO_APP_VERSION,
    build_number: DEMO_BUILD_NUMBER,
    permissions: {
      notification: 'unsupported',
      files_and_folders: 'unsupported',
      screen_recording: 'unsupported',
    },
    storage: {
      data_dir: DATA_DIR,
      db_path: `${DATA_DIR}/geo.sqlite3`,
      db_size_bytes: DB_SIZE_BYTES,
      screenshots_dir: `${DATA_DIR}/screenshots`,
      log_dir: `${DATA_DIR}/logs`,
      export_dir: db.settings.app.storage.last_export_dir,
      migrations_applied: MIGRATIONS_APPLIED,
    },
  };
  return environment;
};
