import { Button, Card, Collapse, Col, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileTextOutlined, QuestionCircleOutlined, SnippetsOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import {
  type SearchReconcileResult,
  type SearchReconcileRow,
  type SearchPivotDimension,
  type SearchPivotRow,
} from '../api/search-compose';
import { ENGINE_VALUES } from '../api/types';
import type {
  SearchAiOverview,
  SearchCompleteness,
  SearchNativeExtra,
} from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { countText, percentText } from './format';

export interface SearchMetricPanelsProps {
  /** ③ 百度《AI 流量分析》的五项汇总（`search_board` 的 `ai_overviews`）。 */
  overviews: SearchAiOverview[];
  /** ③ C 类：映射不上的平台原生字段，逐项带平台徽章（DR-107：不静默丢弃）。 */
  extras: SearchNativeExtra[];
  /** ④ 已经透视好的行（`pivotMetrics`，本组件不重算）。 */
  pivotRows: SearchPivotRow[];
  /** 当前透视维度：决定密集表首列的列名与"N 个平台"标注是否出现。 */
  pivot: SearchPivotDimension;
  loading: boolean;
  /** L1 自有抽样 vs L3 平台口径（DR-116）；没有快照时为空结果。 */
  reconcile: SearchReconcileResult;
  /** 主按钮（DR-113）：粘贴后台表格。 */
  onPaste: () => void;
  /** 次按钮：导入 CSV / XLSX。 */
  onImport: () => void;
  /**
   * `search_board` 还没回来时置灰两个取数入口。
   * 🔴 弹窗的默认区间从 `board.as_of` 推导（不取系统日期），board 未到时放行会落错区间。
   */
  ingestDisabled?: boolean;
}

/** 透视维度 → 密集表首列的列名键（`engine` 那一档在词典里叫 `platform`）。 */
const DIMENSION_COLUMN = { query: 'query', page: 'page', engine: 'platform' } as const;

/**
 * 站长数据页的第 ③ ④ 两段（spec `2026-10-12-webmaster-data-integration-design.md` §5.3，
 * DR-95 / DR-107 / DR-113 / DR-116，走查 6 / 12 / 13 / 14）。
 *
 * # 🔴 AI 面的点击率**只在这里**给（DR-95 B 类）
 * 它的分母是「引用量」，与 GSC 的 impressions、搜狗的查询量都不是一回事 ⇒ 第 2 段的汇总条
 * 刻意不摆这一格，摆在这里并挂一句 tooltip 写清分母。这一个 tooltip 是**允许的**：
 * 四句常驻说明（`demoBody` / `metricNote` / `staticNote` / `pasteNote`）不在这一组里（DR-99）。
 *
 * # 🔴 第 ④ 段的分区标题是**对账**语义（DR-116）
 * L3（导入 / 粘贴 / 填报）是校准层，不是主喂料。所以这一段叫「对账」而不叫"数据导入"：
 * 标题就是这一轮最重要的一句定位。粘贴是主按钮、CSV 导入降为次按钮（DR-113）。
 *
 * # 🔴 密集表一个数字都不算
 * 透视、合并、重算 CTR 全在 `api/search-compose.ts` 的 `pivotMetrics`（纯函数）。
 * 多源合并的行写明"合并了几个平台"（走查 12）；按平台透视时它恒为 1，就不标。
 */
export default function SearchMetricPanels({
  overviews,
  extras,
  pivotRows,
  pivot,
  loading,
  reconcile,
  onPaste,
  onImport,
  ingestDisabled = false,
}: SearchMetricPanelsProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<SearchPivotRow> = [
    {
      title: t(`webmasterData.metrics.columns.${DIMENSION_COLUMN[pivot]}`, { nsSeparator: false }),
      dataIndex: 'display',
      width: 220,
      render: (_value: string, row) => (
        <Space size={4} wrap>
          <Typography.Text>
            {pivot === 'engine' ? enumLabel(t, 'webmasterData.sources', row.display) : row.display}
          </Typography.Text>
          {pivot === 'engine' || row.source_kinds.length < 2 ? null : (
            <Tag>{t('webmasterData.metrics.multiPlatform', { total: row.source_kinds.length })}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('webmasterData.metrics.columns.impressions'),
      dataIndex: 'impressions',
      width: 110,
      render: (value: number) => countText(value),
    },
    {
      title: t('webmasterData.metrics.columns.clicks'),
      dataIndex: 'clicks',
      width: 100,
      render: (value: number) => countText(value),
    },
    {
      // 🔴 重算值（Σclicks ÷ Σimpressions），不是把各行的 `ctr` 平均（DR-95 B 类）。
      title: t('webmasterData.metrics.columns.ctr'),
      dataIndex: 'ctr',
      width: 90,
      render: (value: number | null) => (value === null ? '—' : percentText(value)),
    },
    {
      title: t('webmasterData.metrics.columns.citations'),
      dataIndex: 'citations',
      width: 90,
      render: (value: number) => (value === 0 ? '—' : countText(value)),
    },
    {
      title: t('webmasterData.metrics.columns.completeness'),
      dataIndex: 'completeness',
      width: 100,
      render: (value: SearchCompleteness) => enumLabel(t, 'webmasterData.completeness', value),
    },
    { title: t('webmasterData.metrics.columns.dataThrough'), dataIndex: 'data_through', width: 110 },
  ];

  return (
    <>
      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={t('webmasterData.aiOverview.title')}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.aiOverview.hint')}
          </Typography.Text>
        }
      >
        {overviews.length === 0 ? (
          <Typography.Text type="secondary">{t('webmasterData.aiOverview.empty')}</Typography.Text>
        ) : (
          overviews.map((row) => (
            <Row key={row.id} gutter={[16, 8]} align="middle" style={{ marginBottom: 8 }}>
              <Col xs={24} md={6}>
                {/* 🔴 C 类平台独有面板与 AI 汇总都带平台徽章（走查 14）：不猜口径、不合并。 */}
                <Tag color="blue">{enumLabel(t, 'webmasterData.sources', row.source_kind)}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  {t('webmasterData.aiOverview.period', {
                    start: row.period_start,
                    end: row.period_end,
                    through: row.data_through,
                  })}
                </Typography.Text>
              </Col>
              <AiStat label={t('webmasterData.aiOverview.citations')} value={nullableCountText(row.citations)} />
              <AiStat
                label={t('webmasterData.aiOverview.impressions')}
                value={nullableCountText(row.ai_impressions)}
              />
              <AiStat label={t('webmasterData.aiOverview.clicks')} value={nullableCountText(row.ai_clicks)} />
              <AiStat
                label={t('webmasterData.aiOverview.ctr')}
                value={row.ai_ctr === null ? '—' : percentText(row.ai_ctr)}
                note={t('webmasterData.aiOverview.ctrNote')}
              />
              <AiStat
                label={t('webmasterData.aiOverview.citedPages')}
                value={nullableCountText(row.cited_pages)}
              />
            </Row>
          ))
        )}
      </Card>

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={t('webmasterData.nativePanel.title')}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.nativePanel.hint')}
          </Typography.Text>
        }
      >
        {extras.length === 0 ? (
          <Typography.Text type="secondary">{t('webmasterData.nativePanel.empty')}</Typography.Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {extras.map((row) => (
              <Space key={row.id} size={6} wrap>
                <Tag color="blue">{enumLabel(t, 'webmasterData.sources', row.source_kind)}</Tag>
                <Typography.Text style={{ fontSize: 12 }}>{row.label}</Typography.Text>
                <Typography.Text strong>{row.value}</Typography.Text>
              </Space>
            ))}
          </Space>
        )}
      </Card>

      {reconcile.rows.length === 0 ? null : (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={t('webmasterData.reconcile.sampleTitle')}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('webmasterData.reconcile.hint')}
            </Typography.Text>
          }
        >
          <Table<SearchReconcileRow>
            size="small"
            rowKey={(row) => `${row.engine}:${row.query}`}
            pagination={false}
            dataSource={reconcile.rows}
            columns={[
              { title: t('webmasterData.reconcile.columns.query'), dataIndex: 'display', width: 260 },
              {
                title: t('webmasterData.reconcile.columns.engine'),
                dataIndex: 'engine',
                width: 120,
                render: (engine: SearchReconcileRow['engine']) =>
                  (ENGINE_VALUES as readonly string[]).includes(engine)
                    ? enumLabel(t, 'collection.engines', engine)
                    : enumLabel(t, 'webmasterData.sources', engine),
              },
              {
                title: t('webmasterData.reconcile.columns.l1'),
                dataIndex: 'l1_rate',
                width: 140,
                render: (value: number, row) =>
                  `${row.l1_cited}/${row.l1_samples} · ${percentText(value)}`,
              },
              {
                title: t('webmasterData.reconcile.columns.l3'),
                dataIndex: 'l3_rate',
                width: 140,
                render: (value: number | null, row) =>
                  value === null
                    ? '—'
                    : `${row.l3_citations ?? 0}/${row.l3_impressions ?? 0} · ${percentText(value)}`,
              },
              {
                title: t('webmasterData.reconcile.columns.displayed'),
                dataIndex: 'displayed_rate',
                width: 150,
                render: (value: number, row) => (
                  <Space size={4} wrap>
                    <span>{percentText(value)}</span>
                    <Tag>{row.displayed_from === 'l3' ? t('webmasterData.reconcile.platformSide') : t('webmasterData.reconcile.sampledSide')}</Tag>
                  </Space>
                ),
              },
              {
                title: t('webmasterData.reconcile.columns.divergence'),
                dataIndex: 'divergence',
                width: 110,
                render: (value: number | null) => (value === null ? '—' : percentText(value)),
              },
              {
                title: t('webmasterData.reconcile.columns.status'),
                dataIndex: 'reconciled',
                width: 110,
                render: (value: boolean) => (
                  <Tag color={value ? 'green' : 'default'}>
                    {value ? t('webmasterData.reconcile.reconciled') : t('webmasterData.reconcile.notReconciled')}
                  </Tag>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            {t('webmasterData.reconcile.notReconciledNote')}
          </Typography.Paragraph>
        </Card>
      )}

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={t('webmasterData.reconcile.title')}
        extra={
          <Space size={6} wrap>
            <Button
              type="primary"
              size="small"
              icon={<SnippetsOutlined />}
              disabled={ingestDisabled}
              onClick={onPaste}
            >
              {t('webmasterData.import.pasteButton')}
            </Button>
            <Button size="small" icon={<FileTextOutlined />} disabled={ingestDisabled} onClick={onImport}>
              {t('webmasterData.import.fileButton')}
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.reconcile.hint')}
        </Typography.Paragraph>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t('webmasterData.metrics.title')}
        </Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.metrics.hint')}
        </Typography.Paragraph>
        <Collapse
          ghost
          items={[
            {
              key: 'detail',
              label: t('webmasterData.metrics.expand'),
              forceRender: true,
              children: (
                <Table<SearchPivotRow>
                  rowKey="key"
                  size="small"
                  tableLayout="fixed"
                  scroll={{ x: 820 }}
                  columns={columns}
                  dataSource={pivotRows}
                  pagination={false}
                  loading={loading}
                  locale={{ emptyText: t('webmasterData.metrics.empty') }}
                />
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

/**
 * AI 引用表现那五项之一：标签 + 值。
 * 🔴 点击率那一格带问号 tooltip（这一页**唯一**允许的 tooltip 说明，DR-99）；
 * Tooltip 连标签一起包，鼠标停在"AI 点击率"四个字上就能读到分母，不用去瞄那个小问号。
 */
function AiStat({ label, value, note }: { label: string; value: string; note?: string }) {
  const text = (
    <Space size={4}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      {note === undefined ? null : <QuestionCircleOutlined style={{ fontSize: 12 }} />}
    </Space>
  );
  return (
    <Col xs={12} md={3}>
      <Space direction="vertical" size={0}>
        {note === undefined ? text : <Tooltip title={note}>{text}</Tooltip>}
        <Typography.Text strong style={{ fontSize: 16 }}>
          {value}
        </Typography.Text>
      </Space>
    </Col>
  );
}

/** 可空计数的显示形：`null`（平台没给这一列）显示 `—`，🔴 不显示 0（DR-94）。 */
function nullableCountText(value: number | null): string {
  // 0 与“平台没给这一列”在 A 类合计里今天共用 `—`，与 AggregateSummaryBar 保持同一显示口径。
  return value === null || value === 0 ? '—' : countText(value);
}
