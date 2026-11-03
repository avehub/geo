import { Descriptions, Drawer, Input, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { Article, ArticleStatus } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

export interface ArticlePreviewDrawerProps {
  article: Article | null;
  /** 方向标题与模板名（页面层查好传进来：抽屉不自己取第二份数据）。 */
  directionTitle: string;
  templateName: string;
  onClose: () => void;
}

const STATUS_COLORS: Record<ArticleStatus, string> = {
  pending_review: 'orange',
  approved: 'green',
  rejected: 'red',
};

/**
 * 文章预览侧滑（spec 2026-10-10 · DR-86③）。
 *
 * # 🔴 正文按 Markdown **原文**展示，不渲染成 HTML
 * 与 FAQ 答案、知识库条目预览同一条裁定（`library-compose.ts` 对 JSON-LD `text` 那一支）：
 * **数据不是标记**，不引 Markdown 解析器。评审要看的正是"模型吐出来的这份原文能不能用"，
 * 渲染之后反而看不出记号级的错误（残留的槽位、坏掉的列表缩进）。
 * 页面测试因此钉住"抽屉里一个 `h1/h2/h3` 都没有"——标题一旦是渲染出来的，这条就红了。
 *
 * # 🔴 待审那句免责标签在抽屉里也常驻（AGENTS 规则 6）
 * 队列里看得见、点进来就消失，等于告诉评审"进来之后就不用管合规了"。所以两处都挂。
 *
 * # 元信息用 `Descriptions`
 * 六项定长元信息（方向 / 模板 / 来源 / 状态 / 字数 / 生成时间）是**账**不是正文，
 * 用描述列表并排两列，读起来是"这一篇的属性"，不与正文混在一个流里。
 * 字数按数字直出：demo 里它是预置静态值（规则 9），千分位格式化会让它看起来像算出来的指标。
 */
export default function ArticlePreviewDrawer({
  article,
  directionTitle,
  templateName,
  onClose,
}: ArticlePreviewDrawerProps) {
  const { t } = useTranslation();
  if (article === null) return null;

  return (
    <Drawer open width={680} title={article.title} onClose={onClose}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Tag color={STATUS_COLORS[article.status]}>
            {enumLabel(t, 'article.statuses', article.status)}
          </Tag>
          <Tag>{enumLabel(t, 'article.sources', article.source)}</Tag>
          {article.status === 'pending_review' ? (
            <Tag color="orange">{t('article.review.complianceUnchecked')}</Tag>
          ) : null}
        </Space>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('article.review.bodyHint')}
        </Typography.Paragraph>

        <Input.TextArea
          readOnly
          rows={16}
          aria-label={t('article.review.previewAria')}
          value={article.body_markdown}
        />

        <Descriptions
          size="small"
          column={2}
          bordered
          items={[
            {
              key: 'direction',
              label: t('article.review.meta.direction'),
              children: directionTitle === '' ? '—' : directionTitle,
            },
            {
              key: 'template',
              label: t('article.review.meta.template'),
              children: templateName === '' ? '—' : templateName,
            },
            {
              key: 'source',
              label: t('article.review.meta.source'),
              children: enumLabel(t, 'article.sources', article.source),
            },
            {
              key: 'status',
              label: t('article.review.meta.status'),
              children: enumLabel(t, 'article.statuses', article.status),
            },
            {
              key: 'words',
              label: t('article.review.meta.words'),
              children: String(article.word_count),
            },
            {
              key: 'generatedAt',
              label: t('article.review.meta.generatedAt'),
              children: dateTimeText(article.generated_at),
            },
          ]}
        />
      </Space>
    </Drawer>
  );
}
