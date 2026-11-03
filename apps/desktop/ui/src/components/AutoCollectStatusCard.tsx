import { Card, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { SELF_INDEX_RETENTION_DAYS } from '../api/constants';
import type { SearchSource, SelfIndexSummary } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

export interface AutoCollectStatusCardProps {
  /**
   * L1 的覆盖情况（`search_board` 的 `self_index_summary` 读出口，DR-118）。
   * 🔴 可空：还没跑过采集轮的项目是 `null` ⇒ 显示空态，**不抛错**（走查 21）。
   */
  summary: SelfIndexSummary | null;
  /** 已接入的源；本卡只挑其中 `auth_mode: 'oauth'` 的那几个报 L2 令牌状态。 */
  sources: SearchSource[];
}

/** 一个"标签 + 值"的小格：值单独成元素，读屏与测试都能按值本身定位。 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Space size={4}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </Space>
  );
}

/**
 * 站长数据页第 1 段的**自动采集状态卡**（spec `2026-10-12-webmaster-data-integration-design.md`
 * DR-116 / DR-118，走查 21）。
 *
 * # 为什么要有这张卡
 * 产品负责人第三轮的诉求是"要全自动化"，而 DR-90 的裁定是：主喂料永远是自动的两层
 * （L1 自有抽样 + L2 官方接口），导入 / 粘贴 / 填报只是**对账层**。这张卡就是把那句裁定
 * 变成看得见的东西——最近运行、覆盖引擎数、覆盖 query 数、以及三家 OAuth 的令牌状态。
 *
 * # 🔴 这张卡上**没有 CTR 曲线**（DR-118 末条）
 * 自建索引是**关键性采样**：只记"这一轮这些关键题在这些引擎里有没有被引用"，
 * **没有点击**（点击发生在平台那一侧，我们看不见）。把自有观测的引用率与平台的点击率
 * 画成同一条曲线，就是拿两个分母不同的比率冒充一个趋势（DR-95 B 类的同一个错误）。
 * 所以 `selfIndex.noCtr` 那句在这里**常驻**，界面上一个图表都不画。
 *
 * # 🔴 `summary === null` 是空态而不是异常
 * 契约（`api/types-search.ts`）把它标成可空：新建的项目一轮都没跑过。这里显示
 * `stats.neverRun`，L2 那一列照样报——令牌状态与有没有跑过采集是两件事。
 */
export default function AutoCollectStatusCard({ summary, sources }: AutoCollectStatusCardProps) {
  const { t } = useTranslation();
  const oauthSources = sources.filter((source) => source.auth_mode === 'oauth');

  return (
    <Card
      size="small"
      title={
        <Tooltip title={t('webmasterData.stats.hint')}>
          <span>{t('webmasterData.stats.title')}</span>
        </Tooltip>
      }
      style={{ marginBottom: 12 }}
    >

      {summary === null || summary.last_run_at === null ? (
        <Typography.Text type="secondary">{t('webmasterData.stats.neverRun')}</Typography.Text>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <Stat
            label={t('webmasterData.stats.lastRun')}
            value={dateTimeText(summary.last_run_at)}
          />
          <Stat
            label={t('webmasterData.stats.engines')}
            value={t('webmasterData.stats.engineCount', { total: summary.engines_covered })}
          />
          <Stat
            label={t('webmasterData.stats.queries')}
            value={t('webmasterData.stats.queryCount', { total: summary.queries_covered })}
          />
          <Stat
            label={t('webmasterData.selfIndex.title')}
            value={t('webmasterData.selfIndex.rounds', { total: summary.rounds_covered })}
          />
        </div>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
        {t('webmasterData.selfIndex.retention', { days: SELF_INDEX_RETENTION_DAYS })}
      </Typography.Paragraph>
      {/* 🔴 常驻而不是问号 tooltip：这张图不提供点击率曲线，是一个**能力边界**声明（DR-118）。 */}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
        {t('webmasterData.selfIndex.noCtr')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('webmasterData.selfIndex.boundary')}
      </Typography.Paragraph>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.stats.tokenState')}
        </Typography.Text>
        {oauthSources.map((source) => (
          <Space key={source.id} size={4}>
            <Tag style={{ marginInlineEnd: 0 }}>{enumLabel(t, 'webmasterData.sources', source.kind)}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {enumLabel(t, 'site.credentialsStates', source.credentials_state)}
            </Typography.Text>
          </Space>
        ))}
      </div>
    </Card>
  );
}
