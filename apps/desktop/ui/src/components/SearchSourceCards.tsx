import { Alert, Button, Card, Col, Row, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { catalogByGroup } from '../api/search-catalog';
import {
  isStaleData,
  primarySuggestions,
  SUGGEST_LATER_KEY,
  type SearchSourceSuggestion,
} from '../api/search-compose';
import type { SearchQueryMetric, SearchSource, SearchSourceKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { percentText } from './format';

export interface SearchSourceCardsProps {
  /** 已接入的源；缺的 kind 由本组件补一张「未配置」卡（渲染集恒定，见下）。 */
  sources: SearchSource[];
  /** 明细行：只为在卡上挂该源的完整性旗标（DR-110）。 */
  metrics: SearchQueryMetric[];
  /** "今天"（`YYYY-MM-DD`）：陈旧判定用（DR-105），由页面持有以保证同一次会话可复算。 */
  asOf: string;
  /**
   * 接入建议（DR-111）：页面传 `suggestSources(流量分布)` 的结果。
   * 🔴 空数组是**常态而不是缺陷**：没有站内分析数据时不给任何通用推荐（走查 5）。
   */
  suggestions: SearchSourceSuggestion[];
  /** 正在跑写操作的那个源（`null` = 空闲）。 */
  busyKind: SearchSourceKind | null;
  onConfigure: (kind: SearchSourceKind) => void;
  /**
   * `search_board` 还没回来时置灰「配置」入口（配置侧滑里的人工填报也走 `board.as_of` 锚点）。
   * 只禁用按钮、不改回调：加载完成后入口自动恢复。
   */
  configureDisabled?: boolean;
}

/** 状态标签配色：复用站点通道那一套（DR-94 复用 `SiteChannelStatus`，配色也一并复用）。 */
const STATUS_COLORS: Record<SearchSource['status'], string> = {
  not_configured: 'default',
  pending_verify: 'gold',
  ready: 'success',
  failed: 'error',
};

/**
 * 站长数据页第 1 段的**数据源墙**（spec `2026-10-12-webmaster-data-integration-design.md`
 * §5.3 ①、DR-104 / DR-108 / DR-111，走查 2 / 3 / 5）。
 *
 * # 🔴 三分组、组序即视觉权重（DR-104）
 * 分组与组内成员一律**查目录表**（`catalogByGroup()`），本组件不写一个 `kind` 字面量：
 * 二期把 `phase` 改成 1，这里零改动（DR-108）。海外组挂常驻的可达性提示、
 * `analytics` 组挂常驻的"不参与曝光合计"（DR-110 护栏 2）——两句都**不进 tooltip**。
 *
 * # 🔴 二期源（搜狗 / 360）一个入口都不渲染（DR-92）
 * `renderableCatalog()` 已经把 `phase: 2` 滤掉了。渲染一个永远点不动的入口，
 * 用户只会以为是自己配错了。
 *
 * # 🔴 卡上**不收凭据**（DR-96 / AGENTS 规则 3）
 * 只有状态、形态徽章、绑定值与数据截至日；配置动作在「配置」侧滑里（`SearchSourceDrawer`）。
 */
export default function SearchSourceCards({
  sources,
  metrics,
  asOf,
  suggestions,
  busyKind,
  onConfigure,
  configureDisabled = false,
}: SearchSourceCardsProps) {
  const { t } = useTranslation();
  const separator = t('common.listSeparator');
  const labelOf = (kind: SearchSourceKind) => enumLabel(t, 'webmasterData.sources', kind);
  const labelsOf = (rows: readonly SearchSourceSuggestion[]) =>
    rows.map((row) => labelOf(row.source_kind)).join(separator);
  // 已经接入（不是 not_configured）的源不再建议一次：建议条的语义是“还该接谁”。
  const pending = suggestions.filter(
    (row) => !sources.some((source) => source.kind === row.source_kind && source.status !== 'not_configured'),
  );
  const primary = primarySuggestions(pending);
  const deferred = pending.filter((row) => row.reason_key === SUGGEST_LATER_KEY);

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }} title={t('webmasterData.onboarding.title')}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.onboarding.hint')}
        </Typography.Paragraph>
        {suggestions.length === 0 ? (
          // 🔴 空态就是空态：DR-111 明令"没有 analytics 数据时不显示建议"，
          // 而不是退化成一份内置的通用推荐（市场份额各来源差近一倍，猜必错）。
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('webmasterData.onboarding.empty')}
          </Typography.Paragraph>
        ) : pending.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('webmasterData.onboarding.allConnected')}
          </Typography.Paragraph>
        ) : (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
              {t('webmasterData.onboarding.suggestion', {
                split: primary
                  .map((row) => `${percentText(row.share)} ${labelOf(row.source_kind)}`)
                  .join(separator),
                total: primary.length,
              })}
            </Typography.Paragraph>
            {deferred.length === 0 ? null : (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {t('webmasterData.onboarding.later', { sources: labelsOf(deferred) })}
              </Typography.Paragraph>
            )}
          </Space>
        )}
      </Card>

      {catalogByGroup().map((section) => (
        <Card
          key={section.group}
          size="small"
          style={{ marginBottom: 12 }}
          title={enumLabel(t, 'webmasterData.groups', section.group)}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(`webmasterData.groupNotes.${section.group}`, { nsSeparator: false })}
            </Typography.Text>
          }
        >
          {section.group === 'webmaster_global' ? (
            // 🔴 常驻（DR-104）：海外组的可达性提示。不内置代理、不做加速。
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message={t('webmasterData.regionNote')}
            />
          ) : null}
          <Row gutter={[12, 12]}>
            {section.entries.map((entry) => {
              const source = sources.find((row) => row.kind === entry.kind) ?? null;
              const status = source?.status ?? 'not_configured';
              const completeness = completenessOf(metrics, entry.kind);
              const through = source?.data_through ?? null;
              return (
                <Col key={entry.kind} xs={24} lg={12} xl={8}>
                  <Card
                    size="small"
                    type="inner"
                    title={
                      <Tooltip title={t(`webmasterData.sourceHints.${entry.kind}`, { nsSeparator: false })}>
                        <span>{labelOf(entry.kind)}</span>
                      </Tooltip>
                    }
                    extra={
                      <Tag color={STATUS_COLORS[status]}>
                        {enumLabel(t, 'site.channelStatuses', status)}
                      </Tag>
                    }
                  >
                    <Space size={4} wrap style={{ marginBottom: 6 }}>
                      {entry.ingest_modes.map((mode) => (
                        <Tooltip
                          key={mode}
                          title={t(`webmasterData.ingestModeNotes.${mode}`, { nsSeparator: false })}
                        >
                          <Tag>{enumLabel(t, 'webmasterData.ingestModes', mode)}</Tag>
                        </Tooltip>
                      ))}
                      {completeness === null ? null : (
                        <Tag color="gold">
                          {enumLabel(t, 'webmasterData.completeness', completeness)}
                        </Tag>
                      )}
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                      {`${t('webmasterData.sourceCards.dataThrough')}: `}
                      {through ?? t('webmasterData.sourceCards.neverImported')}
                      {through !== null && isStaleData(through, asOf) ? (
                        <Tag color="orange" style={{ marginInlineStart: 6 }}>
                          {t('webmasterData.staleTitle')}
                        </Tag>
                      ) : null}
                    </Typography.Paragraph>
                    {source?.binding.siteUrl == null ? null : (
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                        {`${t('webmasterData.sourceCards.siteUrl')}: ${source.binding.siteUrl}`}
                      </Typography.Paragraph>
                    )}
                    {source?.check_detail == null ? null : (
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                        {`${t('webmasterData.sourceCards.checkDetail')}: ${source.check_detail}`}
                      </Typography.Paragraph>
                    )}
                    <Button
                      size="small"
                      loading={busyKind === entry.kind}
                      disabled={configureDisabled}
                      onClick={() => onConfigure(entry.kind)}
                    >
                      {t('webmasterData.sourceCards.configure')}
                    </Button>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      ))}
    </>
  );
}

/**
 * 一个源的完整性旗标：`sampled` 比 `partial` 更坏（采样是**静默**少给行，自陈不全至少说了自己不全），
 * 优先级与 `api/search-compose.ts` 里那份 `COMPLETENESS_RANK` 同口径；没有明细行就是 `null`
 * （🔴 不是 `full`：没数据不等于数据完整，DR-94）。
 */
function completenessOf(
  rows: readonly SearchQueryMetric[],
  kind: SearchSourceKind,
): SearchQueryMetric['completeness'] | null {
  const own = rows.filter((row) => row.source_kind === kind);
  if (own.length === 0) return null;
  if (own.some((row) => row.completeness === 'sampled')) return 'sampled';
  if (own.some((row) => row.completeness === 'partial')) return 'partial';
  return 'full';
}
