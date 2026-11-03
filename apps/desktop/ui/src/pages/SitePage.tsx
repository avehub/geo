import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import * as site from '../api/site';
import { siteExportFileName } from '../api/site-compose';
import type { SiteChannelKind, SitePatch, SitePatchKind, SitePatchTransition } from '../api/types';
import SiteChannelCards from '../components/SiteChannelCards';
import SiteExportModal from '../components/SiteExportModal';
import SitePatchEditorModal, { type SitePatchFormValues } from '../components/SitePatchEditorModal';
import SitePatchGenerateModal from '../components/SitePatchGenerateModal';
import SitePatchHistoryModal from '../components/SitePatchHistoryModal';
import SitePatchTable from '../components/SitePatchTable';
import SitePatchToolbar from '../components/SitePatchToolbar';
import SiteProfileCard, { type SiteProfileFormValues } from '../components/SiteProfileCard';
import PageHeader from '../components/ui/PageHeader';
import {
  ALL_SITE_PATCH_FILTERS,
  filterSitePatches,
  type SitePatchFilters,
} from '../components/site-patch-filters';
import type { TranslationKey } from '../i18n/resources';

/** 发布 / 撤回 / 回滚三个动作各自的成功提示。 */
const TRANSITION_MESSAGE: Record<SitePatchTransition, TranslationKey> = {
  publish: 'site.patches.published',
  unpublish: 'site.patches.unpublished',
  rollback: 'site.patches.rolledBack',
};

/**
 * 通道那三个写操作合成**一条** mutation（照 `site_patch_transition` 把三个动作合成一条命令的取舍）：
 * 它们的成功处置逐字相同（提示 + 重取 `site_board`），拆三条就要把 `onError` 抄三遍。
 * `kind` 留在 union 的每一支上，是为了让按钮的 loading 只落在**被点的那张卡**上。
 */
type ChannelRequest =
  | { op: 'test'; kind: SiteChannelKind }
  | { op: 'clear'; kind: SiteChannelKind }
  | {
      op: 'save';
      kind: SiteChannelKind;
      endpoint: string | null;
      username: string | null;
      note: string | null;
    };

const CHANNEL_MESSAGE: Record<ChannelRequest['op'], TranslationKey> = {
  test: 'site.channels.tested',
  save: 'site.channels.saved',
  clear: 'site.channels.cleared',
};

/**
 * M6.5 站点接入与补丁工作台（spec `2026-09-30-site-connect-patch-bench-design.md`）。
 *
 * # 这一页解决什么
 * 行动中心开出来的处方里，落点是**客户自己官网**的那几条（`llms.txt`、放行 AI 爬虫、
 * FAQ 区块与 `FAQPage` 标记、可被引用的定义句、实体口径统一）以前只能"翻个状态 + 生成一份文稿"，
 * 「文稿 → 官网上真的变了」这一段是断的。这一页把它接起来：
 * 处方 → 补丁台账 → 发布 / 撤回 / 回滚 → 可交付的落地文件（DR-45 / DR-50）。
 *
 * # 🔴 两条查询刻意与别的页**共用缓存键**
 * - `['action-board', projectId]` 与 `pages/ActionPage.tsx` 逐字相同 ⇒ 那边翻完处方状态，
 *   切到本页看到的还是同一份（生成弹窗要列处方、台账要显示"来自哪条处方"）；
 * - `['project', projectId]` 与 `pages/PromptSetPage.tsx` 相同 ⇒ 只为拿 `website`：
 *   站点域名是它的镜像（DR-49），档案还没建时要预告"域名会自动带过来"。
 *
 * # 🔴 `?from=<action_id>` 是行动中心那个入口的落点（DR-50）
 * 带上它就自动打开生成弹窗并预选那条处方；关掉弹窗时把参数抹掉，
 * 否则刷新页面又会弹一次（"我明明关掉了它又回来了"是最恼人的那种界面）。
 *
 * # 🔴 demo 的边界（DR-56）
 * `demoBody` 与 `staticNote` 两句常驻：发布 / 撤回 / 回滚只在本地记账、线上站点一个字节都不会变；
 * 页面清单与通道自检结论都是预置静态值。
 */
export default function SitePage() {
  const { id: projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const fromActionId = searchParams.get('from');

  const [filters, setFilters] = useState<SitePatchFilters>(ALL_SITE_PATCH_FILTERS);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editing, setEditing] = useState<SitePatch | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // 工具条上「从处方生成」那个入口的开关；`?from=` 那个入口是**派生**出来的（见下面）。
  const [generateRequested, setGenerateRequested] = useState(false);
  const [historyFor, setHistoryFor] = useState<SitePatch | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const boardQuery = useQuery({
    queryKey: ['site-board', projectId],
    queryFn: () => site.siteBoard(projectId),
    enabled: projectId !== '',
  });
  const actionsQuery = useQuery({
    queryKey: ['action-board', projectId],
    queryFn: () => action.actionBoard(projectId),
    enabled: projectId !== '',
  });
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.projectGet(projectId),
    enabled: projectId !== '',
  });

  // 编辑弹窗底部那一小段历史与「历史」弹窗共用同一条查询：同一时刻只可能开着一个。
  const eventsForId = editing?.id ?? historyFor?.id ?? null;
  const historyQuery = useQuery({
    queryKey: ['site-patch-history', eventsForId],
    queryFn: () => site.sitePatchHistory(eventsForId as string),
    enabled: eventsForId !== null,
  });

  const board = boardQuery.data;
  // 🔴 逐个 memo：`?? []` 每次渲染都新建数组，直接当依赖会让下游每帧重算
  // （`react-hooks/exhaustive-deps` 点名的就是这个形状，照 `KeywordLibraryPage`）。
  const patches = useMemo(() => board?.patches ?? [], [board]);
  const pages = useMemo(() => board?.pages ?? [], [board]);
  const channels = useMemo(() => board?.channels ?? [], [board]);
  const pool = useMemo(() => board?.pool ?? [], [board]);
  const actions = useMemo(() => actionsQuery.data?.actions ?? [], [actionsQuery.data]);
  const actionTitles = useMemo(
    () => new Map(actions.map((item) => [item.id, item.title])),
    [actions],
  );
  const visible = useMemo(() => filterSitePatches(patches, filters), [patches, filters]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['site-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['site-patch-history'] });
  };

  /**
   * 🔴 行动中心那个入口**派生**出来，不用 effect 往 state 里抄一份。
   *
   * `?from=` 在 URL 里、`site_board` 在查询缓存里，两者都已经是状态；再抄一份进 `useState`
   * 就得靠 effect 同步（`react-hooks/set-state-in-effect` 点名的正是这个形状，而且它会多渲染一帧）。
   * 「等 board 真的到了再弹」这个要求由 `boardQuery.isSuccess` 这一项直接表达：
   * 早一帧弹窗里的处方清单还是空的。
   */
  const generateFromUrl = fromActionId !== null && fromActionId !== '' && boardQuery.isSuccess;
  const generateOpen = generateRequested || generateFromUrl;

  const closeGenerate = () => {
    setGenerateRequested(false);
    // 抹掉 `?from=`：留着的话刷新页面又会弹一次（派生项随之变 false，不需要第二个开关）。
    if (fromActionId !== null) setSearchParams({}, { replace: true });
  };

  const profileMutation = useMutation({
    mutationFn: (values: SiteProfileFormValues) =>
      site.siteProfileSave(projectId, values.platform, values.ownership, values.note),
    onSuccess: () => {
      message.success(t('site.profile.saved'));
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const channelMutation = useMutation({
    // 🔴 返回类型标成 `Promise<unknown>`：三个 op 的返回形状**刻意不统一**
    // （`test` / `save` 回单条、`clear` 回剩余快照，照 handler 的既有取舍），
    // 不标的话 TS 会推出联合类型，`useMutation` 的 `TData` 就定不下来。
    mutationFn: async (request: ChannelRequest): Promise<unknown> => {
      switch (request.op) {
        case 'test':
          return site.siteChannelTest(projectId, request.kind);
        case 'clear':
          return site.siteChannelRemove(projectId, request.kind);
        case 'save':
          return site.siteChannelUpsert(
            projectId,
            request.kind,
            request.endpoint,
            request.username,
            request.note,
          );
      }
    },
    onSuccess: (_result, request) => {
      message.success(t(CHANNEL_MESSAGE[request.op]));
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });
  const busyChannelKind = channelMutation.isPending
    ? (channelMutation.variables?.kind ?? null)
    : null;

  const transitionMutation = useMutation({
    mutationFn: (request: { id: string; transition: SitePatchTransition }) =>
      site.sitePatchTransition(request.id, request.transition),
    onSuccess: (patch, request) => {
      message.success(t(TRANSITION_MESSAGE[request.transition]));
      void queryClient.invalidateQueries({ queryKey: ['site-board', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['site-patch-history', patch.id] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });
  const busyAction = transitionMutation.isPending ? (transitionMutation.variables ?? null) : null;

  const saveMutation = useMutation({
    mutationFn: (patch: SitePatch) => site.sitePatchSave(patch),
    onSuccess: () => {
      message.success(t('site.patches.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const addMutation = useMutation({
    mutationFn: (values: SitePatchFormValues) =>
      site.sitePatchAdd(projectId, {
        kind: values.kind,
        title: values.title,
        target_url: values.target_url,
        target_hint: values.target_hint,
        body: values.body,
        channel_kind: values.channel_kind,
      }),
    onSuccess: () => {
      message.success(t('site.patches.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const generateMutation = useMutation({
    mutationFn: (request: { actionId: string; kinds: SitePatchKind[] }) =>
      site.sitePatchGenerate(projectId, request.actionId, request.kinds),
    onSuccess: (created) => {
      // 🔴 空数组不是错误：那条处方的补丁已经全在台账里了（`handlers/site-patch.ts` 的等值去重）。
      if (created.length === 0) message.info(t('site.generate.alreadyAll'));
      else message.success(t('site.patches.generated', { total: created.length }));
      closeGenerate();
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: t('site.patches.deleteConfirmTitle'),
      content: t('site.patches.deleteConfirmContent', { total: ids.length }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await site.sitePatchDelete(projectId, ids);
          message.success(t('site.patches.deleted', { total: ids.length }));
          setSelectedKeys([]);
          refresh();
        } catch (error) {
          message.error(describeIpcError(error, t));
        }
      },
    });
  }

  function submitEditor(values: SitePatchFormValues) {
    if (editing === null) addMutation.mutate(values);
    else saveMutation.mutate({ ...editing, ...values });
  }

  if (boardQuery.isError) {
    return <Alert type="error" showIcon message={describeIpcError(boardQuery.error, t)} />;
  }

  // `patches.json` 的托管地址：边缘函数骨架里那一行 `PATCHES_URL` 要用（DR-53⑤）。
  const domain = board?.profile?.domain ?? projectQuery.data?.project.website ?? '';
  const patchesUrl =
    domain === ''
      ? ''
      : `${domain.replace(/\/+$/, '')}/${siteExportFileName(projectId, 'patches_json')}`;

  return (
    <div>
      <PageHeader
        title={t('site.title')}
        description={t('site.subtitle')}
        actions={
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t('common.refresh')}
          </Button>
        }
      />

      <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={t('site.demoBody')} />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('site.staticNote')}
      </Typography.Paragraph>

      <SiteProfileCard
        profile={board?.profile ?? null}
        pages={pages}
        website={projectQuery.data?.project.website ?? null}
        saving={profileMutation.isPending}
        onSave={(values) => profileMutation.mutate(values)}
      />

      <SiteChannelCards
        channels={channels}
        busyKind={busyChannelKind}
        onTest={(kind) => channelMutation.mutate({ op: 'test', kind })}
        onSave={(kind, endpoint, username, note) =>
          channelMutation.mutate({ op: 'save', kind, endpoint, username, note })
        }
        onClear={(kind) =>
          modal.confirm({
            title: t('site.channels.clear'),
            content: t('site.channels.clearConfirm'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: () => channelMutation.mutateAsync({ op: 'clear', kind }),
          })
        }
      />

      <Card
        size="small"
        title={t('site.patches.title')}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('site.patches.hint')}
          </Typography.Text>
        }
      >
        <SitePatchToolbar
          filters={filters}
          onFiltersChange={(next) => {
            setFilters(next);
            // 选区跟着筛选走：删除按 selectedKeys 执行，不能留下筛选外的行。
            setSelectedKeys([]);
          }}
          shown={visible.length}
          total={patches.length}
          selectedCount={selectedKeys.length}
          onGenerate={() => setGenerateRequested(true)}
          onAdd={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
          onExport={() => setExportOpen(true)}
          onDeleteSelected={() => confirmDelete(selectedKeys)}
        />

        <SitePatchTable
          rows={visible}
          loading={boardQuery.isFetching}
          selectedRowKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          actionTitles={actionTitles}
          busyAction={busyAction}
          onEdit={(row) => {
            setEditing(row);
            setEditorOpen(true);
          }}
          onReviewChange={(row, reviewStatus) =>
            saveMutation.mutate({ ...row, review_status: reviewStatus })
          }
          onTransition={(row, transition) =>
            transitionMutation.mutate({ id: row.id, transition })
          }
          onHistory={setHistoryFor}
          onDelete={(row) => confirmDelete([row.id])}
          onOpenAction={() => navigate(`/projects/${projectId}/action`)}
        />
      </Card>

      {editorOpen ? (
        <SitePatchEditorModal
          patch={editing}
          pages={pages}
          events={historyQuery.data ?? []}
          saving={editing === null ? addMutation.isPending : saveMutation.isPending}
          onCancel={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSubmit={submitEditor}
        />
      ) : null}

      {generateOpen ? (
        <SitePatchGenerateModal
          actions={actions}
          pool={pool}
          presetActionId={fromActionId}
          generating={generateMutation.isPending}
          onCancel={closeGenerate}
          onGenerate={(actionId, kinds) => generateMutation.mutate({ actionId, kinds })}
        />
      ) : null}

      {historyFor === null ? null : (
        <SitePatchHistoryModal
          patchTitle={historyFor.title}
          events={historyQuery.data ?? []}
          loading={historyQuery.isFetching}
          onClose={() => setHistoryFor(null)}
        />
      )}

      <SiteExportModal
        open={exportOpen}
        projectId={projectId}
        patches={visible}
        allPatches={patches}
        patchesUrl={patchesUrl}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
