import { Button, Card, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ArticleDirection } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface ArticleDirectionCardsProps {
  rows: ArticleDirection[];
  loading?: boolean;
  /** 方向 id → 挂在它下面的模板数（survey §4B：方向卡上显示"已绑定模板数 / 累计产出"）。 */
  templateCounts: Record<string, number>;
  /** 方向 id → 它累计产出的文章数。 */
  articleCounts: Record<string, number>;
  /** 正在归档 / 恢复的那一张卡（按钮只让被点的那张转圈）。 */
  busyId?: string | null;
  onToggleStatus: (row: ArticleDirection) => void;
}

/**
 * ① 方向与策略的卡片列表（spec 2026-10-10 · DR-86①）。
 *
 * # 为什么是卡片而不是表格
 * 方向是"写什么、写给谁"的**一句话主张** + 一段场景摘要，读起来是散文；表格会把摘要截断成
 * 一屏看不全的省略号（survey §4B 的「方向卡」也是这个形态）。密集表格留给模板与文章队列。
 *
 * # 🔴 归档不是删除
 * `status: 'archived'` 只是把这张卡换成「恢复」按钮：已经挂在它下面的模板与已经生成的文章
 * 都还在（`article_template_delete` 才真的连带删排期）。所以卡片**不按状态过滤**，
 * 已归档的那张留在原位、挂状态标签，免得"我归档的方向去哪了"。
 *
 * # 空值与标签
 * 来源标签走 `enumLabel(t, 'article.sources', …)`（DR-88），状态标签只在**已归档**时出现
 * ——"在用"是默认态，每张卡都挂一个「在用」等于没挂。
 */
export default function ArticleDirectionCards({
  rows,
  loading = false,
  templateCounts,
  articleCounts,
  busyId = null,
  onToggleStatus,
}: ArticleDirectionCardsProps) {
  const { t } = useTranslation();

  if (rows.length === 0 && !loading) {
    return <Empty description={t('article.directions.empty')} />;
  }

  return (
    <Row gutter={[12, 12]}>
      {rows.map((row) => (
        <Col key={row.id} xs={24} md={12} xl={8}>
          <div data-testid={`article-direction-${row.id}`}>
            <Card
              size="small"
              loading={loading}
              title={<Typography.Text strong>{row.title}</Typography.Text>}
              extra={
                <Space size={4}>
                  {row.status === 'archived' ? (
                    <Tag>{t('article.directions.statusArchived')}</Tag>
                  ) : null}
                  <Tag color={row.source === 'generated' ? 'purple' : undefined}>
                    {enumLabel(t, 'article.sources', row.source)}
                  </Tag>
                </Space>
              }
            >
              <Typography.Paragraph
                type="secondary"
                style={{ fontSize: 12, marginBottom: 8 }}
              >
                {row.summary}
              </Typography.Paragraph>
              <Space size={12} style={{ fontSize: 12 }}>
                <Typography.Text type="secondary">
                  {t('article.directions.templateCount', {
                    total: templateCounts[row.id] ?? 0,
                  })}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t('article.directions.articleCount', { total: articleCounts[row.id] ?? 0 })}
                </Typography.Text>
                <Button
                  size="small"
                  loading={busyId === row.id}
                  onClick={() => onToggleStatus(row)}
                >
                  {row.status === 'archived'
                    ? t('article.directions.restore')
                    : t('article.directions.archive')}
                </Button>
              </Space>
            </Card>
          </div>
        </Col>
      ))}
    </Row>
  );
}
