import { useMemo, useState } from 'react';
import { BROWSER_ONLY_SOURCE_KINDS, isStoreBuild } from '../api/build-flavor';
import { Alert, App, Button, Card, Col, Row, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import * as client from '../api/client';
import {
  MINIMUM_SAMPLE_SIZE,
  SEARCH_AI_SUMMARY_CSV_HEADER,
  SEARCH_QUERY_CSV_HEADER,
} from '../api/constants';
import { describeIpcError } from '../api/errors';
import { runtime } from '../api/runtime';
import { catalogEntryOf, renderableCatalog, searchSecretRef } from '../api/search-catalog';
import {
  defaultSearchFilter,
  filterNativeExtras,
  pivotMetrics,
  reconcile,
  suggestSources,
  summarizeMetrics,
  type SearchFilter,
} from '../api/search-compose';
import type {
  SearchBindingField,
  SearchMetricImportResult,
  SearchSource,
  SearchSourceKind,
} from '../api/types';
import AggregateSummaryBar from '../components/AggregateSummaryBar';
import AutoCollectStatusCard from '../components/AutoCollectStatusCard';
import OpportunityCard from '../components/OpportunityCard';
import SearchImportModal, { type SearchImportTemplate } from '../components/SearchImportModal';
import SearchMetricPanels from '../components/SearchMetricPanels';
import SearchPasteModal, { type SearchIngestValues } from '../components/SearchPasteModal';
import SearchSourceCards from '../components/SearchSourceCards';
import SearchSourceDrawer from '../components/SearchSourceDrawer';
import PageHeader from '../components/ui/PageHeader';
import type { TranslationKey } from '../i18n/resources';

/** 源那一组写操作合成一条 mutation（三者的成功处置逐字相同，照 `SitePage` 的 `channelMutation`）。 */
type SourceRequest =
  | { op: 'test'; kind: SearchSourceKind }
  | { op: 'remove'; kind: SearchSourceKind }
  | {
      op: 'save';
      kind: SearchSourceKind;
      binding: Partial<Record<SearchBindingField, string>>;
      note: string | null;
    };

const SOURCE_MESSAGE: Record<SourceRequest['op'], TranslationKey> = {
  save: 'webmasterData.sourceCards.saved',
  test: 'webmasterData.sourceCards.tested',
  remove: 'webmasterData.sourceCards.removed',
};

/** 两张模板（🔴 刻意没有第三张"站内分析模板"，理由见 `api/constants.ts`）。 */
const TEMPLATES: Record<SearchImportTemplate, readonly string[]> = {
  web: SEARCH_QUERY_CSV_HEADER,
  ai: SEARCH_AI_SUMMARY_CSV_HEADER,
};

/**
 * M5.5 站长数据（spec `2026-10-12-webmaster-data-integration-design.md` §5.3 五段 · DR-90…DR-118）。
 *
 * # 这一页解决什么
 * 最该接的那批源（百度《AI 流量分析》/ GSC 的生成式 AI 报告 / Bing AI Performance）**全都没有
 * 读数接口**，所以裁定是"导入 / 填报先行、OAuth 三家做但排后"（DR-90 / DR-93），并且把
 * **粘贴解析升为一等接入形态**（DR-113）：取数发生在客户自己的浏览器里，我们不碰凭据、
 * 不代登录（AGENTS 规则 11）。本页把平台第一方数字接进来、跨平台归一（DR-95 的 A/B/C 三类），
 * 与 L1 自有抽样对账（DR-116），再按 6 条规则端出优化机会（DR-100）。
 *
 * # 🔴 页面只做接线，一个数字都不算
 * A 类求和、B 类重算、筛选、交集区间、陈旧与采样判定全在 `api/search-compose.ts`（纯函数，
 * demo 与桌面端共用同一份）。所以"取消勾选一个平台 ⇒ 合计 / CTR / 区间当场重算"是
 * `setFilter` 触发重算的**数据流结果**，这里没有一处副作用在算指标（AGENTS 规则 9）。
 *
 * # 🔴 三句常驻说明各就各位（DR-99，走查 4）
 * `demoBody` 贴页顶、`metricNote` 贴汇总段顶、`staticNote` 贴机会段顶，
 * **一律直接渲染**、不藏进问号 tooltip；`pasteNote` 常驻在粘贴弹窗底部（DR-113）。
 * 这一页"一半真一半假"（汇总真算、机会是静态清单），不说清就会被读成"分析坏了"。
 *
 * # 🔴 五段各归一个组件（单文件 ≤400 行的拆分口径）
 * ① 数据源墙 + 接入建议条 → `SearchSourceCards`；① 末的自动采集状态卡 → `AutoCollectStatusCard`；
 * ② 汇总条 + 四个筛选器 → `AggregateSummaryBar`；③④ AI 引用表现 / C 类面板 / 对账密集表 →
 * `SearchMetricPanels`；⑤ 一张机会卡 → `OpportunityCard`。本页只留状态、IPC 接线与段序。
 *
 * # 接入建议条（DR-111）
 * 分布数字来自 `search_board` 的 `traffic_split`（真后端由百度统计的来源分析算出，demo 由种子端出），
 * 建议本身由 `suggestSources` 在前端现算。🔴 **空数组是合法输入**：没有站内分析数据时
 * `suggestSources` 回空、界面显示 `onboarding.empty`（"没有数据时不显示任何通用推荐"），
 * **不**编一份市场份额表出来——同一时期百度份额有 38.1% 与 53.32% 两种口径，猜必错。
 */
export default function WebmasterDataPage() {
  const { id: projectId = '' } = useParams();
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 🔴 筛选态只存 `useState`、不落 localStorage（DR-112）：刷新即重置，
  // 免得第二天打开看到一份"不知道谁筛过的"合计。
  const [filter, setFilter] = useState<SearchFilter>(defaultSearchFilter);
  const [configuring, setConfiguring] = useState<SearchSourceKind | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ingestResult, setIngestResult] = useState<SearchMetricImportResult | null>(null);

  const boardQuery = useQuery({
    queryKey: ['search-board', projectId],
    queryFn: () => client.searchBoard(projectId),
    enabled: projectId !== '',
  });

  const board = boardQuery.data;
  // 陈旧判定要一个"今天"：由命令端给（demo 固定种子日期），不从系统时间各取一次。
  // 数据还没到时才回落到系统日期；加载完成后整个页面用同一个锚点。
  const asOf = board?.as_of ?? dayjs().format('YYYY-MM-DD');
  // 🔴 锚点还没就绪时先关掉三个取数入口（P3）：粘贴 / 导入弹窗与人工填报的默认区间都从
  // `board.as_of` 推导，此时放行会让默认区间落到系统日期，与页面锚点不一致。
  const ingestDisabled = board === undefined;
  // 🔴 逐个 memo：`?? []` 每次渲染都是新数组，直接当依赖会让下游每帧重算（照 `SitePage`）。
  const sources = useMemo(() => board?.sources ?? [], [board]);
  const metrics = useMemo(() => board?.metrics ?? [], [board]);
  const overviews = useMemo(() => board?.ai_overviews ?? [], [board]);
  const extras = useMemo(() => board?.native_extras ?? [], [board]);
  const opportunities = useMemo(() => board?.opportunities ?? [], [board]);
  const summary = board?.self_index_summary ?? null;
  const trafficSplit = useMemo(() => board?.traffic_split ?? [], [board]);
  const selfIndexSnapshots = useMemo(() => board?.self_index_snapshots ?? [], [board]);
  const reconciliation = useMemo(
    () => reconcile(selfIndexSnapshots, metrics),
    [selfIndexSnapshots, metrics],
  );

  // AI 汇总与 C 类面板也跟平台 / 时间筛选走；不能合计变了、上面那两块还报全量。
  const visibleOverviews = useMemo(
    () =>
      overviews.filter(
        (row) =>
          (filter.source_kinds.length === 0 || filter.source_kinds.includes(row.source_kind)) &&
          (filter.from === null || row.period_end >= filter.from) &&
          (filter.to === null || row.period_start <= filter.to),
      ),
    [filter, overviews],
  );
  const visibleExtras = useMemo(
    () => filterNativeExtras(extras, metrics, filter),
    [extras, metrics, filter],
  );

  const aggregate = useMemo(
    () => summarizeMetrics(metrics, filter, asOf),
    [metrics, filter, asOf],
  );
  const pivotRows = useMemo(() => pivotMetrics(metrics, filter), [metrics, filter]);
  /** 平台筛选器与两个导入弹窗的可选集：一期源（二期源一个入口都不给，DR-92）。 */
  // 2026-11-13 裁定 B8：Store 版不提供更依赖浏览器取数的数据源新建入口
  const platformOptions = useMemo(
    () =>
      renderableCatalog()
        .filter((entry) => !isStoreBuild() || !BROWSER_ONLY_SOURCE_KINDS.includes(entry.kind))
        .map((entry) => entry.kind),
    [],
  );
  const suggestions = useMemo(() => suggestSources(trafficSplit), [trafficSplit]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['search-board', projectId] });
  };

  const sourceMutation = useMutation({
    // 🔴 三个 op 的返回形状刻意不统一（`save` / `test` 回单条、`remove` 回剩余快照，
    // 照 handler 的既有取舍）⇒ 标成 `Promise<unknown>`，不让 TS 推出联合类型。
    mutationFn: async (request: SourceRequest): Promise<unknown> => {
      switch (request.op) {
        case 'save':
          return client.searchSourceUpsert(projectId, request.kind, request.binding, request.note);
        case 'test':
          return client.searchSourceTest(projectId, request.kind);
        case 'remove':
          return client.searchSourceRemove(projectId, request.kind);
      }
    },
    onSuccess: (_result, request) => {
      message.success(t(SOURCE_MESSAGE[request.op]));
      setConfiguring(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });
  const busyKind = sourceMutation.isPending ? (sourceMutation.variables?.kind ?? null) : null;

  const ingestMutation = useMutation({
    mutationFn: (values: SearchIngestValues) =>
      client.searchMetricImportCsv(
        projectId,
        values.kind,
        values.payload,
        values.periodStart,
        values.periodEnd,
      ),
    onSuccess: (result) => {
      // 🔴 弹窗**不关**：行级错误与警告要在原地看得见（走查 8），而合计已经在背后重算了（走查 9）。
      setIngestResult(result);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const opportunityMutation = useMutation({
    mutationFn: (request: { id: string; status: 'adopted' | 'ignored' }) =>
      client.searchOpportunityUpdate(request.id, request.status),
    onSuccess: () => {
      message.success(t('webmasterData.opportunity.updated'));
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  /** 模板下载走既有 `export_write_file`（DR-97 ③：不新增导出出口）。 */
  async function downloadTemplate(template: SearchImportTemplate) {
    try {
      const saved = await client.exportWriteFile(
        `search-template-${template}.csv`,
        `${TEMPLATES[template].join(',')}\n`,
        true,
        t('common.exportDialogTitle'),
      );
      if (saved !== null) message.success(saved);
    } catch (error) {
      message.error(describeIpcError(error, t));
    }
  }

  if (boardQuery.isError) {
    // 桌面端点进来就是这一屏（`ipc/unknown_command`，走查 18：预期行为，不屏蔽）。
    return (
      <Alert
        type="error"
        showIcon
        message={t('webmasterData.loadFailed')}
        description={describeIpcError(boardQuery.error, t)}
      />
    );
  }

  const configuringSource: SearchSource | null =
    configuring === null ? null : sourceForConfiguring(configuring, sources, projectId);

  return (
    <div>
      <PageHeader
        title={t('webmasterData.title')}
        description={t('webmasterData.lead')}
        actions={
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t('common.refresh')}
          </Button>
        }
      />

      {/* 🔴 常驻说明①（DR-99）：演示模式不联网、OAuth 一条都没实现。 */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 8 }}
        message={t(runtime === 'demo' ? 'webmasterData.demoBody' : 'webmasterData.liveBody')}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('webmasterData.trademarkNote')}
      </Typography.Paragraph>

      {/* ① 数据源：接入建议条 + 三分组卡片墙（DR-104 / DR-111）。 */}
      <SearchSourceCards
        sources={sources}
        metrics={metrics}
        asOf={asOf}
        suggestions={suggestions}
        busyKind={busyKind}
        onConfigure={setConfiguring}
        configureDisabled={ingestDisabled}
      />

      {/* ① 末：L1 自有抽样 + L2 令牌状态（DR-116 / DR-118，卡上不画 CTR 曲线）。 */}
      <AutoCollectStatusCard summary={summary} sources={sources} />

      {/* 🔴 常驻说明③（DR-99）：三层归一的口径，贴在汇总段顶。 */}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('webmasterData.metricNote')}
      </Typography.Paragraph>

      {/* ② 汇总：合计 + 区间 + 参与源 + 旗标 + 四个筛选器（DR-95 / DR-109 / DR-110 / DR-112）。 */}
      <AggregateSummaryBar
        aggregate={aggregate}
        filter={filter}
        platformOptions={platformOptions}
        asOf={asOf}
        onFilterChange={setFilter}
      />

      {/* ③ AI 引用表现 + C 类平台独有面板；④ 对账密集表（粘贴主按钮 / 导入次按钮）。 */}
      <SearchMetricPanels
        overviews={visibleOverviews}
        extras={visibleExtras}
        pivotRows={pivotRows}
        pivot={filter.pivot}
        loading={boardQuery.isFetching}
        reconcile={reconciliation}
        ingestDisabled={ingestDisabled}
        onPaste={() => {
          setIngestResult(null);
          setPasteOpen(true);
        }}
        onImport={() => {
          setIngestResult(null);
          setImportOpen(true);
        }}
      />

      {/* ⑤ 优化机会（DR-100 / DR-102）。🔴 常驻说明②贴在段顶：机会是静态清单，不随导入变化。 */}
      <Card
        size="small"
        title={t('webmasterData.opportunity.title')}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.opportunity.hint')}
          </Typography.Text>
        }
      >
        {runtime === 'demo' && (
          <>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('webmasterData.staticNote')}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('webmasterData.opportunity.demoStatic')}
            </Typography.Paragraph>
          </>
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.opportunity.sampleGate', { min: MINIMUM_SAMPLE_SIZE })}
        </Typography.Paragraph>
        {opportunities.length === 0 ? (
          <Typography.Text type="secondary">{t('webmasterData.opportunity.empty')}</Typography.Text>
        ) : (
          <Row gutter={[12, 12]}>
            {opportunities.map((row) => (
              <Col key={row.id} xs={24} lg={12} xl={8}>
                <OpportunityCard
                  opportunity={row}
                  busy={opportunityMutation.isPending && opportunityMutation.variables?.id === row.id}
                  onStatus={(item, status) =>
                    opportunityMutation.mutate({ id: item.id, status: status as 'adopted' | 'ignored' })
                  }
                  onToArticle={() => navigate(`/projects/${projectId}/articles`)}
                  onToPatch={() => navigate(`/projects/${projectId}/site`)}
                />
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {configuringSource === null ? null : (
        <SearchSourceDrawer
          source={configuringSource}
          asOf={asOf}
          busy={busyKind === configuringSource.kind}
          onClose={() => setConfiguring(null)}
          onSave={(binding, note) =>
            sourceMutation.mutate({ op: 'save', kind: configuringSource.kind, binding, note })
          }
          onTest={() => sourceMutation.mutate({ op: 'test', kind: configuringSource.kind })}
          onRemove={() =>
            modal.confirm({
              title: t('webmasterData.sourceCards.remove'),
              content: t('webmasterData.sourceCards.hint'),
              okText: t('common.confirm'),
              okButtonProps: { danger: true },
              cancelText: t('common.cancel'),
              onOk: () => sourceMutation.mutateAsync({ op: 'remove', kind: configuringSource.kind }),
            })
          }
        />
      )}

      {pasteOpen ? (
        <SearchPasteModal
          sources={platformOptions.filter((kind) => supports(kind, 'paste_parse'))}
          defaultKind="baidu_ziyuan_ai"
          asOf={asOf}
          importing={ingestMutation.isPending}
          result={ingestResult}
          onCancel={() => setPasteOpen(false)}
          onSubmit={(values) => ingestMutation.mutate(values)}
        />
      ) : null}

      {importOpen ? (
        <SearchImportModal
          sources={platformOptions.filter((kind) => supports(kind, 'file_import'))}
          defaultKind="baidu_ziyuan_ai"
          asOf={asOf}
          importing={ingestMutation.isPending}
          result={ingestResult}
          onCancel={() => setImportOpen(false)}
          onSubmit={(values) => ingestMutation.mutate(values)}
          onTemplate={(template) => void downloadTemplate(template)}
        />
      ) : null}
    </div>
  );
}

/** 这个源支不支持某种取数形态：查目录表，不查“已经建过档的那一行”。 */
function supports(kind: SearchSourceKind, mode: 'paste_parse' | 'file_import'): boolean {
  return catalogEntryOf(kind).ingest_modes.includes(mode);
}

/**
 * 配置侧滑需要的源行：已有行就用它；还没有行（新项目 / 刚移除）就按目录表合成一张
 * 「未配置」草稿。🔴 不能要求先有行才能打开侧滑——否则「配置」按钮在新建项目里是死的。
 * `id` 只是 React/Drawer 的占位，保存 / 自检 / 移除都按 `kind` 走命令面。
 */
function sourceForConfiguring(
  kind: SearchSourceKind,
  sources: readonly SearchSource[],
  projectId: string,
): SearchSource {
  const existing = sources.find((row) => row.kind === kind);
  if (existing !== undefined) return existing;
  const entry = catalogEntryOf(kind);
  return {
    id: `draft-${kind}`,
    project_id: projectId,
    kind,
    auth_mode: entry.auth_mode,
    ingest_modes: [...entry.ingest_modes],
    status: 'not_configured',
    region: entry.region,
    group: entry.group,
    binding: {},
    credentials_state: entry.auth_mode === 'oauth' ? 'missing' : 'not_required',
    secret_ref: entry.auth_mode === 'none' ? null : searchSecretRef(kind),
    data_through: null,
    checked_at: null,
    check_detail: null,
    note: null,
    created_at: '',
    updated_at: '',
  };
}
