import { Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { SearchOpportunity, SearchOpportunityStatus } from '../api/types';
import { SEARCH_RULE_KEY_BY_ID } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { confidenceText } from './format';

export interface OpportunityCardProps {
  opportunity: SearchOpportunity;
  /** 这张卡正在写（只让被点的那一张转圈，照 `SiteChannelCards` 的 `busyKind`）。 */
  busy: boolean;
  onStatus: (opportunity: SearchOpportunity, status: SearchOpportunityStatus) => void;
  /** 「转为文章方向」：复用文章管理的入口（DR-101，不新增命令）。 */
  onToArticle: (opportunity: SearchOpportunity) => void;
  /** 「生成补丁」：复用站点接入的补丁生成（DR-101）。 */
  onToPatch: (opportunity: SearchOpportunity) => void;
}

/** 处置态配色：待处理灰、已采纳绿、已忽略黄。 */
const STATUS_COLORS: Record<SearchOpportunityStatus, string> = {
  new: 'default',
  adopted: 'success',
  ignored: 'gold',
};

/**
 * 站长数据页第 5 段的**一张优化机会卡**（spec `2026-10-12-webmaster-data-integration-design.md`
 * DR-100 / DR-102，走查 15）。
 *
 * # 🔴 卡上必须能追问到底（DR-105 的溯源四件套在这一段的形态）
 * 规则名 + 规则判据 + 依据数字 + 建议处方类别 + 影响 / 难度 / 置信度一起给：
 * "为什么给我这条建议"要能在卡上就地回答，而不是让用户去猜算法。
 *
 * # 🔴 采纳**不**自动生成处方（DR-102）
 * 采纳只是把它排进下一轮处方排序，所以翻成 `adopted` 之后卡上常驻
 * `opportunity.adopted` 那一句，免得用户等着看处方长出来。
 *
 * # 🔴 规则名走 `SEARCH_RULE_KEY_BY_ID`，不走数据里的 `title_key`
 * 两者内容相同，但 `rule_id` 是 1~6 的**数字联合**（编译期穷尽），`title_key` 是自由字符串
 * ——拿数据里的键去查词典，后端拼错一个字母就是界面上露出裸键（DR-107 的可审计性同理）。
 */
export default function OpportunityCard({
  opportunity,
  busy,
  onStatus,
  onToArticle,
  onToPatch,
}: OpportunityCardProps) {
  const { t } = useTranslation();
  const ruleKey = SEARCH_RULE_KEY_BY_ID[opportunity.rule_id];

  return (
    <Card
      size="small"
      title={
        <Tooltip title={t(`webmasterData.rules.${ruleKey}.hint`, { nsSeparator: false })}>
          <span>{t(`webmasterData.rules.${ruleKey}.name`, { nsSeparator: false })}</span>
        </Tooltip>
      }
      extra={
        <Tag color={STATUS_COLORS[opportunity.status]}>
          {enumLabel(t, 'webmasterData.opportunity.statuses', opportunity.status)}
        </Tag>
      }
    >
      <Typography.Paragraph
        style={{ fontSize: 12, marginBottom: 8 }}
        ellipsis={{ rows: 2, tooltip: opportunity.basis }}
      >
        {opportunity.basis}
      </Typography.Paragraph>

      <Space size={4} wrap style={{ marginBottom: 8 }}>
        <Tag color="blue">
          {`${t('webmasterData.opportunity.category')} ${enumLabel(t, 'action.categories', opportunity.prescription_category)}`}
        </Tag>
        <Tag>
          {`${t('webmasterData.opportunity.impact')} ${enumLabel(t, 'action.levels', opportunity.impact)}`}
        </Tag>
        <Tag>
          {`${t('webmasterData.opportunity.difficulty')} ${enumLabel(t, 'action.levels', opportunity.difficulty)}`}
        </Tag>
        <Tag>
          {`${t('webmasterData.opportunity.confidence')} ${confidenceText(opportunity.confidence)}`}
        </Tag>
      </Space>

      {opportunity.status === 'adopted' ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.opportunity.adopted')}
        </Typography.Paragraph>
      ) : null}
      {opportunity.status === 'ignored' ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('webmasterData.opportunity.ignored')}
        </Typography.Paragraph>
      ) : null}

      <Space size={6} wrap>
        <Button
          size="small"
          type="primary"
          loading={busy}
          disabled={opportunity.status === 'adopted'}
          onClick={() => onStatus(opportunity, 'adopted')}
        >
          {t('webmasterData.opportunity.adopt')}
        </Button>
        <Button
          size="small"
          loading={busy}
          disabled={opportunity.status === 'ignored'}
          onClick={() => onStatus(opportunity, 'ignored')}
        >
          {t('webmasterData.opportunity.ignore')}
        </Button>
        <Tooltip title={t('webmasterData.opportunity.toArticleHint')}>
          <Button size="small" onClick={() => onToArticle(opportunity)}>
            {t('webmasterData.opportunity.toArticle')}
          </Button>
        </Tooltip>
        <Tooltip title={t('webmasterData.opportunity.toPatchHint')}>
          <Button size="small" onClick={() => onToPatch(opportunity)}>
            {t('webmasterData.opportunity.toPatch')}
          </Button>
        </Tooltip>
      </Space>
    </Card>
  );
}
