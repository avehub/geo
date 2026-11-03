import { useMemo } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Space, Statistic, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import {
  defaultSearchFilter,
  summarizeMetrics,
  type SearchAggregate,
  type SearchAggregateFlag,
  type SearchAggregateFlagKind,
} from '../api/search-compose';
import type { SearchBoardResult, SearchSourceKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { countText, percentText } from './format';

const FLAG_LABEL: Record<SearchAggregateFlagKind, string> = {
  excluded_analytics: 'overview.station.flags.excluded',
  sampled: 'overview.station.flags.sampled',
  partial: 'overview.station.flags.partial',
  stale: 'overview.station.flags.stale',
  cross_surface: 'overview.station.flags.cross',
};

const FLAG_COLOR: Record<SearchAggregateFlagKind, string> = {
  excluded_analytics: 'blue',
  sampled: 'orange',
  partial: 'orange',
  stale: 'red',
  cross_surface: 'geekblue',
};

/**
 * 站外数据对账（M5.5 的 L3 层在首页的摘要）。
 *
 * # 为什么拆成两个面
 * 传统搜索的"曝光/点击"与 AI 回答的"引用/点击"是两套分母（DR-95）。首页不做跨面相加，
 * 两个面各给一组数，避免"总曝光"这种把不同事件集合揉在一起的伪指标。
 *
 * # 为什么必须带区间与参与源
 * demo 里头条只到 8/20，传统搜索面的合计区间会被压到 8/1~8/20（DR-109）。
 * 只给数字不给区间，用户会把它当"9 月合计"；给数字同时给得出账，才不会被追问一次就崩。
 */
export default function OverviewStationCard({
  board,
  loading,
  error,
  onOpen,
}: {
  board: SearchBoardResult | null;
  loading: boolean;
  error: unknown | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  // 与站长数据页同一个“今天”：命令端给的 `as_of`，不是最大 data_through。
  // 用后者会把“数据截至 8/20”误写成“最新数据 8/20”，同一屏两页还会给出不同天数。
  const asOf = board?.as_of ?? '';
  const web = useMemo<SearchAggregate | null>(
    () =>
      board === null
        ? null
        : summarizeMetrics(
            board.metrics,
            { ...defaultSearchFilter(), surface: 'web_search' },
            asOf,
          ),
    [board, asOf],
  );
  const ai = useMemo<SearchAggregate | null>(
    () =>
      board === null
        ? null
        : summarizeMetrics(
            board.metrics,
            { ...defaultSearchFilter(), surface: 'ai_answer' },
            asOf,
          ),
    [board, asOf],
  );
  const hasAiClicks = (board?.metrics ?? []).some(
    (row) => row.surface === 'ai_answer' && row.ai_clicks !== null,
  );

  const sourceName = (kind: SearchSourceKind): string =>
    enumLabel(t, 'webmasterData.sources', kind);
  const sourceNames = (kinds: readonly SearchSourceKind[]): string =>
    kinds.map(sourceName).join(t('common.listSeparator'));

  const windowText = (aggregate: SearchAggregate): string => {
    const { start, end, limited_by: limitedBy } = aggregate.window;
    if (start === null || end === null) return t('overview.station.windowEmpty');
    if (limitedBy.length > 0) {
      return t('overview.station.windowLimited', {
        start,
        end,
        source: sourceNames(limitedBy),
      });
    }
    return t('overview.station.window', { start, end });
  };

  const flags = useMemo(() => {
    const merged = new Map<SearchAggregateFlagKind, SearchAggregateFlag>();
    for (const flag of [...(web?.flags ?? []), ...(ai?.flags ?? [])]) {
      if (!merged.has(flag.flag)) merged.set(flag.flag, flag);
    }
    return [...merged.values()];
  }, [web, ai]);

  const flagText = (flag: SearchAggregateFlag): string => {
    if (flag.flag === 'sampled') {
      return t('webmasterData.sampledWarning', { source: sourceNames(flag.source_kinds) });
    }
    if (flag.flag === 'stale') {
      // 只陈述“数据截至哪天”。`days` 是距今天的年龄，不是导入时间；
      // 原句“是 N 天前导入的”会把两者混为一谈（头条 8/20 的数据实际是 9/2 导入的）。
      return `${t('webmasterData.staleTitle')} · ${t('overview.station.latest', {
        date: flag.params.through ?? '',
      })}`;
    }
    if (flag.flag === 'partial') return t('webmasterData.completenessNotes.partial');
    if (flag.flag === 'excluded_analytics') {
      return t('webmasterData.aggregate.excludedAnalytics');
    }
    return t('webmasterData.aggregate.crossSurface');
  };

  const participants = useMemo(
    () => [
      ...new Set([
        ...(web?.participants.map((row) => row.source_kind) ?? []),
        ...(ai?.participants.map((row) => row.source_kind) ?? []),
      ]),
    ],
    [web, ai],
  );

  const empty = board === null || board.metrics.length === 0;

  return (
    <Card
      size="small"
      loading={loading}
      title={t('overview.station.title')}
      style={{ height: '100%' }}
      extra={
        <Button type="link" size="small" onClick={onOpen}>
          {t('overview.station.open')}
        </Button>
      }
    >
      {error !== null ? (
        <Alert type="error" showIcon message={describeIpcError(error, t)} />
      ) : empty ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={2}>
              <Typography.Text>{t('overview.station.empty')}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('overview.station.emptyHint')}
              </Typography.Text>
            </Space>
          }
        />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Typography.Text strong>{t('overview.station.web')}</Typography.Text>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic
                    title={t('overview.station.impressions')}
                    value={countText(web!.impressions)}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title={t('overview.station.clicks')} value={countText(web!.clicks)} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t('overview.station.ctr')}
                    value={web!.ctr === null ? t('overview.station.noColumn') : percentText(web!.ctr)}
                  />
                </Col>
              </Row>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {windowText(web!)}
              </Typography.Text>
            </Col>
            <Col span={12}>
              <Typography.Text strong>{t('overview.station.ai')}</Typography.Text>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic
                    title={t('overview.station.impressions')}
                    value={countText(ai!.impressions)}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title={t('overview.station.clicks')} value={countText(ai!.clicks)} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t('overview.station.citations')}
                    value={countText(ai!.citations)}
                  />
                </Col>
              </Row>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {windowText(ai!)}
                {' · '}
                {hasAiClicks
                  ? `${t('overview.station.aiCtr')} ${percentText(ai!.ai_ctr ?? 0)}`
                  : `${t('overview.station.aiCtr')} ${t('overview.station.noColumn')}`}
              </Typography.Text>
            </Col>
          </Row>

          <Space size={6} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('overview.station.participants', { value: participants.length })}
            </Typography.Text>
            {participants.map((kind) => (
              <Tag key={kind}>{sourceName(kind)}</Tag>
            ))}
          </Space>

          <Space size={6} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('overview.station.latest', { date: asOf })}
            </Typography.Text>
            {flags.map((flag) => (
              <Tooltip key={flag.flag} title={flagText(flag)}>
                <Tag color={FLAG_COLOR[flag.flag]}>{t(FLAG_LABEL[flag.flag])}</Tag>
              </Tooltip>
            ))}
          </Space>
        </Space>
      )}
    </Card>
  );
}
