import { useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import { describeIpcError } from '../api/errors';
import * as insight from '../api/insight';
import type { ActionCategory, ActionItem, FactCheckIssue } from '../api/types';
import { ACTION_CATEGORY_VALUES } from '../api/types';
import ActionTable from '../components/ActionTable';
import PageHeader from '../components/ui/PageHeader';
import AttributionCards from '../components/AttributionCards';
import ContentGenerateModal from '../components/ContentGenerateModal';
import ContentPanel from '../components/ContentPanel';
import EvidenceDrawer from '../components/EvidenceDrawer';
import { enumLabel } from '../i18n/enum-label';

/**
 * M6 GEO 行动中心：处方清单 → 执行跟踪 → 闭环归因 → 内容生产。
 *
 * 四个区块各拆了一个组件，本页只做三件事：取一次 `action_board`、把处方的关联证据
 * 解析成可点的入口、以及托管「生成可交付物」弹窗（处方行与模板区共用同一个实例）。
 *
 * # 关联证据为什么要跨命令查
 * `ActionItem.evidence_issue_ids` 只有 id，点开要看原始回答就得先拿到 `record_id`
 * ⇒ 这里按处方涉及的轮次批量查 `fact_check_list` 建一张 id → 问题 的索引。
 * 🔴 只查、不判：处方与证据对不对得上是种子的自洽纪律（`demo/seed.test.ts`），
 * 页面上查不到就退回显示 id，绝不编一条说明（`components/ActionTable.tsx`）。
 *
 * 🔴 `action.staticNote` 必须显示：处方名次与归因数字都是预置静态值，前端不排序、不重算。
 */
export default function ActionPage() {
  const { id: projectId = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<ActionCategory | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTarget, setGenerateTarget] = useState<ActionItem | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['action-board', projectId],
    queryFn: () => action.actionBoard(projectId),
    enabled: projectId !== '',
  });

  const boardActions = boardQuery.data?.actions;
  // 单独 memo：`?? []` 每次渲染都新建一个数组，会让下面两个 useMemo 的依赖恒变
  // （`react-hooks/exhaustive-deps` 抓的就是这个形状）。
  const allActions = useMemo(() => boardActions ?? [], [boardActions]);
  const actions = useMemo(
    () => (category === null ? allActions : allActions.filter((item) => item.category === category)),
    [allActions, category],
  );

  // 处方涉及的轮次（种子里是基线轮，复测轮不产处方）；去重后各查一次核查问题。
  const roundIds = useMemo(
    () => [...new Set(allActions.map((item) => item.round_id))],
    [allActions],
  );
  const factQueries = useQueries({
    queries: roundIds.map((roundId) => ({
      queryKey: ['fact-check', roundId],
      queryFn: () => insight.factCheckList(roundId),
    })),
  });
  // 不 memo：`factQueries` 每次渲染都是新数组，memo 的依赖判据反而更难写；这张表最多几十条。
  const issueIndex = new Map<string, FactCheckIssue>(
    factQueries.flatMap((query) => (query.data?.issues ?? []).map((issue) => [issue.id, issue])),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['action-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['fact-check'] });
  };

  if (boardQuery.isError) {
    return <Alert type="error" showIcon message={describeIpcError(boardQuery.error, t)} />;
  }

  return (
    <div>
      <PageHeader
        title={t('action.title')}
        description={t('action.subtitle')}
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              {t('common.refresh')}
            </Button>
          </>
        }
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('action.staticNote')}
      </Typography.Paragraph>

      <Card
        size="small"
        title={t('action.list.title')}
        style={{ marginBottom: 12 }}
        extra={
          <Select
            size="small"
            allowClear
            style={{ width: 160 }}
            placeholder={t('common.all')}
            value={category ?? undefined}
            onChange={(value) => setCategory((value ?? null) as ActionCategory | null)}
            options={[...ACTION_CATEGORY_VALUES].map((value) => ({
              value,
              label: enumLabel(t, 'action.categories', value),
            }))}
          />
        }
      >
        <ActionTable
          actions={actions}
          issueIndex={issueIndex}
          onGenerate={(item) => {
            setGenerateTarget(item);
            setGenerateOpen(true);
          }}
          onOpenEvidence={setEvidenceId}
          // M6.5（spec DR-50）：带着处方 id 跳到站点接入页，那边自动打开生成弹窗并预选这条处方。
          onSitePatch={(item) =>
            navigate(`/projects/${projectId}/site?from=${encodeURIComponent(item.id)}`)
          }
        />
      </Card>

      <AttributionCards cards={boardQuery.data?.attribution ?? []} />

      <ContentPanel
        contents={boardQuery.data?.contents ?? []}
        templates={boardQuery.data?.templates ?? []}
        actions={allActions}
        onGenerateFromTemplate={() => {
          // 从模板区进来：不挂处方（`target = null`），弹窗因此列出全部模板。
          setGenerateTarget(null);
          setGenerateOpen(true);
        }}
      />

      <EvidenceDrawer recordId={evidenceId} onClose={() => setEvidenceId(null)} />
      <ContentGenerateModal
        projectId={projectId}
        open={generateOpen}
        target={generateTarget}
        templates={boardQuery.data?.templates ?? []}
        onClose={() => {
          setGenerateOpen(false);
          setGenerateTarget(null);
        }}
        onGenerated={() => refresh()}
      />
    </div>
  );
}
