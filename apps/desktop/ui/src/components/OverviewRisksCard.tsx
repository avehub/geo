import { Alert, Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import type { OverviewRisk } from '../api/overview-compose';
import type { AlertSeverity, FactIssueKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 严重度 → 标签色（与诊断页的告警清单同口径）。 */
const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

const FACT_KINDS: readonly FactIssueKind[] = ['wrong', 'outdated', 'missing'];
const PRIORITY_SIZE = 3;

function totalOf(risks: readonly OverviewRisk[]): number {
  return risks.reduce((sum, risk) => sum + risk.count, 0);
}

/**
 * 风险与待办：**按来源汇总 + 优先处理前三条**。
 *
 * 三类风险的"可操作性"不同，所以不做成一张混排长表：
 * - 告警是**诊断信号**（可能只是波动）→ 去诊断页看归因；
 * - 事实问题是**可直接更正的错**（说错了/说旧了/漏说了）→ 去核查页结办；
 * - 低置信度是**还没确认的疑点** → 去解析页人工复核。
 * 汇总行让用户知道"每类有多少"，优先项让用户知道"先看哪三条"。
 */
export default function OverviewRisksCard({
  risks,
  loading,
  error,
  onOpenDiagnosis,
  onOpenInsight,
}: {
  risks: OverviewRisk[];
  loading: boolean;
  error: unknown | null;
  onOpenDiagnosis: () => void;
  onOpenInsight: () => void;
}) {
  const { t } = useTranslation();

  const alerts = risks.filter((risk) => risk.source === 'alert');
  const facts = risks.filter((risk) => risk.source === 'fact_check');
  const reviews = risks.filter((risk) => risk.source === 'review');
  const factBreakdown = FACT_KINDS.map((kind) => ({
    kind,
    count: facts.filter((risk) => risk.kind === kind).reduce((sum, risk) => sum + risk.count, 0),
  }));

  function labelOf(risk: OverviewRisk): string {
    if (risk.source === 'review') return t('overview.risks.reviewLabel');
    if (risk.source === 'alert') return enumLabel(t, 'diagnosis.alerts.kinds', risk.kind ?? '');
    return enumLabel(t, 'insight.kinds', risk.kind ?? '');
  }

  return (
    <Card
      size="small"
      loading={loading}
      title={t('overview.risks.title')}
      style={{ height: '100%' }}
    >
      {error !== null && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message={t('overview.cardUnavailable')}
          description={describeIpcError(error, t)}
        />
      )}

      {risks.length === 0 && !loading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.risks.empty')} />
      ) : (
        <>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space size={6} wrap>
              <Tag color="red">{t('overview.risks.sourceAlert')}</Tag>
              <Typography.Text>{t('overview.risks.alertSummary', { value: totalOf(alerts) })}</Typography.Text>
              <Button type="link" size="small" onClick={onOpenDiagnosis}>
                {t('overview.risks.openDiagnosis')}
              </Button>
            </Space>
            <Space size={6} wrap>
              <Tag color="orange">{t('overview.risks.sourceFact')}</Tag>
              <Typography.Text>{t('overview.risks.factSummary', { value: totalOf(facts) })}</Typography.Text>
              <Button type="link" size="small" onClick={onOpenInsight}>
                {t('overview.risks.openInsight')}
              </Button>
            </Space>
            {facts.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12, paddingInlineStart: 4 }}>
                {t('overview.risks.factBreakdown', {
                  wrong: factBreakdown[0].count,
                  outdated: factBreakdown[1].count,
                  missing: factBreakdown[2].count,
                })}
              </Typography.Text>
            )}
            <Space size={6} wrap>
              <Tag color="geekblue">{t('overview.risks.sourceReview')}</Tag>
              <Typography.Text>
                {t('overview.risks.reviewSummary', { value: totalOf(reviews) })}
              </Typography.Text>
              <Button type="link" size="small" onClick={onOpenInsight}>
                {t('overview.risks.openInsight')}
              </Button>
            </Space>
          </Space>

          {risks.length > 0 && (
            <>
              <Typography.Title level={5} style={{ margin: '14px 0 6px' }}>
                {t('overview.risks.priority')}
              </Typography.Title>
              <List<OverviewRisk>
                size="small"
                split={false}
                dataSource={risks.slice(0, PRIORITY_SIZE)}
                rowKey={(risk) => risk.id}
                renderItem={(risk) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space size={4} wrap>
                        <Tag color={SEVERITY_COLORS[risk.severity]}>
                          {enumLabel(t, 'diagnosis.alerts.severities', risk.severity)}
                        </Tag>
                        <Typography.Text strong>{labelOf(risk)}</Typography.Text>
                        {risk.count > 1 && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {t('overview.risks.countItems', { value: risk.count })}
                          </Typography.Text>
                        )}
                        {risk.round_label !== null && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {risk.round_label}
                          </Typography.Text>
                        )}
                      </Space>
                      {risk.detail !== null && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {risk.detail}
                        </Typography.Text>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
              {risks.length > PRIORITY_SIZE && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('overview.risks.more', { value: risks.length - PRIORITY_SIZE })}
                </Typography.Text>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
