/**
 * 本机环境（版本 / 系统权限 / 数据目录）的 IPC 契约类型（Plan B Task 3 · spec DR-35 / §8）。
 *
 * # 为什么是一条命令而不是两条
 * `permission_status` 与 `storage_info` 回答的都是"这台机器上这个应用现在是什么处境"，
 * 而设置页的首屏同时要它们 ⇒ 拆两条就是两次往返。合成 `app_environment` 一次给全（DR-35）。
 *
 * # 🔴 demo 里权限恒为 `unsupported`（不是 `granted`）
 * 浏览器**确实**没有"通知 / 文件与文件夹 / 屏幕录制"这三种 macOS 系统授权，
 * 回 `granted` 是假声明。真桌面端由 Rust 侧查 `NSUserNotificationCenter` / TCC 之后回填，
 * 差异登记在 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 *
 * # 🔴 「打开目录」「更改目录」「去系统设置」三个动作本轮**不加命令**
 * demo 里做不了（浏览器打不开访达），按钮置灰并说明"由桌面端提供"——与 M7 对
 * docx/pdf/png 的既有形态同一口径。Plan C 再加 `storage_open_dir` / `open_system_settings`。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';

/**
 * 系统权限状态（沿用 2026-09-18 spec §4.7 的四值）。
 *
 * `not_determined` = 还没问过用户（macOS 的 TCC 初始态）；`unsupported` = 这个运行环境
 * 根本没有这种权限（demo / 浏览器），与"被拒绝"是两件事，界面文案必须区分。
 */
export type PermissionState = 'granted' | 'denied' | 'not_determined' | 'unsupported';

export const PERMISSION_STATE_VALUES = [
  'granted',
  'denied',
  'not_determined',
  'unsupported',
] as const satisfies readonly PermissionState[];

export type PermissionStateValuesComplete = AssertComplete<
  ValuesAreComplete<PermissionState, typeof PERMISSION_STATE_VALUES>
>;

/** 三项会挡到产品功能的系统权限（产品定义 §3.10：通知、截图留证、导出目录）。 */
export interface Permissions {
  /** 任务完成 / 发现风险时的系统通知。 */
  notification: PermissionState;
  /** 读写导出目录与截图目录。 */
  files_and_folders: PermissionState;
  /** 采集证据的全屏截图（浏览器自动化通道用）。 */
  screen_recording: PermissionState;
}

/** 数据目录与占用（只读事实；"更改/打开"是动作，本轮不给命令）。 */
export interface AppStorageInfo {
  data_dir: string;
  db_path: string;
  db_size_bytes: number;
  screenshots_dir: string;
  log_dir: string;
  /** 用户上次选的导出目录；从没导出过是 `null`（界面显示空值占位符，不编一个路径）。 */
  export_dir: string | null;
  /** 已应用的迁移数（排障时要能一眼看出库是不是旧版）。 */
  migrations_applied: number;
}

/** `app_environment` 的返回：本机环境事实一次给全。 */
export interface AppEnvironment {
  app_version: string;
  build_number: string;
  permissions: Permissions;
  storage: AppStorageInfo;
}
