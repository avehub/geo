/**
 * M6 GEO 行动中心的 IPC wrapper（4 条命令）。
 * 拆分理由与依赖方向见 `api/collection.ts` 的头注释。
 */
import { call } from './client';
import type { ActionBoard, ActionItem, ActionStatus, ContentStatus, GeneratedContent } from './types';

/** 行动中心首屏：处方 + 归因卡片 + 已生成文稿 + 模板目录（一次往返）。 */
export const actionBoard = (projectId: string) =>
  call<ActionBoard>('action_board', { project_id: projectId });

/** 翻一条处方的执行状态（todo / in_progress / done）。 */
export const actionUpdateStatus = (actionId: string, status: ActionStatus) =>
  call<ActionItem>('action_update_status', { action_id: actionId, status });

/** 按模板生成一份文稿（demo 取预置演示文稿，默认待人工审核）。 */
export const contentGenerate = (projectId: string, templateId: string, actionId: string | null = null) =>
  call<GeneratedContent>('content_generate', {
    project_id: projectId,
    template_id: templateId,
    action_id: actionId,
  });

/** 人工审核一份文稿（通过 / 退回 / 打回待审）。 */
export const contentUpdateStatus = (contentId: string, status: ContentStatus) =>
  call<GeneratedContent>('content_update_status', { content_id: contentId, status });
