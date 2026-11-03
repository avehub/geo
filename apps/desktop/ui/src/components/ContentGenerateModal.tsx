import { useMemo, useState } from 'react';
import { Alert, App, Descriptions, Modal, Select, Space, Tag, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import { describeIpcError } from '../api/errors';
import type { ActionItem, ContentTemplate, GeneratedContent } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/**
 * 「生成可交付物」弹窗：从一条处方或从模板区进来，选一个模板，产出一份**演示文稿**。
 *
 * 🔴 demo 不调模型（`demo/handlers/action.ts` 的头注释）：`content_generate` 按模板种类取
 * `seed/contents.ts` 里预置的那份文稿。界面上因此必须挂着 `action.contents.demoBody` 那句，
 * 免得产品负责人把它当成模型产物评审文笔——走查的是**产物形态**（章节结构、审核态、导出）。
 *
 * 从处方进来时按 `ContentTemplate.target_categories` 过滤模板（处方类别 → 适配模板），
 * 从模板区进来则全给。过滤是展示层的挑选，不是"推荐算法"。
 */
export default function ContentGenerateModal({
  projectId,
  open,
  target,
  templates,
  onClose,
  onGenerated,
}: {
  projectId: string;
  open: boolean;
  /** 关联的处方；`null` = 从模板区进来，不挂处方。 */
  target: ActionItem | null;
  templates: ContentTemplate[];
  onClose: () => void;
  onGenerated: (content: GeneratedContent) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [templateId, setTemplateId] = useState<string | null>(null);

  const options = useMemo(
    () =>
      templates
        .filter((template) => target === null || template.target_categories.includes(target.category))
        .map((template) => ({
          value: template.id,
          label: enumLabel(t, 'action.templates.kinds', template.kind),
        })),
    [templates, target, t],
  );

  const selected = templates.find((template) => template.id === (templateId ?? options[0]?.value)) ?? null;

  const generateMutation = useMutation({
    mutationFn: () =>
      action.contentGenerate(projectId, selected?.id ?? '', target?.id ?? null),
    onSuccess: (content) => {
      message.success(t('action.contents.generated'));
      setTemplateId(null);
      onGenerated(content);
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  return (
    <Modal
      open={open}
      title={t('action.templates.generate')}
      width={560}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={generateMutation.isPending}
      okButtonProps={{ disabled: selected === null }}
      onCancel={() => {
        setTemplateId(null);
        onClose();
      }}
      onOk={() => generateMutation.mutate()}
    >
      {target !== null && (
        <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
          <Descriptions.Item label={t('action.list.actionTitle')}>{target.title}</Descriptions.Item>
          <Descriptions.Item label={t('action.list.deliverable')}>
            {target.deliverable}
          </Descriptions.Item>
        </Descriptions>
      )}

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Select
          style={{ width: '100%' }}
          placeholder={t('action.templates.kind')}
          value={selected?.id}
          onChange={setTemplateId}
          options={options}
          notFoundContent={t('action.templates.empty')}
        />
        {selected !== null && (
          <>
            <Space size={4} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`${t('action.templates.sections')}:`}
              </Typography.Text>
              {selected.section_keys.map((key) => (
                <Tag key={key}>{enumLabel(t, 'action.templateSections', key)}</Tag>
              ))}
            </Space>
            <Space size={4} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`${t('action.templates.formats')}:`}
              </Typography.Text>
              {selected.export_formats.map((format) => (
                <Tag key={format}>{enumLabel(t, 'common.exportFormats', format)}</Tag>
              ))}
            </Space>
          </>
        )}
        <Alert type="info" showIcon message={t('action.contents.demoBody')} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('action.contents.pendingNote')}
        </Typography.Text>
      </Space>
    </Modal>
  );
}
