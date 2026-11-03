import { Tag, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { CollectionRound, DiagnosisOverview, Project } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText, promptsText } from './format';

/**
 * 概览页顶部的**口径锚**（2026-11-02 重排）。
 *
 * 一稿是一张 5 项 `Descriptions` 卡（79px + 边框），在飞书式概览里属于“每条都要读一遍”
 * 的重容器。二稿压成**一行弱文本**：轮次 · 采集时间 · 样本与分级 · 口径版本 · 官网，
 * 仍保留「62 道题 / 样本充足」这些防误读信息，但不再占一张卡。
 */
export default function OverviewAnchorCard({
  project,
  round,
  overview,
}: {
  project: Project;
  round: CollectionRound;
  overview: DiagnosisOverview;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const sep = <span aria-hidden style={{ color: token.colorBorder }}>·</span>;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 10px',
        marginBottom: 12,
        fontSize: 12,
        lineHeight: '20px',
        color: token.colorTextTertiary,
      }}
    >
      <span style={{ color: token.colorTextSecondary }}>{round.label}</span>
      {sep}
      <span>{dateTimeText(overview.collected_at)}</span>
      {sep}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {promptsText(t, overview.sample_size)}
        <Tag style={{ marginInlineEnd: 0 }}>
          {enumLabel(t, 'common.sampleSizeGrades', overview.sample_size_grade)}
        </Tag>
      </span>
      {sep}
      <span>{`${t('overview.anchor.metricSpec')} ${overview.metric_spec_version}`}</span>
      {project.website === null ? null : (
        <>
          {sep}
          <a href={project.website} target="_blank" rel="noreferrer">
            {project.website}
          </a>
        </>
      )}
    </div>
  );
}
