import { CheckOutlined, CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Select, Space } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ArticleStatus } from '../api/types';
import { ARTICLE_STATUS_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import DisabledHint from './DisabledHint';

/** 状态筛选的取值：三档评审态 + 「全部」。 */
export type ArticleStatusFilter = ArticleStatus | 'all';

export interface ArticleReviewToolbarProps {
  statusFilter: ArticleStatusFilter;
  onStatusFilterChange: (status: ArticleStatusFilter) => void;
  /** 已勾选的行数：批量通过按钮的文案里带它，置灰与否也由它决定。 */
  selectedCount: number;
  approving?: boolean;
  rejecting?: boolean;
  /** 导出闸门（`api/article-compose.ts`）：零条「已通过」时置灰。 */
  exportDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onExport: () => void;
}

/**
 * ③ 文章评审队列的工具条（spec 2026-10-10 · DR-86③ / DR-89）。
 *
 * # 🔴 筛选是**服务端**的（走 `article_list` 的 `status` 入参），不是前端过滤
 * 与知识库那页的前端过滤刻意不同：评审队列将来会分页（真后端接生成管线后文章数是三位数起），
 * 前端过滤只对"整份清单都在手上"成立。demo 里两者结果相同，形状先按真后端的来。
 *
 * # 🔴 「全部状态」那一档的字面量就是 `review.filterAll`，不拼前缀
 * `KbToolbar` 用的是「状态 · 全部」那种拼接式标签（它有四个筛选器并排，得说清是哪一维）；
 * 这里只有一个筛选器，标签里再重复一遍"状态"是噪音。
 *
 * # 置灰必须带一句"为什么"
 * 两个动作都有前置条件（没勾选 / 没有已通过的文章），走 `DisabledHint`：
 * `disabled` 的控件不派发鼠标事件，所以那层 `<span>` 是气泡能出来的前提。
 */
export default function ArticleReviewToolbar({
  statusFilter,
  onStatusFilterChange,
  selectedCount,
  approving = false,
  rejecting = false,
  exportDisabled,
  onApprove,
  onReject,
  onExport,
}: ArticleReviewToolbarProps) {
  const { t } = useTranslation();

  return (
    <Space wrap size={8} style={{ marginBottom: 12, width: '100%' }}>
      <Select<ArticleStatusFilter>
        style={{ width: 150 }}
        aria-label={t('article.review.filterAria')}
        value={statusFilter}
        onChange={onStatusFilterChange}
        options={[
          { value: 'all', label: t('article.review.filterAll') },
          ...ARTICLE_STATUS_VALUES.map((status) => ({
            value: status,
            label: enumLabel(t, 'article.statuses', status),
          })),
        ]}
      />
      <DisabledHint hint={selectedCount === 0 ? t('article.review.needSelection') : null}>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          disabled={selectedCount === 0}
          loading={approving}
          onClick={onApprove}
        >
          {t('article.review.approveCount', { selected: selectedCount })}
        </Button>
      </DisabledHint>
      <DisabledHint hint={selectedCount === 0 ? t('article.review.needSelection') : null}>
        <Button
          danger
          icon={<CloseOutlined />}
          disabled={selectedCount === 0}
          loading={rejecting}
          onClick={onReject}
        >
          {t('article.review.rejectCount', { selected: selectedCount })}
        </Button>
      </DisabledHint>
      <DisabledHint hint={exportDisabled ? t('article.review.exportDisabled') : null}>
        <Button icon={<DownloadOutlined />} disabled={exportDisabled} onClick={onExport}>
          {t('article.review.export')}
        </Button>
      </DisabledHint>
    </Space>
  );
}
