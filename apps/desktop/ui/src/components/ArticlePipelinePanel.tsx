import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { Article, ArticleSchedule } from '../api/types';
import ArticleReviewTable from './ArticleReviewTable';
import ArticleReviewToolbar, { type ArticleStatusFilter } from './ArticleReviewToolbar';
import ArticleScheduleTable from './ArticleScheduleTable';

export interface ArticlePipelinePanelProps {
  schedules: ArticleSchedule[];
  schedulesLoading: boolean;
  queue: Article[];
  queueLoading: boolean;
  /** 方向 id → 标题、模板 id → 名称（页面层查好传进来：本组件不自己取数据）。 */
  directionTitleOf: (directionId: string) => string;
  templateNameOf: (templateId: string) => string;
  /** 正在「立即运行 / 立即生成」的那一条（两张表共用：id 跨族唯一）。 */
  runBusyId: string | null;
  statusFilter: ArticleStatusFilter;
  onStatusFilterChange: (status: ArticleStatusFilter) => void;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  approving: boolean;
  rejecting: boolean;
  /** 导出闸门（`api/article-compose.ts`）：零条「已通过」时置灰。 */
  exportDisabled: boolean;
  onCreateSchedule: () => void;
  onEditSchedule: (row: ArticleSchedule) => void;
  onToggleSchedule: (row: ArticleSchedule, enabled: boolean) => void;
  onRunSchedule: (row: ArticleSchedule) => void;
  onApprove: () => void;
  onReject: () => void;
  onExport: () => void;
  onPreview: (row: Article) => void;
}

/**
 * ③ 排期与文章（spec 2026-10-10 · DR-86③）：一块面板里上下两节——**生成排期**与**文章评审队列**。
 *
 * # 为什么两节同屏
 * 它们是同一条因果链的两端：排期跑出稿子，稿子进队列等人审。分成两个 Tab 会让人
 * 点完「立即运行」还要再点一次才看得见产出（走查清单第 7 条要看的正是"点一下多出一篇待审"）。
 *
 * # 🔴 那句「不跑真实定时任务」常驻（DR-85）
 * 演示模式没有定时器，`next_run_at` 只是按 freq + time 算出来的显示值。这句话是本页
 * 两句必须常驻的说明之一（另一句是页头的 `demoHint`），不写清楚就会被当成已落地的能力评审。
 *
 * # 🔴 纯展示组件
 * 写路径全在页面层（`pages/ArticleStudioPage.tsx`）：本组件不直连 IPC，也不持有任何状态，
 * 与 `ArticleScheduleTable` / `ArticleReviewTable` 同一条分工。
 */
export default function ArticlePipelinePanel({
  schedules,
  schedulesLoading,
  queue,
  queueLoading,
  directionTitleOf,
  templateNameOf,
  runBusyId,
  statusFilter,
  onStatusFilterChange,
  selectedIds,
  onSelectIds,
  approving,
  rejecting,
  exportDisabled,
  onCreateSchedule,
  onEditSchedule,
  onToggleSchedule,
  onRunSchedule,
  onApprove,
  onReject,
  onExport,
  onPreview,
}: ArticlePipelinePanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography.Title level={5}>{t('article.schedules.title')}</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('article.schedules.demoBody')}
      />
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateSchedule}>
          {t('article.schedules.create')}
        </Button>
      </Space>
      <ArticleScheduleTable
        rows={schedules}
        loading={schedulesLoading}
        templateNameOf={templateNameOf}
        busyId={runBusyId}
        onToggle={onToggleSchedule}
        onRunNow={onRunSchedule}
        onEdit={onEditSchedule}
      />

      <Typography.Title level={5} style={{ marginTop: 20 }}>
        {t('article.review.title')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('article.review.hint')}
      </Typography.Paragraph>
      <ArticleReviewToolbar
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        selectedCount={selectedIds.length}
        approving={approving}
        rejecting={rejecting}
        exportDisabled={exportDisabled}
        onApprove={onApprove}
        onReject={onReject}
        onExport={onExport}
      />
      <ArticleReviewTable
        rows={queue}
        loading={queueLoading}
        selectedIds={selectedIds}
        directionTitleOf={directionTitleOf}
        templateNameOf={templateNameOf}
        onSelectIds={onSelectIds}
        onPreview={onPreview}
      />
    </>
  );
}
