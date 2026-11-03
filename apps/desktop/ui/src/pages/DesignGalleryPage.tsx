import { Button, Col, Row, Skeleton, Space, Table, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import MetricText from '../components/ui/MetricText';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import StatTile from '../components/ui/StatTile';
import StatusChip, { type ChipStatus } from '../components/ui/StatusChip';
import VerdictBar from '../components/ui/VerdictBar';
import { BRAND, NEUTRAL_LIGHT } from '../theme/tokens';

const STATUSES: ChipStatus[] = [
  'ok',
  'running',
  'warning',
  'error',
  'todo',
  'unavailable',
  'insufficient',
];

const SWATCHES: { label: string; value: string }[] = [
  { label: 'primary', value: BRAND.primary },
  { label: 'primaryBg', value: BRAND.primaryBg },
  { label: 'text', value: NEUTRAL_LIGHT.text },
  { label: 'border', value: NEUTRAL_LIGHT.border },
  { label: 'bg', value: NEUTRAL_LIGHT.bgLayout },
];

/**
 * 设计样张（`/__design`，仅 vite dev 注册）· 2026-10-30 二稿。
 *
 * # 二稿的取舍
 * 一稿把样张做成了「色板 + 七态 + 四种结论条 + 四张指标卡 + 空错载」的全家福，
 * 看起来像组件仓库，而不是产品。二稿按**真实页面**的顺序排：页头 → 一句结论 → 四个指标
 * → 一张表 → 空/错态 → 字体与色彩。颜色只留 5 个、状态只留一行、结论条只留一条。
 *
 * # 三条硬约束不变
 * - **零 IPC**：不 import `api/client`，进页面不产生任何命令；
 * - **不进生产导航**：`App.tsx` 只在 `import.meta.env.DEV` 下注册；
 * - **文案全走词典**：`pages/**` 在 `no-hardcoded-strings` 的扫描面里。
 */
export default function DesignGalleryPage() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();

  const rows = [
    { key: '1', name: t('design.metrics.coverage'), status: 'ok' as ChipStatus, coverage: '55%' },
    { key: '2', name: t('design.metrics.score'), status: 'warning' as ChipStatus, coverage: '55' },
    { key: '3', name: t('design.states.emptyTitle'), status: 'unavailable' as ChipStatus, coverage: '—' },
    { key: '4', name: t('design.actions.secondary'), status: 'todo' as ChipStatus, coverage: '—' },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: t('common.appName'), onClick: () => navigate('/projects') },
          { label: t('design.title') },
        ]}
        title={t('design.title')}
        description={t('design.subtitle')}
        status={<StatusChip status="unavailable" label={t('design.devOnly')} />}
        actions={
          <>
            <Button onClick={() => navigate('/projects')}>{t('nav.allProjects')}</Button>
            <Button type="primary" icon={<PlusOutlined />}>
              {t('design.actions.primary')}
            </Button>
          </>
        }
      />

      <VerdictBar
        tone="positive"
        kicker={t('design.verdict.kicker')}
        headline={t('design.verdict.positive')}
        meta={t('design.metrics.hint')}
        action={
          <Button size="small" type="primary" ghost>
            {t('design.verdict.action')}
          </Button>
        }
      />

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={6}>
          <StatTile
            label={t('design.metrics.coverage')}
            value="55"
            unit="%"
            delta={{ text: t('design.metrics.delta'), direction: 'up' }}
          />
        </Col>
        <Col span={6}>
          <StatTile
            label={t('design.metrics.score')}
            value="55"
            delta={{ text: '+11', direction: 'up' }}
          />
        </Col>
        <Col span={6}>
          <StatTile
            label={t('design.metrics.coverage')}
            value="38"
            unit="%"
            delta={{ text: '+6', direction: 'up' }}
            spark={[30, 32, 31, 34, 36, 35, 38]}
          />
        </Col>
        <Col span={6}>
          <StatTile
            label={t('design.metrics.score')}
            value="9"
            insufficient
            hint={t('design.metrics.insufficient')}
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={24}>
          <SectionCard title={t('design.status.title')} description={t('design.status.note')}>
            <Space size={24} wrap>
              {STATUSES.map((status) => (
                <StatusChip key={status} status={status} />
              ))}
            </Space>
          </SectionCard>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={16}>
          <SectionCard title={t('design.table.title')} noBodyPadding>
            <Table
              size="middle"
              pagination={false}
              dataSource={rows}
              columns={[
                { title: t('design.table.name'), dataIndex: 'name' },
                {
                  title: t('design.table.status'),
                  dataIndex: 'status',
                  width: 160,
                  render: (status: ChipStatus) => <StatusChip status={status} />,
                },
                { title: t('design.table.coverage'), dataIndex: 'coverage', width: 120 },
                {
                  title: t('design.table.updated'),
                  dataIndex: 'updated',
                  width: 140,
                  render: () => '2026-10-30',
                },
              ]}
            />
          </SectionCard>
        </Col>
        <Col span={8}>
          <SectionCard title={t('design.states.title')} noBodyPadding>
            <EmptyState
              title={t('design.states.emptyTitle')}
              description={t('design.states.emptyBody')}
              action={
                <Button type="primary" size="small">
                  {t('design.states.emptyAction')}
                </Button>
              }
            />
            <div style={{ padding: '0 16px 16px' }}>
              <ErrorState
                title={t('design.states.errorTitle')}
                description={t('design.states.errorBody')}
                onRetry={() => undefined}
                retryLabel={t('design.states.retry')}
              />
            </div>
            <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Skeleton.Avatar active size="small" />
              <Skeleton.Input active size="small" style={{ width: 120 }} />
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                {t('design.states.loading')}
              </span>
            </div>
          </SectionCard>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={14}>
          <SectionCard title={t('design.type.title')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
                {t('design.type.display')}
              </div>
              <div style={{ fontSize: 14, lineHeight: '22px' }}>{t('design.type.body')}</div>
              <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>
                {t('design.type.meta')}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <MetricText value={t('design.type.sample')} size="lg" />
                <MetricText value="1,284" size="md" />
                <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                  {t('design.type.number')}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 18, fontSize: 12, color: token.colorTextTertiary }}>
              {t('design.space.note')}
            </div>
          </SectionCard>
        </Col>
        <Col span={10}>
          <SectionCard title={t('design.colors.title')} description={t('design.colors.note')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SWATCHES.map((swatch) => (
                <div key={swatch.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: swatch.value,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12, color: token.colorTextSecondary, flex: 1 }}>
                    {swatch.label}
                  </span>
                  <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{swatch.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={24}>
          <SectionCard title={t('design.actions.title')}>
            <Space size={12} wrap>
              <Button type="primary" icon={<PlusOutlined />}>
                {t('design.actions.primary')}
              </Button>
              <Button>{t('design.actions.secondary')}</Button>
              <Button type="text">{t('design.actions.text')}</Button>
              <Button danger>{t('design.actions.danger')}</Button>
              <Button type="primary" disabled>
                {t('design.actions.primary')}
              </Button>
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                {t('design.density.comfortable')} · {t('design.density.compact')}
              </span>
            </Space>
          </SectionCard>
        </Col>
      </Row>

      <div style={{ marginTop: 12 }}>
        <SectionCard title={t('design.strip.title')} description={t('design.strip.note')}>
          <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('design.note')}</div>
        </SectionCard>
      </div>
    </div>
  );
}
