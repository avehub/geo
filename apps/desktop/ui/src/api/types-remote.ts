/**
 * 远程内容（数据面）IPC 类型 —— 与 Rust 侧 DTO 逐字对应。
 *
 * 真值源：`apps/desktop/src-tauri/src/services/remote_service.rs` 的
 * `#[derive(Serialize)]` 结构。改字段必须两侧同时改（AGENTS 规则 8）。
 *
 * 🔴 这里**没有**任何"用户标识 / 设备指纹 / 埋点"字段，将来也不会有：
 * 数据面是匿名只读静态文件（设计文档 §2.4 的 I-2）。
 */

/** 产物来源。`none` = 既没有远程缓存也没有内置兜底（目前只有 legal / notices）。 */
export type RemoteSource = 'remote' | 'builtin' | 'none';

/** 同步状态，与 `remote_sync_log.status` 的 CHECK 约束一一对应。 */
export type RemoteSyncStatus =
  | 'ok'
  | 'partial'
  | 'rejected_digest'
  | 'rejected_signature'
  | 'rolled_back'
  | 'unavailable';

export interface RemoteSyncFailedItem {
  item: string;
  /** 稳定原因码：`digest` / `signature` / `network` / `status` / `too_large` / `invalid_path`。 */
  reason: string;
}

export interface RemoteSyncReport {
  status: RemoteSyncStatus;
  changed: string[];
  failed: RemoteSyncFailedItem[];
  degraded: boolean;
  started_at: string;
  finished_at: string;
  error_code: string | null;
}

export interface RemoteJsonItem {
  key: string;
  version: number;
  sha256: string;
  source: RemoteSource;
  accepted_at: string | null;
  /** `true` = 当前展示的不是远程发布版本（内置兜底或完全没有）。 */
  degraded: boolean;
  value: unknown;
}

export interface RemoteTextItem {
  key: string;
  version: number;
  sha256: string;
  source: RemoteSource;
  accepted_at: string | null;
  degraded: boolean;
  title: string | null;
  text: string | null;
}

export interface RemoteItemStatus {
  key: string;
  version: number;
  sha256: string;
  source: RemoteSource;
  accepted_at: string;
}

export interface RemoteSyncSummary {
  status: RemoteSyncStatus;
  started_at: string;
  finished_at: string | null;
  changed_items: string[];
  degraded: boolean;
  error_code: string | null;
}

export interface RemoteStatus {
  base_url: string;
  /** `false` = 构建时没注入内容公钥 ⇒ 远程内容一律拒收，全部走内置。 */
  public_key_configured: boolean;
  last_sync: RemoteSyncSummary | null;
  items: RemoteItemStatus[];
  builtin_versions: RemoteItemStatus[];
  degraded: boolean;
}

export interface RemoteEndpointConfig {
  base_url: string;
  default_base_url: string;
  public_key_configured: boolean;
  timeout_secs: number;
}
