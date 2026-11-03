import { Alert, Descriptions, Drawer, Empty, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as collection from '../api/collection';
import { describeIpcError } from '../api/errors';
import type { Citation } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText, latencyText, tokensText } from './format';

/**
 * 原始证据抽屉（M3 的护城河视图：任何分数都能下钻到 prompt 原文 + 引擎与模型版本 +
 * 完整回答 + 引用链接 + 时间戳 + 通道 + 耗时 + token）。
 *
 * 采集页的证据表与解析页的解析结果表**共用这一个组件**：两处下钻的是同一条证据，
 * 各写一份就会出现"两个抽屉显示的字段不一样"这种自相矛盾。
 *
 * 🔴 截图那一格永远显示空状态：demo 不抓网页也不截图（`CollectionRecordDetail.screenshot_path`
 * 恒为 `null`），编一个路径就是假证据。文案在 `collection.evidence.noScreenshot`。
 */
export default function EvidenceDrawer({
  recordId,
  onClose,
}: {
  /** `null` = 关闭（Drawer 的 open 与查询的 enabled 都由它决定）。 */
  recordId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['collection-record', recordId],
    queryFn: () => collection.collectionRecordGet(recordId ?? ''),
    enabled: recordId !== null,
  });

  const record = query.data ?? null;

  return (
    <Drawer
      open={recordId !== null}
      onClose={onClose}
      width={720}
      title={t('collection.evidence.title')}
      destroyOnHidden
    >
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message={describeIpcError(query.error, t)}
        />
      ) : record === null ? (
        <Empty description={t('common.loading')} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label={t('collection.records.prompt')} span={2}>
              {record.prompt_text}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.records.intent')}>
              {enumLabel(t, 'prompt.intents', record.intent)}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.records.engine')}>
              <Space size={4}>
                <Tag>{enumLabel(t, 'collection.engines', record.engine)}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {record.model}
                </Typography.Text>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.evidence.channel')}>
              {enumLabel(t, 'collection.channels', record.channel)}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.evidence.collectedAt')}>
              {dateTimeText(record.collected_at)}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.evidence.latency')}>
              {latencyText(t, record.latency_ms)}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.evidence.tokens')}>
              {`${tokensText(t, record.prompt_tokens)} / ${tokensText(
                t,
                record.completion_tokens,
              )}`}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.records.mentioned')}>
              {record.mentioned ? (
                <Tag color="green">{t('collection.records.mentionedYes')}</Tag>
              ) : (
                <Tag>{t('collection.records.mentionedNo')}</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.records.rank')}>
              {record.rank === null ? '—' : record.rank}
            </Descriptions.Item>
            <Descriptions.Item label={t('collection.records.status')}>
              <Space size={4}>
                <Tag color={record.status === 'succeeded' ? 'green' : 'orange'}>
                  {enumLabel(t, 'collection.taskStatuses', record.status)}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('collection.evidence.repeatIndex', { index: record.repeat_index })}
                </Typography.Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>

          {record.failure_reason !== null && (
            <Alert
              type="warning"
              showIcon
              message={`${t('collection.evidence.failed')}: ${enumLabel(
                t,
                'collection.failureReasons',
                record.failure_reason,
              )}`}
            />
          )}

          <div>
            <Typography.Title level={5}>{t('collection.evidence.answer')}</Typography.Title>
            {record.answer_text === '' ? (
              <Empty description={t('collection.evidence.failed')} />
            ) : (
              // 回答全文原样留存、按换行分段展示；**不用** dangerouslySetInnerHTML
              // （`i18n/index.ts` 的 R-I 约束同理：数据不是标记）。
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {record.answer_text}
              </Typography.Paragraph>
            )}
          </div>

          <div>
            <Typography.Title level={5}>{t('collection.evidence.citations')}</Typography.Title>
            {record.citations.length === 0 ? (
              <Empty description={t('collection.evidence.noCitations')} />
            ) : (
              <Table<Citation>
                size="small"
                rowKey="url"
                pagination={false}
                dataSource={record.citations}
                columns={[
                  {
                    title: t('collection.evidence.citations'),
                    dataIndex: 'title',
                    render: (_, citation) => (
                      <a href={citation.url} target="_blank" rel="noreferrer">
                        {citation.title ?? citation.domain}
                      </a>
                    ),
                  },
                  {
                    title: t('collection.evidence.domain'),
                    dataIndex: 'domain',
                  },
                  {
                    title: t('collection.evidence.sourceType'),
                    dataIndex: 'source_type',
                    render: (value: string) => enumLabel(t, 'collection.sourceTypes', value),
                  },
                ]}
              />
            )}
          </div>

          <div>
            <Typography.Title level={5}>{t('collection.evidence.screenshot')}</Typography.Title>
            <Empty description={t('collection.evidence.noScreenshot')} />
          </div>
        </Space>
      )}
    </Drawer>
  );
}
