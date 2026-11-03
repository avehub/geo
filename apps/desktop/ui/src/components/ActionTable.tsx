import { App, Button, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import { describeIpcError } from '../api/errors';
import type { ActionItem, ActionLevel, ActionStatus, FactCheckIssue } from '../api/types';
import DisabledHint from './DisabledHint';
import { dateTimeText, promptsText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** 预期收益 / 实施难度共用的三档配色（收益越高越绿、难度越高越红是两回事，所以只按档位上色）。 */
const LEVEL_COLORS: Record<ActionLevel, string> = { high: 'gold', medium: 'blue', low: 'default' };

const STATUS_COLORS: Record<ActionStatus, string> = {
  todo: 'default',
  in_progress: 'processing',
  done: 'success',
};

/**
 * M6 Top 处方表（`pages/ActionPage.tsx` 的主区块）。
 *
 * # 处方**不是算出来的**
 * 名次、影响范围、依据都是种子端出的静态值（AGENTS 规则 9），本页只翻执行状态
 * （`action_update_status`）——不重排、不新增。
 *
 * # 关联证据要能点到原始回答
 * `ActionItem.evidence_issue_ids` 是核查问题的 id（对用户没有意义），所以页面把这些问题
 * 按 id 建了索引传进来，这里渲染成「字段名 + 打开证据抽屉」。查不到就退回显示 id，
 * **不编**一个说明——处方与证据对不上是产品负责人最该看见的破绽，藏起来反而糟。
 *
 * 长文本（依据 / 负责人 / 可交付物）放在展开行里，主表只留能横向对比的列。
 *
 * # 🔴 「站点补丁」那一列入口（M6.5 · spec DR-50）
 * 落点是**客户自己官网**的处方，光翻状态与生成文稿接不到"官网上真的改了"⇒ 行上多一个入口，
 * 跳到站点接入页并带上 `?from=<action_id>`，那边据此自动打开生成弹窗、预选这条处方。
 * `source_layout` 类（补百科词条、行业媒体稿、B2B 平台报价）**置灰并说明理由**（DR-46）：
 * 它们的落点在站外平台，四条站点通道一条都够不着。置灰而不是隐藏，是因为
 * "为什么这条没有入口"必须能被回答（产品定义 §3.12 把它们明确划在 MVP 之外）。
 */
export default function ActionTable({
  actions,
  issueIndex,
  onGenerate,
  onOpenEvidence,
  onSitePatch,
}: {
  actions: ActionItem[];
  issueIndex: Map<string, FactCheckIssue>;
  onGenerate: (item: ActionItem) => void;
  onOpenEvidence: (recordId: string) => void;
  onSitePatch: (item: ActionItem) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionStatus }) =>
      action.actionUpdateStatus(id, status),
    onSuccess: () => {
      message.success(t('action.list.statusOk'));
      void queryClient.invalidateQueries({ queryKey: ['action-board'] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const quickWins = actions.filter((item) => item.quick_win).length;

  function statusButton(item: ActionItem, status: ActionStatus, label: string) {
    if (item.status === status) return null;
    return (
      <Button
        size="small"
        type="link"
        loading={statusMutation.isPending && statusMutation.variables?.id === item.id}
        onClick={() => statusMutation.mutate({ id: item.id, status })}
      >
        {label}
      </Button>
    );
  }

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('action.list.quickWinSummary', { total: quickWins })}
      </Typography.Paragraph>
      <Table<ActionItem>
        size="small"
        rowKey="id"
        tableLayout="fixed"
        scroll={{ x: 1200 }}
        pagination={false}
        dataSource={actions}
        locale={{ emptyText: t('action.list.empty') }}
        expandable={{
          expandedRowRender: (item) => (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.list.rationale')}: `}
                </Typography.Text>
                <Typography.Text>{item.rationale}</Typography.Text>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.list.owner')}: `}
                </Typography.Text>
                <Typography.Text>{item.owner_hint}</Typography.Text>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.list.deliverable')}: `}
                </Typography.Text>
                <Typography.Text>{item.deliverable}</Typography.Text>
              </div>
              <Space size={4} wrap>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.list.affectedEngines')}:`}
                </Typography.Text>
                {item.affected_engines.map((engine) => (
                  <Tag key={engine}>{enumLabel(t, 'collection.engines', engine)}</Tag>
                ))}
              </Space>
              <Space size={4} wrap>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.list.evidence')}:`}
                </Typography.Text>
                {item.evidence_issue_ids.length === 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('action.list.noEvidence')}
                  </Typography.Text>
                )}
                {item.evidence_issue_ids.map((issueId) => {
                  const issue = issueIndex.get(issueId);
                  return issue === undefined ? (
                    <Tag key={issueId}>{issueId}</Tag>
                  ) : (
                    <Button
                      key={issueId}
                      size="small"
                      type="link"
                      onClick={() => onOpenEvidence(issue.record_id)}
                    >
                      {enumLabel(t, 'entity.fields', issue.field_path)}
                    </Button>
                  );
                })}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`${t('action.list.updatedAt')}: ${dateTimeText(item.updated_at)}`}
                {item.completed_at === null
                  ? ''
                  : ` · ${t('action.list.completedAt')}: ${dateTimeText(item.completed_at)}`}
              </Typography.Text>
            </Space>
          ),
        }}
        columns={[
          { title: t('action.list.rank'), dataIndex: 'rank', width: 64 },
          {
            title: t('action.list.actionTitle'),
            dataIndex: 'title',
            width: 300,
            render: (value: string, item) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                  {value}
                </Typography.Text>
                {item.quick_win ? (
                  <Tag color="green" style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                    {t('action.list.quickWin')}
                  </Tag>
                ) : null}
              </div>
            ),
          },
          {
            title: t('action.list.category'),
            dataIndex: 'category',
            width: 110,
            render: (value: string) => enumLabel(t, 'action.categories', value),
          },
          {
            title: t('action.list.impact'),
            dataIndex: 'impact',
            width: 90,
            render: (value: ActionLevel) => (
              <Tag color={LEVEL_COLORS[value]}>{enumLabel(t, 'action.levels', value)}</Tag>
            ),
          },
          {
            title: t('action.list.difficulty'),
            dataIndex: 'difficulty',
            width: 90,
            render: (value: ActionLevel) => (
              <Tag color={LEVEL_COLORS[value]}>{enumLabel(t, 'action.levels', value)}</Tag>
            ),
          },
          {
            title: t('action.list.affectedPrompts'),
            dataIndex: 'affected_prompt_count',
            width: 120,
            render: (value: number) => promptsText(t, value),
          },
          {
            title: t('action.list.status'),
            dataIndex: 'status',
            width: 100,
            render: (value: ActionStatus) => (
              <Tag color={STATUS_COLORS[value]}>{enumLabel(t, 'action.statuses', value)}</Tag>
            ),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 360,
            render: (_, item) => (
              <Space size={4} wrap>
                {statusButton(item, 'done', t('action.list.markDone'))}
                {statusButton(item, 'in_progress', t('action.list.markInProgress'))}
                {statusButton(item, 'todo', t('action.list.markTodo'))}
                <Button size="small" type="link" onClick={() => onGenerate(item)}>
                  {t('action.list.generate')}
                </Button>
                {/* 🔴 置灰理由复用 `site.generate.sourceLayout`：同一句话不在两个 namespace
                    各存一份（那正是 `entity.contentStatuses` 那个缺陷类的形状），
                    而这句话合规敏感——两处措辞一旦漂移，行上的理由与弹窗里的理由就会互相矛盾。 */}
                <DisabledHint
                  hint={
                    item.category === 'source_layout' ? t('site.generate.sourceLayout') : null
                  }
                >
                  <Button
                    size="small"
                    type="link"
                    disabled={item.category === 'source_layout'}
                    onClick={() => onSitePatch(item)}
                  >
                    {t('action.list.sitePatch')}
                  </Button>
                </DisabledHint>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
