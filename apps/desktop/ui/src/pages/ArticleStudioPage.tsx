import { useMemo, useState } from 'react';
import { Alert, App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import * as api from '../api/article';
import { articleMarkdownFileName, composeArticleMarkdown } from '../api/article-compose';
import { projectGet } from '../api/client';
import { describeIpcError } from '../api/errors';
import type {
  Article,
  ArticleDirection,
  ArticleDirectionDraft,
  ArticleSchedule,
  ArticleScheduleDraft,
  ArticleTemplate,
  ArticleTemplateDraft,
  Competitor,
} from '../api/types';
import ArticleDirectionModal, {
  type ArticleDirectionFormValues,
} from '../components/ArticleDirectionModal';
import ArticleDirectionPanel from '../components/ArticleDirectionPanel';
import ArticlePipelinePanel from '../components/ArticlePipelinePanel';
import ArticlePreviewDrawer from '../components/ArticlePreviewDrawer';
import type { ArticleStatusFilter } from '../components/ArticleReviewToolbar';
import ArticleScheduleModal from '../components/ArticleScheduleModal';
import ArticleTemplateDrawer from '../components/ArticleTemplateDrawer';
import ArticleTemplatePanel from '../components/ArticleTemplatePanel';
import LibraryExportModal from '../components/LibraryExportModal';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import {
  countByDirection,
  directionTitleLookup,
  templateNameLookup,
} from '../components/article-studio-view';

/** 「立即运行」的两种目标（同一条命令 `article_schedule_run`，见 `api/article.ts`）。 */
type RunTarget = Parameters<typeof api.articleScheduleRun>[1];

/** `?? []` 每次渲染都是新引用，会把模板抽屉里那个预览 `useMemo` 的依赖每帧换掉（同 `NO_TEXTS`）。 */
const NO_COMPETITORS: Competitor[] = [];

/**
 * M6 文章管理 Article Studio（spec `2026-10-10-kb-redesign-and-article-studio-design.md` · DR-83 … DR-89）。
 *
 * # 三个工作区（DR-86）= 一条链，各自一个面板组件
 * ① 方向与策略（写什么、写给谁）→ ② 提示词模板（怎么问模型）→ ③ 排期与文章（什么时候问、
 * 问出来的东西谁审）。本页只做**接线**：取数、写路径、以及五张浮层（新增方向 / 模板抽屉 /
 * 排期弹窗 / 文章预览 / 导出）的开关；界面形态与各自的常驻说明写在面板组件自己的头注释里。
 *
 * # 🔴 demo 的三条边界，界面上逐条写明（DR-85 / AGENTS 规则 9、2、6）
 * - **不调模型**：「AI 生成方向」与两处「立即运行 / 立即生成」都从预置语料池按标题去重取，
 *   取空时回空数组 ⇒ 提示语说"预置语料已经用完"，不假装生成成功；
 * - **没有定时器**：`schedules.demoBody` 常驻，「下次运行」只是显示值；
 * - **不做合规扫描**：生成物恒 `pending_review`，待审行挂着 `review.complianceUnchecked`，
 *   导出闸门只放「已通过」（`api/article-compose.ts`）。
 *
 * # 🔴 两处「一条命令两件事」（DR-87 把命令面冻在 10 条）：方向**归档 / 恢复**走
 * `article_direction_add` 带 `id` 的那一支（`toggleDirection`），文章**批量通过**走
 * `article_list` 带 `review` 的那一支（`reviewMutation`）。两处都不是"顺手复用"，是命令面
 * 冻结下的唯一写法；真后端落地时应当拆开（差异台账 §4g E-64）。
 *
 * # 🔴 评审队列的筛选是**服务端**的（`article_list` 收 `status`，照 `site_patch_list`）
 * 不在前端过滤：真后端接生成管线后文章数是三位数起。导出闸门与方向卡的累计产出需要**全量**，
 * 所以另有一条 `status:'all'` 的查询——筛选在「全部」时两条键相同，React Query 自动去重。
 */
export default function ArticleStudioPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const [statusFilter, setStatusFilter] = useState<ArticleStatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [directionModalOpen, setDirectionModalOpen] = useState(false);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ArticleTemplate | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ArticleSchedule | null>(null);
  const [preview, setPreview] = useState<Article | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [directionBusyId, setDirectionBusyId] = useState<string | null>(null);
  const [runBusyId, setRunBusyId] = useState<string | null>(null);

  const enabled = projectId !== '';
  const directionQuery = useQuery({
    queryKey: ['article-directions', projectId],
    queryFn: () => api.articleDirectionList(projectId),
    enabled,
  });
  const templateQuery = useQuery({
    queryKey: ['article-templates', projectId],
    queryFn: () => api.articleTemplateList(projectId),
    enabled,
  });
  const scheduleQuery = useQuery({
    queryKey: ['article-schedules', projectId],
    queryFn: () => api.articleScheduleList(projectId),
    enabled,
  });
  /** 全量清单：导出闸门与方向卡的「累计产出」都要它（见文件头最后一段）。 */
  const allArticleQuery = useQuery({
    queryKey: ['articles', projectId, 'all'],
    queryFn: () => api.articleList(projectId, { status: 'all' }),
    enabled,
  });
  const queueQuery = useQuery({
    queryKey: ['articles', projectId, statusFilter],
    queryFn: () => api.articleList(projectId, { status: statusFilter }),
    enabled,
  });
  /** 模板抽屉的实时预览要用项目与竞品的**真实值**替换槽位（DR-86②），所以首屏就取。 */
  const detailQuery = useQuery({
    queryKey: ['project-detail', projectId],
    queryFn: () => projectGet(projectId),
    enabled,
  });

  const directions = useMemo(() => directionQuery.data ?? [], [directionQuery.data]);
  const templates = useMemo(() => templateQuery.data ?? [], [templateQuery.data]);
  const schedules = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  const allArticles = useMemo(() => allArticleQuery.data ?? [], [allArticleQuery.data]);
  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);

  const directionTitleOf = useMemo(() => directionTitleLookup(directions), [directions]);
  const templateNameOf = useMemo(() => templateNameLookup(templates), [templates]);
  const templateCounts = useMemo(() => countByDirection(templates), [templates]);
  const articleCounts = useMemo(() => countByDirection(allArticles), [allArticles]);

  /** 写完之后重取哪一份清单：四个 key 都以 `projectId` 收尾（`['articles', …]` 连带所有筛选档）。 */
  const refresh = (key: string) => {
    void queryClient.invalidateQueries({ queryKey: [key, projectId] });
  };

  /** 新增方向 + 归档 / 恢复共用一条命令（`draft.id` 有值即就地改，见文件头）。 */
  const directionMutation = useMutation({
    mutationFn: (draft: ArticleDirectionDraft) => api.articleDirectionAdd(projectId, draft),
    onMutate: (draft) => setDirectionBusyId(draft.id ?? null),
    onSuccess: (_row, draft) => {
      if (draft.id === undefined || draft.id === null) {
        message.success(t('article.directions.saved'));
        setDirectionModalOpen(false);
      } else if (draft.status === 'archived') {
        message.success(t('article.directions.archived'));
      } else {
        message.success(t('article.directions.restored'));
      }
      refresh('article-directions');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
    onSettled: () => setDirectionBusyId(null),
  });

  /** 🔴 不调模型：预置池挑不出来时 handler 回空数组，这里如实说"用完了"而不是报错。 */
  const directionGenerateMutation = useMutation({
    mutationFn: () => api.articleDirectionGenerate(projectId, 1),
    onSuccess: (added) => {
      if (added.length === 0) message.info(t('article.directions.generatedNone'));
      else message.success(t('article.directions.generated', { total: added.length }));
      refresh('article-directions');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const templateSaveMutation = useMutation({
    mutationFn: (draft: ArticleTemplateDraft) => api.articleTemplateSave(projectId, draft),
    onSuccess: () => {
      message.success(t('article.templates.saved'));
      setTemplateDrawerOpen(false);
      setEditingTemplate(null);
      refresh('article-templates');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const templateDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.articleTemplateDelete(projectId, ids),
    onSuccess: (_remaining, ids) => {
      message.success(t('article.templates.deleted', { total: ids.length }));
      // 🔴 handler 连带删了挂在这些模板上的排期 ⇒ 排期清单也要重取，否则表里留一条指向空模板的行。
      refresh('article-templates');
      refresh('article-schedules');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const scheduleSaveMutation = useMutation({
    mutationFn: (draft: ArticleScheduleDraft) => api.articleScheduleSave(projectId, draft),
    onSuccess: () => {
      message.success(t('article.schedules.saved'));
      setScheduleModalOpen(false);
      setEditingSchedule(null);
      refresh('article-schedules');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const runMutation = useMutation({
    mutationFn: (target: RunTarget) => api.articleScheduleRun(projectId, target),
    onMutate: (target) => setRunBusyId(target.scheduleId ?? target.templateId ?? null),
    onSuccess: (created, target) => {
      // 同一条命令两种语义 ⇒ 提示语也分两套（排期的账与模板的账不是一回事）。
      if (target.scheduleId !== undefined) {
        if (created.length === 0) message.info(t('article.schedules.ranNone'));
        else message.success(t('article.schedules.ran', { total: created.length }));
        refresh('article-schedules');
      } else if (created.length === 0) {
        message.info(t('article.templates.generatedNone'));
      } else {
        message.success(t('article.templates.generated', { total: created.length }));
      }
      refresh('articles');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
    onSettled: () => setRunBusyId(null),
  });

  /** 批量通过（搭在 `article_list` 的 `review` 入参上，见文件头）。 */
  const reviewMutation = useMutation({
    mutationFn: (decision: { ids: string[]; status: 'approved' | 'rejected' }) =>
      api.articleList(projectId, {
        status: statusFilter,
        review: { ids: decision.ids, status: decision.status },
      }),
    onSuccess: (_rows, decision) => {
      message.success(
        decision.status === 'approved'
          ? t('article.review.approved', { total: decision.ids.length })
          : t('article.review.rejected', { total: decision.ids.length }),
      );
      setSelectedIds([]);
      refresh('articles');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const markdown = useMemo(
    () => composeArticleMarkdown(allArticles, t, t('article.export.docTitle'), t('article.export.docNote')),
    [allArticles, t],
  );

  function toggleDirection(row: ArticleDirection) {
    directionMutation.mutate({
      id: row.id,
      status: row.status === 'archived' ? 'active' : 'archived',
    });
  }

  function confirmDeleteTemplate(row: ArticleTemplate) {
    modal.confirm({
      title: t('article.templates.deleteTitle'),
      content: t('article.templates.deleteCascade'),
      okText: t('article.templates.deleteOk'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => templateDeleteMutation.mutateAsync([row.id]),
    });
  }

  /** 行内开关：只翻 `enabled`，其余字段按库里那份原样回传（handler 的 `next_run_at` 随之清空 / 重算）。 */
  function toggleSchedule(row: ArticleSchedule, nextEnabled: boolean) {
    scheduleSaveMutation.mutate({
      id: row.id,
      template_id: row.template_id,
      freq: row.freq,
      time: row.time,
      weekday: row.weekday,
      enabled: nextEnabled,
    });
  }

  const firstError =
    directionQuery.error ??
    templateQuery.error ??
    scheduleQuery.error ??
    queueQuery.error ??
    allArticleQuery.error ??
    null;
  if (firstError !== null) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('article.loadFailed')}
        description={describeIpcError(firstError, t)}
      />
    );
  }

  const directionPane = (
    <ArticleDirectionPanel
      rows={directions}
      loading={directionQuery.isLoading}
      templateCounts={templateCounts}
      articleCounts={articleCounts}
      busyId={directionBusyId}
      generating={directionGenerateMutation.isPending}
      onAdd={() => setDirectionModalOpen(true)}
      onGenerate={() => directionGenerateMutation.mutate()}
      onToggleStatus={toggleDirection}
    />
  );

  const templatePane = (
    <ArticleTemplatePanel
      rows={templates}
      loading={templateQuery.isLoading}
      directionTitleOf={directionTitleOf}
      runBusyId={runBusyId}
      onCreate={() => {
        setEditingTemplate(null);
        setTemplateDrawerOpen(true);
      }}
      onEdit={(row) => {
        setEditingTemplate(row);
        setTemplateDrawerOpen(true);
      }}
      onRunNow={(row) => runMutation.mutate({ templateId: row.id })}
      onDelete={confirmDeleteTemplate}
    />
  );

  const pipelinePane = (
    <ArticlePipelinePanel
      schedules={schedules}
      schedulesLoading={scheduleQuery.isLoading}
      queue={queue}
      queueLoading={queueQuery.isLoading}
      directionTitleOf={directionTitleOf}
      templateNameOf={templateNameOf}
      runBusyId={runBusyId}
      statusFilter={statusFilter}
      onStatusFilterChange={(next) => {
        setStatusFilter(next);
        // 换筛选就清空勾选：留着"看不见的那些行"的勾选，批量通过会动到用户没在看的稿子。
        setSelectedIds([]);
      }}
      selectedIds={selectedIds}
      onSelectIds={setSelectedIds}
      approving={reviewMutation.isPending && reviewMutation.variables?.status === 'approved'}
      rejecting={reviewMutation.isPending && reviewMutation.variables?.status === 'rejected'}
      exportDisabled={markdown === null}
      onCreateSchedule={() => {
        setEditingSchedule(null);
        setScheduleModalOpen(true);
      }}
      onEditSchedule={(row) => {
        setEditingSchedule(row);
        setScheduleModalOpen(true);
      }}
      onToggleSchedule={toggleSchedule}
      onRunSchedule={(row) => runMutation.mutate({ scheduleId: row.id })}
      onApprove={() => reviewMutation.mutate({ ids: selectedIds, status: 'approved' })}
      onReject={() => reviewMutation.mutate({ ids: selectedIds, status: 'rejected' })}
      onExport={() => setExportOpen(true)}
      onPreview={setPreview}
    />
  );

  return (
    <div>
      <PageHeader title={t('article.title')} description={t('article.lead')} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('article.demoHint')} />

      {/* 三栏工作台（2026-11-02 产品裁定）：方向 → 模板 → 排期/评审同屏。
          窄窗（<1200）自动折行成两栏/一栏；每栏内部仍是原来的面板，写路径不变。 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 260px', minWidth: 240 }}>
          <SectionCard title={t('article.tabs.directions')}>{directionPane}</SectionCard>
        </div>
        <div style={{ flex: '1 1 400px', minWidth: 320 }}>
          <SectionCard title={t('article.tabs.templates')}>{templatePane}</SectionCard>
        </div>
        <div style={{ flex: '0 0 300px', minWidth: 280 }}>
          <SectionCard title={t('article.tabs.pipeline')}>{pipelinePane}</SectionCard>
        </div>
      </div>

      {directionModalOpen ? (
        <ArticleDirectionModal
          saving={directionMutation.isPending}
          onCancel={() => setDirectionModalOpen(false)}
          onSubmit={(values: ArticleDirectionFormValues) =>
            directionMutation.mutate({
              title: values.direction_title,
              summary: values.direction_summary,
            })
          }
        />
      ) : null}

      {templateDrawerOpen ? (
        <ArticleTemplateDrawer
          template={editingTemplate}
          directions={directions}
          project={detailQuery.data?.project ?? null}
          competitors={detailQuery.data?.competitors ?? NO_COMPETITORS}
          saving={templateSaveMutation.isPending}
          onClose={() => {
            setTemplateDrawerOpen(false);
            setEditingTemplate(null);
          }}
          onSubmit={(draft: ArticleTemplateDraft) => templateSaveMutation.mutate(draft)}
        />
      ) : null}

      {scheduleModalOpen ? (
        <ArticleScheduleModal
          schedule={editingSchedule}
          templates={templates}
          saving={scheduleSaveMutation.isPending}
          onCancel={() => {
            setScheduleModalOpen(false);
            setEditingSchedule(null);
          }}
          onSubmit={(draft: ArticleScheduleDraft) => scheduleSaveMutation.mutate(draft)}
        />
      ) : null}

      <ArticlePreviewDrawer
        article={preview}
        directionTitle={preview === null ? '' : directionTitleOf(preview.direction_id)}
        templateName={preview === null ? '' : templateNameOf(preview.template_id)}
        onClose={() => setPreview(null)}
      />

      <LibraryExportModal
        open={exportOpen}
        title={t('article.export.markdownTitle')}
        hint={t('article.export.markdownHint')}
        fileName={articleMarkdownFileName(projectId)}
        content={markdown ?? ''}
        withBom={false}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
