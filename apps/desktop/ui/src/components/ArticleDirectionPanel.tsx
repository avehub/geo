import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ArticleDirection } from '../api/types';
import ArticleDirectionCards from './ArticleDirectionCards';

export interface ArticleDirectionPanelProps {
  rows: ArticleDirection[];
  loading: boolean;
  /** 方向 id → 挂在它下面的模板数 / 累计产出的文章数（卡片脚注，survey §4B）。 */
  templateCounts: Record<string, number>;
  articleCounts: Record<string, number>;
  busyId: string | null;
  generating: boolean;
  onAdd: () => void;
  onGenerate: () => void;
  onToggleStatus: (row: ArticleDirection) => void;
}

/**
 * ① 方向与策略（spec 2026-10-10 · DR-86①）：两个入口 + 一句常驻说明 + 卡片列表。
 *
 * # 🔴 「AI 生成方向」那句说明常驻（DR-85 / AGENTS 规则 9）
 * 演示模式不调模型：生成出来的方向逐字取自预置语料池、按标题去重。不写清楚，
 * 产品负责人会把"接了大模型"当成本轮已落地的能力评审。池子取空时 handler 回**空数组**，
 * 页面层据此提示"预置语料已经用完"——不假装生成成功。
 *
 * # 🔴 归档不是删除
 * 卡片**不按状态过滤**：已归档的那张留在原位、挂状态标签，按钮换成「恢复」
 * （理由写在 `ArticleDirectionCards` 的头注释里）。
 *
 * 纯展示组件：写路径全在页面层，本组件不直连 IPC。
 */
export default function ArticleDirectionPanel({
  rows,
  loading,
  templateCounts,
  articleCounts,
  busyId,
  generating,
  onAdd,
  onGenerate,
  onToggleStatus,
}: ArticleDirectionPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('article.directions.hint')}
      </Typography.Paragraph>
      <Space wrap size={8} style={{ marginBottom: 8 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
          {t('article.directions.add')}
        </Button>
        <Button icon={<RobotOutlined />} loading={generating} onClick={onGenerate}>
          {t('article.directions.generate')}
        </Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('article.directions.generateDemoBody')}
      </Typography.Paragraph>
      <ArticleDirectionCards
        rows={rows}
        loading={loading}
        templateCounts={templateCounts}
        articleCounts={articleCounts}
        busyId={busyId}
        onToggleStatus={onToggleStatus}
      />
    </>
  );
}
