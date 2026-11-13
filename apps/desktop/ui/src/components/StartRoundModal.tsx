import { useEffect } from 'react';
import { Alert, App, Checkbox, Form, Input, Modal, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import * as collection from '../api/collection';
import { runtime } from '../api/runtime';
import { describeIpcError } from '../api/errors';
import type { CollectionRound, EngineId } from '../api/types';
import { availableEngines } from '../api/build-flavor';
import { enumLabel } from '../i18n/enum-label';

/** 重复采样的三个档位（产品定义 §3.5：1/2/3）。 */
const REPEAT_OPTIONS = [1, 2, 3] as const;

/**
 * 「排一轮采集」弹窗（M3）。
 *
 * 演示模式**不发请求**：提交之后新轮次停在「排队中」、任务队列为空（`collection.start.demoNotice`）。
 * 桌面端会 enqueue 出 `题目数 × 引擎数 × 重复次数` 条任务并在后台逐条跑官方 API
 * （`collection.start.liveNotice` 写明范围与元宝 / 秘塔的跳过口径）。
 *
 * 轮次名称留空时由假后端回落到题库名（数据级中文）：组件里不许拼中文字面量（门禁 7）。
 */
export default function StartRoundModal({
  projectId,
  open,
  onClose,
  onQueued,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onQueued: (round: CollectionRound) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    prompt_set_id: string;
    engine_scope: EngineId[];
    repeat_count: number;
    label: string;
  }>();

  const setsQuery = useQuery({
    queryKey: ['prompt-sets', projectId],
    queryFn: () => client.promptSetList(projectId),
    enabled: open && projectId !== '',
  });

  // 关掉再打开要回到默认值：Form 的 initialValues 只在挂载时生效，所以显式 reset。
  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  /**
   * 🔴 题库的默认值必须在数据到达之后**再落一次**（照 `InsightCorrectModal` 的 `setFieldsValue` 口径）。
   *
   * 弹窗挂载那一刻 `prompt_set_list` 还没回来 ⇒ `initialValues.prompt_set_id` 是 `undefined`，
   * 而 `initialValues` 只在挂载时读一次。结果就是「选择题库」空着，用户直接点「排队」拿到
   * `prompt_set/not_found`，界面上只看到一句「操作未成功，请稍后重试」——一个默认值没跟上
   * 异步数据的小疏漏，表现成了一条看不懂的错误（由 `pages/CollectionPage.test.tsx` 抓到）。
   * 用户已经自己选过（值非 `undefined`）时不覆盖。
   */
  useEffect(() => {
    if (!open) return;
    // 默认选“样本充足”的那份；没有就退回落最新一份。演示种子里最新的是 28 条小样本，
    // 直接取 [0] 会把用户带进一轮 insufficient 采集。
    const firstSetId =
      setsQuery.data?.find((set) => set.sample_size_grade === 'sufficient')?.id ??
      setsQuery.data?.[0]?.id;
    if (firstSetId === undefined) return;
    if (form.getFieldValue('prompt_set_id') === undefined) {
      form.setFieldValue('prompt_set_id', firstSetId);
    }
  }, [open, form, setsQuery.data]);

  const startMutation = useMutation({
    mutationFn: () => {
      const values = form.getFieldsValue();
      return collection.collectionStart(projectId, {
        prompt_set_id: values.prompt_set_id,
        engine_scope: values.engine_scope ?? [],
        repeat_count: values.repeat_count ?? 1,
        label: values.label?.trim() === '' ? null : (values.label ?? null),
      });
    },
    onSuccess: (round) => {
      message.success(t('collection.start.queued', { label: round.label }));
      onQueued(round);
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  return (
    <Modal
      open={open}
      title={t('collection.start.title')}
      okText={t('collection.start.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={startMutation.isPending}
      onOk={() => {
        const scope = form.getFieldValue('engine_scope') as EngineId[] | undefined;
        if (!scope || scope.length === 0) {
          message.error(t('collection.start.engineRequired'));
          return;
        }
        startMutation.mutate();
      }}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t(
          runtime === 'demo' ? 'collection.start.demoNotice' : 'collection.start.liveNotice',
        )}
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          prompt_set_id:
            setsQuery.data?.find((set) => set.sample_size_grade === 'sufficient')?.id ??
            setsQuery.data?.[0]?.id,
          engine_scope: [...availableEngines()],
          repeat_count: 1,
          label: '',
        }}
      >
        <Form.Item name="prompt_set_id" label={t('collection.start.promptSet')}>
          <Select
            loading={setsQuery.isFetching}
            options={(setsQuery.data ?? []).map((set) => ({
              value: set.id,
              label: `${set.label} (v${set.version} · ${set.item_count})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="engine_scope" label={t('collection.start.engines')}>
          <Checkbox.Group
            options={[...availableEngines()].map((engine) => ({
              value: engine,
              label: enumLabel(t, 'collection.engines', engine),
            }))}
          />
        </Form.Item>
        <Form.Item name="repeat_count" label={t('collection.start.repeatCount')}>
          <Select
            options={[...REPEAT_OPTIONS].map((value) => ({ value, label: String(value) }))}
          />
        </Form.Item>
        <Form.Item name="label" label={t('collection.start.label')}>
          <Input placeholder={t('collection.start.labelPlaceholder')} maxLength={60} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
