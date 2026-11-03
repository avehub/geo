import { useEffect } from 'react';
import { Alert, App, Form, InputNumber, Modal, Select, Switch, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as insight from '../api/insight';
import { describeIpcError } from '../api/errors';
import type { AnswerInsight, InsightCorrection, Sentiment } from '../api/types';
import { SENTIMENT_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/**
 * 人工纠正弹窗（M4 的抽取质量保障：低置信度进复核队列 → 一键纠正）。
 *
 * 只放开三项（`InsightCorrection`）：是否提及 / 推荐位次 / 情感倾向。
 * 提及明细、回答形态、来源分布、置信度、风险标记都是模型与规则的产物，**不接受手填**——
 * 让人改这些等于把"机器抽取的结果"与"人的判断"混成一团，事后没法追溯。
 *
 * 🔴 纠正不会重算任何比率（`insight.correct.demoNotice` 就是这句话）。
 */
export default function InsightCorrectModal({
  target,
  onClose,
  onCorrected,
}: {
  /** `null` = 关闭。 */
  target: AnswerInsight | null;
  onClose: () => void;
  onCorrected: (updated: AnswerInsight) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    self_mentioned: boolean;
    self_rank: number | null;
    self_sentiment: Sentiment | null;
  }>();

  useEffect(() => {
    if (target !== null) {
      form.setFieldsValue({
        self_mentioned: target.self_mentioned,
        self_rank: target.self_rank,
        self_sentiment: target.self_sentiment,
      });
    }
  }, [target, form]);

  const correctMutation = useMutation({
    mutationFn: (correction: InsightCorrection) => insight.insightCorrect(target?.id ?? '', correction),
    onSuccess: (updated) => {
      message.success(t('insight.correct.ok'));
      onCorrected(updated);
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const selfExcerpt = target?.mentions.find((mention) => mention.role === 'self')?.excerpt ?? '';

  return (
    <Modal
      open={target !== null}
      title={t('insight.correct.title')}
      okText={t('insight.correct.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={correctMutation.isPending}
      onOk={() => {
        const values = form.getFieldsValue();
        const rank = values.self_rank ?? null;
        if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
          message.error(t('insight.correct.rankInvalid'));
          return;
        }
        correctMutation.mutate({
          self_mentioned: values.self_mentioned,
          self_rank: values.self_mentioned ? rank : null,
          self_sentiment: values.self_mentioned ? (values.self_sentiment ?? null) : null,
        });
      }}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('insight.correct.demoNotice')} />
      {target !== null && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          <strong>{t('insight.list.prompt')}</strong>
          {`: ${target.prompt_text}`}
        </Typography.Paragraph>
      )}
      {selfExcerpt !== '' && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          <strong>{t('insight.correct.excerpt')}</strong>
          {`: ${selfExcerpt}`}
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="self_mentioned" label={t('insight.correct.mentioned')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="self_rank" label={t('insight.correct.rank')}>
          <InputNumber min={1} precision={0} placeholder={t('insight.correct.rankPlaceholder')} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="self_sentiment" label={t('insight.correct.sentiment')}>
          <Select
            allowClear
            options={[...SENTIMENT_VALUES].map((value) => ({
              value,
              label: enumLabel(t, 'common.sentiments', value),
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
