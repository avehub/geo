/**
 * 唯一 IPC 出口：组件只能经本文件调用后端，禁止直接 `invoke`。
 *
 * 每个 Tauri 命令对应一个导出函数；后端 `IpcError{code,message,detail}`
 * 统一转成 `IpcRequestError`（带稳定错误码），组件只需读 `message` 展示中文原因。
 */

import { invoke } from '@tauri-apps/api/core';

import type {
  AppSettings,
  Competitor,
  CompetitorDraft,
  CsvImportResult,
  DedupeReport,
  EntityCard,
  EntityCardRevision,
  FieldStatus,
  GenerateOptions,
  ImportReport,
  IpcErrorPayload,
  LlmTestResult,
  Project,
  ProjectAsset,
  ProjectDetail,
  ProjectDraft,
  ProjectExport,
  ProjectFilter,
  PromptItem,
  PromptSet,
  PromptSetSummary,
  ProviderInfo,
  SecretStatus,
} from './types';
import { isIpcErrorPayload } from './types';

/** 全部 IPC 命令名。前后端漂移时这里先炸，便于排查。 */
export const IPC_COMMANDS = [
  'project_create',
  'project_list',
  'project_get',
  'project_update',
  'project_archive',
  'project_delete',
  'project_export',
  'project_import',
  'entity_card_autobuild',
  'entity_card_get',
  'entity_card_update_field',
  'entity_card_revisions',
  'competitor_upsert',
  'competitor_list',
  'competitor_delete',
  'competitor_reorder',
  'asset_add',
  'asset_list',
  'asset_delete',
  'prompt_set_generate',
  'prompt_set_list',
  'prompt_set_get',
  'prompt_set_rename',
  'prompt_set_delete',
  'prompt_item_update',
  'prompt_set_dedupe',
  'prompt_set_export_csv',
  'prompt_set_import_csv',
  'settings_get',
  'settings_update',
  'secret_set',
  'secret_status',
  'secret_delete',
  'llm_provider_test',
  'llm_providers',
] as const;

export type IpcCommand = (typeof IPC_COMMANDS)[number];

/** IPC 调用失败。`code` 为后端稳定错误码，可直接用于分支处理。 */
export class IpcRequestError extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(payload: IpcErrorPayload) {
    super(payload.message || '未知错误');
    this.name = 'IpcRequestError';
    this.code = payload.code || 'ipc/unknown';
    this.detail = payload.detail ?? null;
  }

  /** 中文可展示原因（antd message 直接用）。 */
  get userMessage(): string {
    return this.message;
  }
}

/** 把任意 invoke 拒绝原因归一化成 `IpcRequestError`。 */
export function unwrapIpcError(cmd: string, cause: unknown): IpcRequestError {
  if (cause instanceof IpcRequestError) return cause;
  if (isIpcErrorPayload(cause)) return new IpcRequestError(cause);

  // Tauri 在参数反序列化失败时会直接 reject 一个字符串。
  const message =
    typeof cause === 'string'
      ? cause
      : cause instanceof Error
        ? cause.message
        : JSON.stringify(cause) ?? String(cause);

  return new IpcRequestError({
    code: 'ipc/internal',
    message: `调用 ${cmd} 失败：${message}`,
    detail: null,
  });
}

async function call<T>(cmd: IpcCommand, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (cause) {
    throw unwrapIpcError(cmd, cause);
  }
}

// ---------------------------------------------------------------------------
// M1 项目
// ---------------------------------------------------------------------------

export const projectCreate = (draft: ProjectDraft) =>
  call<Project>('project_create', { draft });

export const projectList = (filter: ProjectFilter = {}) =>
  call<Project[]>('project_list', { filter });

export const projectGet = (id: string) => call<ProjectDetail>('project_get', { id });

export const projectUpdate = (project: Project) =>
  call<Project>('project_update', { project });

export const projectArchive = (id: string, archived: boolean) =>
  call<Project>('project_archive', { id, archived });

export const projectDelete = (id: string) => call<void>('project_delete', { id });

export const projectExport = (id: string) =>
  call<ProjectExport>('project_export', { id });

export const projectImport = (payload: string) =>
  call<ImportReport>('project_import', { payload });

// ---------------------------------------------------------------------------
// M1 实体卡
// ---------------------------------------------------------------------------

export const entityCardAutobuild = (projectId: string, domain: string) =>
  call<EntityCard>('entity_card_autobuild', { project_id: projectId, domain });

export const entityCardGet = (projectId: string) =>
  call<EntityCard | null>('entity_card_get', { project_id: projectId });

export const entityCardUpdateField = (
  projectId: string,
  path: string,
  value: unknown,
  status: FieldStatus,
  note: string | null,
) =>
  call<EntityCardRevision>('entity_card_update_field', {
    project_id: projectId,
    path,
    value,
    status,
    note,
  });

export const entityCardRevisions = (projectId: string) =>
  call<EntityCardRevision[]>('entity_card_revisions', { project_id: projectId });

// ---------------------------------------------------------------------------
// M1 竞品与资产
// ---------------------------------------------------------------------------

export const competitorUpsert = (
  projectId: string,
  draft: CompetitorDraft,
  id: string | null = null,
) => call<Competitor>('competitor_upsert', { project_id: projectId, draft, id });

export const competitorList = (projectId: string) =>
  call<Competitor[]>('competitor_list', { project_id: projectId });

export const competitorDelete = (id: string) => call<void>('competitor_delete', { id });

export const competitorReorder = (projectId: string, ids: string[]) =>
  call<Competitor[]>('competitor_reorder', { project_id: projectId, ids });

export const assetAdd = (
  projectId: string,
  kind: ProjectAsset['kind'],
  url: string,
  title: string | null = null,
  note: string | null = null,
) => call<ProjectAsset>('asset_add', { project_id: projectId, kind, url, title, note });

export const assetList = (projectId: string) =>
  call<ProjectAsset[]>('asset_list', { project_id: projectId });

export const assetDelete = (id: string) => call<void>('asset_delete', { id });

// ---------------------------------------------------------------------------
// M2 Prompt 题库
// ---------------------------------------------------------------------------

export const promptSetGenerate = (projectId: string, options: GenerateOptions) =>
  call<PromptSet>('prompt_set_generate', { project_id: projectId, options });

export const promptSetList = (projectId: string) =>
  call<PromptSetSummary[]>('prompt_set_list', { project_id: projectId });

export const promptSetGet = (id: string) => call<PromptSet>('prompt_set_get', { id });

export const promptSetRename = (id: string, label: string) =>
  call<PromptSetSummary>('prompt_set_rename', { id, label });

export const promptSetDelete = (id: string) => call<void>('prompt_set_delete', { id });

export const promptItemUpdate = (item: PromptItem) =>
  call<PromptItem>('prompt_item_update', { item });

export const promptSetDedupe = (id: string) => call<DedupeReport>('prompt_set_dedupe', { id });

export const promptSetExportCsv = (id: string) =>
  call<string>('prompt_set_export_csv', { id });

export const promptSetImportCsv = (id: string, payload: string) =>
  call<CsvImportResult>('prompt_set_import_csv', { id, payload });

// ---------------------------------------------------------------------------
// 设置与密钥
// ---------------------------------------------------------------------------

export const settingsGet = () => call<AppSettings>('settings_get');

export const settingsUpdate = (settings: AppSettings) =>
  call<AppSettings>('settings_update', { settings });

export const secretSet = (provider: string, value: string) =>
  call<void>('secret_set', { provider, value });

export const secretStatus = (provider: string) =>
  call<SecretStatus>('secret_status', { provider });

export const secretDelete = (provider: string) => call<void>('secret_delete', { provider });

export const llmProviderTest = (provider: string) =>
  call<LlmTestResult>('llm_provider_test', { provider });

export const llmProviders = () => call<ProviderInfo[]>('llm_providers');
