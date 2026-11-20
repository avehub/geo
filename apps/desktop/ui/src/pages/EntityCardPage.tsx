import { useCallback } from 'react';
import { Alert, App, Card, Col, Empty, Progress, Row, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { EntityCard, FieldStatus } from '../api/types';
import AutoBuildPanel from '../components/AutoBuildPanel';
import PageHeader from '../components/ui/PageHeader';
import EntityFieldCard from '../components/EntityFieldCard';
import { ENTITY_FIELDS, entityFieldLabelKey } from '../components/entity-fields';
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

  /**
   * 🔴 顺带把知识库的 board 一起失效（spec 2026-10-01 · DR-67 的**接线**那一半）。
   *
   * 同步块不落库、`kb_board` 每次现场投影，所以"自动更新"本来就是结构性成立的；
   * 这一行解决的是**缓存**：不改它的话，从实体卡切回知识库会先看到 React Query 里的旧 board
   * （`staleTime` 默认 0 ⇒ 会后台重取，但首帧仍是旧值），走查第 4 步就会看起来"要刷两次"。
   */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['entity-card', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['entity-card-revisions', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['kb-board', projectId] });
  }, [queryClient, projectId]);

  const updateMutation = useMutation({
    mutationFn: ({ path, value, status }: { path: string; value: unknown; status: FieldStatus }) =>
      client.entityCardUpdateField(projectId, path, value, status, null),
    onSuccess: () => {
      message.success(t('entity.card.fieldUpdated'));
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  if (cardQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('entity.card.loadFailed')}
        description={describeIpcError(cardQuery.error, t)}
      />
    );
  }

  const card = cardQuery.data ?? null;
  const percent = card ? Math.round(card.completeness * 100) : 0;
  /**
   * 抓到了页面、但 `llm_provider` 为空 ⇒ 后端走了 FR-M1-2 的降级分支：
   * 字段来自建项资料，不是官网内容。这个状态必须说破——否则「20% + 人工录入」
   * 会被读成「模型抽了但没抽到」，用户不知道该去配模型（2026-11-06 报障）。
   */
  const degraded =
    card !== null && card.source.crawled_pages.length > 0 && card.source.llm_provider === null;

  return (
    <div>
      <PageHeader title={t('entity.card.title')} />

      {degraded && card !== null && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('entity.card.degradedTitle', { pages: card.source.crawled_pages.length })}
          description={
            <Space direction="vertical" size={4}>
              <span>{t('entity.card.degradedBody')}</span>
              <Link to="/settings/models">{t('entity.card.degradedAction')}</Link>
            </Space>
          }
        />
      )}

      <AutoBuildPanel
        projectId={projectId}
        onBuilt={(card) => {
          // 直接把新卡写进缓存：比 invalidate 后再 get 少一次往返，也不会闪回旧完整率
          queryClient.setQueryData(['entity-card', projectId], card);
          void queryClient.invalidateQueries({ queryKey: ['entity-card-revisions', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['kb-board', projectId] });
        }}
      />

      {card === null ? (
        <Card>
          <Empty description={t('entity.card.empty')} />
        </Card>
      ) : (
        <Row gutter={16}>
          <Col span={17}>
            <Card
              size="small"
              title={
                <Space size={16}>
                  <span>{t('entity.card.completeness')}</span>
                  {/*
                    圈与圈内百分比整体缩到 70%（产品走查：64px 圈偏大）。
                    antd 的圈内字号是 `width * 0.15 + 6`：只改 size 到 45 时字号只降到
                    12.75px（-18%），所以用 format 显式给 11px（15.6 × 0.7 ≈ 10.9）。
                  */}
                  <Progress
                    type="circle"
                    size={45}
                    percent={percent}
                    format={(value) => (
                      <span style={{ fontSize: 11 }}>{`${value ?? 0}%`}</span>
                    )}
                  />
                </Space>
              }
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {card.source.llm_provider
                    ? t('entity.card.sourceAi', {
                        provider: card.source.llm_provider,
                        model: card.source.llm_model ?? '',
                      })
                    : card.source.crawled_pages.length > 0
                      ? t('entity.card.sourceCrawledNoAi')
                      : t('entity.card.sourceManual')}
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
            <Card size="small" title={t('entity.card.revisions')}>
              {/* DR-119：时间线组件已泛化（知识库那侧共用同一个），字段标签表由调用方传。 */}
              <RevisionTimeline
                revisions={revisionQuery.data ?? []}
                labelKeyOf={entityFieldLabelKey}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
