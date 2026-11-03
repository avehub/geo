import { Alert, Button, Card, Empty, Progress, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import type { Article, SitePatch } from '../api/types';

function countStatus<T extends string>(rows: readonly { status: T }[], status: T): number {
  return rows.filter((row) => row.status === status).length;
}

function share(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

/**
 * 交付进度：文章评审队列 + 官网补丁台账。
 *
 * 这两个模块是"处方落地"的下半段：文章是内容交付，补丁是官网交付。
 * 首页只给**待处理量与完成比例**，具体审稿/回滚留在各自页面。
 */
export default function OverviewDeliveryCard({
  articles,
  patches,
  loading,
  articleError,
  siteError,
  onOpenArticles,
  onOpenSite,
}: {
  articles: Article[] | null;
  patches: SitePatch[] | null;
  loading: boolean;
  articleError: unknown | null;
  siteError: unknown | null;
  onOpenArticles: () => void;
  onOpenSite: () => void;
}) {
  const { t } = useTranslation();

  const articleRows = articles ?? [];
  const patchRows = patches ?? [];
  const pending = countStatus(articleRows, 'pending_review');
  const approved = countStatus(articleRows, 'approved');
  const rejected = countStatus(articleRows, 'rejected');
  const published = countStatus(patchRows, 'published');
  const draft = countStatus(patchRows, 'draft');
  const unpublished = countStatus(patchRows, 'unpublished');

  const empty =
    articleError === null &&
    siteError === null &&
    articles !== null &&
    patches !== null &&
    articleRows.length === 0 &&
    patchRows.length === 0;

  return (
    <Card
      size="small"
      loading={loading}
      title={t('overview.delivery.title')}
      style={{ height: '100%' }}
    >
      {empty ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.delivery.empty')} />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text strong>{t('overview.delivery.articles')}</Typography.Text>
              <Button type="link" size="small" onClick={onOpenArticles}>
                {t('overview.delivery.openArticles')}
              </Button>
            </Space>
            {articleError !== null ? (
              <Alert type="error" showIcon message={describeIpcError(articleError, t)} />
            ) : (
              <>
                <Progress
                  percent={share(approved, articleRows.length)}
                  size="small"
                  format={() => t('overview.delivery.total', { value: articleRows.length })}
                />
                <Space size={4} wrap>
                  <Tag color="orange">{t('overview.delivery.pending', { value: pending })}</Tag>
                  <Tag color="green">{t('overview.delivery.approved', { value: approved })}</Tag>
                  <Tag color="red">{t('overview.delivery.rejected', { value: rejected })}</Tag>
                </Space>
              </>
            )}
          </div>

          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text strong>{t('overview.delivery.patches')}</Typography.Text>
              <Button type="link" size="small" onClick={onOpenSite}>
                {t('overview.delivery.openSite')}
              </Button>
            </Space>
            {siteError !== null ? (
              <Alert type="error" showIcon message={describeIpcError(siteError, t)} />
            ) : (
              <>
                <Progress
                  percent={share(published, patchRows.length)}
                  size="small"
                  format={() => t('overview.delivery.total', { value: patchRows.length })}
                />
                <Space size={4} wrap>
                  <Tag color="green">{t('overview.delivery.published', { value: published })}</Tag>
                  <Tag>{t('overview.delivery.draft', { value: draft })}</Tag>
                  <Tag>{t('overview.delivery.unpublished', { value: unpublished })}</Tag>
                </Space>
              </>
            )}
          </div>
        </Space>
      )}
    </Card>
  );
}
