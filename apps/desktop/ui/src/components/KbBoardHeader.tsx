import { Alert, Statistic, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { KbStats } from '../api/types';

export interface KbBoardHeaderProps {
  stats: KbStats;
}

const STAT_KEYS = [
  'modules',
  'entries',
  'scripts',
  'pendingReview',
  'unverified',
  'media',
] as const;

/**
 * 统计条（DR-80：6 个数字）+ 职责说明条（DR-73：同步横幅退役后的替代物）。
 *
 * 三稿起统计条压成**一条横向数字带**（20px 数字 + 12px 标签），不再是一张 Card 里 6 个
 * 24px 的 Statistic——六个大数字在首屏占掉 100px，信息密度反而低。
 *
 * 🔴 职责说明条必须常驻：它承担"实体卡与知识库不互相同步、导入是一次性复制"的口径告知。
 */
export default function KbBoardHeader({ stats }: KbBoardHeaderProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const values: Record<(typeof STAT_KEYS)[number], number> = {
    modules: stats.modules,
    entries: stats.entries,
    scripts: stats.scripts,
    pendingReview: stats.pending_review,
    unverified: stats.unverified,
    media: stats.media,
  };

  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('kb.dutyNote')} />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 32,
          padding: '12px 20px',
          marginBottom: 12,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowTertiary,
        }}
      >
        {STAT_KEYS.map((key) => (
          <Statistic
            key={key}
            title={<span style={{ fontSize: 12 }}>{t(`kb.stats.${key}`)}</span>}
            value={values[key]}
            valueStyle={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}
          />
        ))}
      </div>
    </>
  );
}
