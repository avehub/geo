import { Alert, App, Modal, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { PromptDraft } from '../api/types';

export interface LibraryReferenceModalProps {
  open: boolean;
  projectId: string;
  /** 由页面层从勾选的素材映射出来（DR-43 的映射规则写在页面里，组件只管提交）。 */
  drafts: PromptDraft[];
  /** 预览用的题干清单（数据，不是文案）。 */
  previews: string[];
  /**
   * 映射说明（已翻译）。🔴 由**页面**决定用哪一句，不由本组件猜：
   * 权重那一半两侧不同源（关键词用 `priority`、FAQ 用题库默认值），合成一句必对一页说谎。
   */
  mappingNote: string;
  onClose: () => void;
  /** 引用成功后回调（页面层据此提示"去题库看看"或刷新自己的缓存）。 */
  onReferenced: (count: number) => void;
}

/**
 * 「引用到 Prompt 题库」弹窗（spec DR-43）。
 *
 * 🔴 **不加新命令**：走既有的 `prompt_item_add`（M2 那 11 条里的一条）。素材库与题库之间
 * 因此是一条**真的写路径**——引用完切到「Prompt 题库」页就能看到那几道题，
 * 而不是界面上演一个假动作。
 *
 * 两条必须显示的说明：
 * - `mappingNote`（页面传入）：文本/问题 → 题干、意图沿用、权重按素材类型取值，分组与标签留空；
 * - `sourceNote`：引用后来源按「人工录入」计（`prompt_item_add` 把 `source` 固定成 `manual`，
 *   真值源见 `demo/handlers/shared.ts` 的 `asPromptSource`）。不写这句，
 *   产品负责人会以为题库里能看出"这条来自 AI 生成的素材"。
 */
export default function LibraryReferenceModal({
  open,
  projectId,
  drafts,
  previews,
  mappingNote,
  onClose,
  onReferenced,
}: LibraryReferenceModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [setId, setSetId] = useState<string | null>(null);

  const setsQuery = useQuery({
    queryKey: ['prompt-sets', projectId],
    queryFn: () => client.promptSetList(projectId),
    enabled: open && projectId !== '',
  });

  const sets = setsQuery.data ?? [];
  // 默认选样本充足的那份；没有就回落最新。演示种子里最新的是 28 条小样本，
  // 直接取 [0] 会把素材引用进一份 insufficient 的题库。
  const activeId =
    setId ?? sets.find((set) => set.sample_size_grade === 'sufficient')?.id ?? sets[0]?.id ?? null;
  const activeLabel = sets.find((set) => set.id === activeId)?.label ?? '';

  const addMutation = useMutation({
    mutationFn: () => client.promptItemAdd(activeId ?? '', drafts),
    onSuccess: () => {
      message.success(t('library.reference.done', { total: drafts.length, label: activeLabel }));
      setSetId(null);
      onReferenced(drafts.length);
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  return (
    <Modal
      open={open}
      title={t('library.reference.title')}
      width={620}
      okText={t('library.reference.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={addMutation.isPending}
      okButtonProps={{ disabled: activeId === null || drafts.length === 0 }}
      onCancel={() => {
        setSetId(null);
        onClose();
      }}
      onOk={() => addMutation.mutate()}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {sets.length === 0 && setsQuery.isSuccess ? (
          <Alert type="warning" showIcon message={t('library.reference.noSets')} />
        ) : (
          <>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('library.reference.targetSet')}
              </Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                loading={setsQuery.isFetching}
                placeholder={t('library.reference.targetSetPlaceholder')}
                value={activeId}
                onChange={setSetId}
                options={sets.map((set) => ({
                  value: set.id,
                  label: `${set.label} (${set.item_count})`,
                }))}
              />
            </div>
            <Typography.Text>{t('library.reference.willAdd', { total: drafts.length })}</Typography.Text>
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {previews.map((text) => (
                <Typography.Paragraph key={text} style={{ marginBottom: 2, fontSize: 12 }}>
                  {text}
                </Typography.Paragraph>
              ))}
            </div>
            <Alert type="info" showIcon message={mappingNote} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('library.reference.sourceNote')}
            </Typography.Text>
          </>
        )}
      </Space>
    </Modal>
  );
}
