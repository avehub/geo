import { PlusOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ArticleTemplate } from '../api/types';
import ArticleTemplateTable from './ArticleTemplateTable';

export interface ArticleTemplatePanelProps {
  rows: ArticleTemplate[];
  loading: boolean;
  directionTitleOf: (directionId: string) => string;
  /** 正在「立即生成」的那一行。 */
  runBusyId: string | null;
  onCreate: () => void;
  onEdit: (row: ArticleTemplate) => void;
  onRunNow: (row: ArticleTemplate) => void;
  onDelete: (row: ArticleTemplate) => void;
}

/**
 * ② 提示词模板（spec 2026-10-10 · DR-86②）：一句常驻说明 + 新建入口 + 密集表格。
 *
 * # 为什么这一屏比另外两屏薄
 * 模板的重活在**抽屉**里（槽位 chips 插光标处 + 实时预览，见 `ArticleTemplateDrawer`）；
 * 列表只负责"有哪几份、各挂在哪个方向下、什么时候更新过"，加三个行内动作。
 *
 * # 🔴 「立即生成」与排期的「立即运行」是同一条命令（DR-87）
 * `article_schedule_run` 给 `template_id` 就是这一支：不动任何排期的账，产物 `source:'manual'`。
 * 两处按钮因此共用页面层同一个 mutation（转圈状态也共用一个 `runBusyId`）。
 *
 * 纯展示组件：删除确认（连带删排期那句话）在页面层用 `modal.confirm` 出，本组件不直连 IPC。
 */
export default function ArticleTemplatePanel({
  rows,
  loading,
  directionTitleOf,
  runBusyId,
  onCreate,
  onEdit,
  onRunNow,
  onDelete,
}: ArticleTemplatePanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('article.templates.hint')}
      </Typography.Paragraph>
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          {t('article.templates.create')}
        </Button>
      </Space>
      <ArticleTemplateTable
        rows={rows}
        loading={loading}
        directionTitleOf={directionTitleOf}
        busyId={runBusyId}
        onEdit={onEdit}
        onRunNow={onRunNow}
        onDelete={onDelete}
      />
    </>
  );
}
