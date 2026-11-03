import { Alert, Button, Card, Empty, List, Progress, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import type { ActionProgress } from '../api/overview-compose';
import { enumLabel } from '../i18n/enum-label';

const TOP_SIZE = 4;

/**
 * 下一步行动：**进度环 + 未完成 Top**。
 *
 * 处方是有阶段状态的清单（todo / 进行中 / 已完成），不是时间序列，所以不用折线；
 * 进度环给"做完多少"的整体感，列表给"接下来做哪几条"的具体感。
 * 🔴 名次照后端 `rank`，前端不按 impact 重排（重排会让首页和行动中心各说一套）。
 */
export default function OverviewActionsCard({
  progress,
  loading,
  error,
  onOpen,
}: {
  progress: ActionProgress;
  loading: boolean;
  error: unknown | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <Card
      size="small"
      loading={loading}
      title={t('overview.actions.title')}
      style={{ height: '100%' }}
      extra={
        <Button type="link" size="small" onClick={onOpen}>
          {t('overview.actions.open')}
        </Button>
      }
    >
      {error !== null ? (
        <Alert type="error" showIcon message={describeIpcError(error, t)} />
      ) : progress.total === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.actions.empty')} />
      ) : (
        <>
          <Space size={16} align="center" style={{ width: '100%' }}>
            <Progress
              type="dashboard"
              percent={percent}
              size={92}
              format={() => `${progress.done}/${progress.total}`}
            />
            <Space direction="vertical" size={4}>
              <Typography.Text strong>
                {t('overview.actions.progress', {
                  done: progress.done,
                  total: progress.total,
                })}
              </Typography.Text>
              <Space size={4} wrap>
                <Tag color="processing">
                  {t('overview.actions.inProgress', { value: progress.in_progress })}
                </Tag>
                <Tag>{t('overview.actions.todo', { value: progress.todo })}</Tag>
                <Tag color="green">
                  {t('overview.actions.quickWins', { value: progress.quick_wins_open })}
                </Tag>
              </Space>
            </Space>
          </Space>

          <List
            size="small"
            style={{ marginTop: 8 }}
            dataSource={progress.top_open.slice(0, TOP_SIZE)}
            rowKey={(item) => item.id}
            renderItem={(item) => (
              <List.Item style={{ paddingInline: 0 }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space size={4} wrap>
                    <Tag>{t('overview.actions.rank', { value: item.rank })}</Tag>
                    <Tag color="blue">{enumLabel(t, 'action.categories', item.category)}</Tag>
                    {item.quick_win && <Tag color="green">{t('overview.actions.quickWin')}</Tag>}
                  </Space>
                  {/* 处方标题是数据级中文，en 界面下照旧显示中文（与行动中心同口径）。 */}
                  <Typography.Text>{item.title}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </>
      )}
    </Card>
  );
}
