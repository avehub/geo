import { useCallback } from 'react';
import { Alert, App, Button, Card, Col, Empty, Progress, Row, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { EntityCard, FieldStatus } from '../api/types';
import AutoBuildPanel from '../components/AutoBuildPanel';
import EntityFieldCard from '../components/EntityFieldCard';
import { ENTITY_FIELDS } from '../components/entity-fields';
import RevisionTimeline from '../components/RevisionTimeline';

function fieldValue(card: EntityCard, path: string): unknown {
  return (card.fields as unknown as Record<string, unknown>)[path];
}

/** M1 品牌实体卡：字段级编辑、可信状态、完整率与修订留痕。 */
export default function EntityCardPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const cardQuery = useQuery({
    queryKey: ['entity-card', projectId],
    queryFn: () => client.entityCardGet(projectId),
    enabled: projectId !== '',
  });

  const revisionQuery = useQuery({
    queryKey: ['entity-card-revisions', projectId],
    queryFn: () => client.entityCardRevisions(projectId),
    enabled: projectId !== '',
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['entity-card', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['entity-card-revisions', projectId] });
  }, [queryClient, projectId]);

  const updateMutation = useMutation({
    mutationFn: ({ path, value, status }: { path: string; value: unknown; status: FieldStatus }) =>
      client.entityCardUpdateField(projectId, path, value, status, null),
    onSuccess: () => {
      message.success('字段已更新，修订已留痕');
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  if (cardQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载实体卡失败"
        description={describeIpcError(cardQuery.error, t)}
      />
    );
  }

  const card = cardQuery.data ?? null;
  const percent = card ? Math.round(card.completeness * 100) : 0;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        品牌实体卡
      </Typography.Title>

      <AutoBuildPanel
        projectId={projectId}
        onBuilt={(card) => {
          // 直接把新卡写进缓存：比 invalidate 后再 get 少一次往返，也不会闪回旧完整率
          queryClient.setQueryData(['entity-card', projectId], card);
          void queryClient.invalidateQueries({ queryKey: ['entity-card-revisions', projectId] });
        }}
      />

      {card === null ? (
        <Card>
          <Empty description="还没有实体卡，先用上方「自动建档」抓一次官网，或手工逐字段填写">
            <Button
              type="primary"
              onClick={() =>
                updateMutation.mutate({ path: 'standard_name', value: '', status: 'pending' })
              }
            >
              手工新建空白实体卡
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={16}>
          <Col span={17}>
            <Card
              size="small"
              title={
                <Space size={16}>
                  <span>字段完整率</span>
                  <Progress type="circle" size={64} percent={percent} />
                </Space>
              }
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {card.source.llm_provider
                    ? `AI 抽取：${card.source.llm_provider} ${card.source.llm_model ?? ''}`
                    : '人工录入'}
                </Typography.Text>
              }
            >
              <Row gutter={[12, 12]}>
                {ENTITY_FIELDS.map((descriptor) => (
                  <Col span={12} key={descriptor.path}>
                    <EntityFieldCard
                      descriptor={descriptor}
                      value={fieldValue(card, descriptor.path)}
                      status={card.field_status[descriptor.path] ?? 'pending'}
                      saving={
                        updateMutation.isPending &&
                        updateMutation.variables?.path === descriptor.path
                      }
                      onSave={(value, status) =>
                        updateMutation.mutate({ path: descriptor.path, value, status })
                      }
                    />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
          <Col span={7}>
            <Card size="small" title="修订历史">
              <RevisionTimeline revisions={revisionQuery.data ?? []} />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
