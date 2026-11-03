import { Button, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type {
  ContentStatus,
  SitePatch,
  SitePatchStatus,
  SitePatchTransition,
} from '../api/types';
import { CONTENT_STATUS_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';
import DisabledHint from './DisabledHint';

export interface SitePatchTableProps {
  rows: SitePatch[];
  loading?: boolean;
  /** 批量选择的 key（页面层持有：批量删除吃这份选择）。 */
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  /** 处方 id → 处方标题（页面从 `action_board` 建的索引）：展开行里要说人话，不是露 id。 */
  actionTitles: Map<string, string>;
  /**
   * 正在跑的那一个 `(补丁, 动作)`：只让**被点的那个按钮**转圈。
   * 🔴 不能只记 id——一行上有发布 / 撤回 / 回滚三个动作，只记 id 会让三个一起转，
   * 看不出刚才点的是哪一个（`ActionTable` 的 `statusMutation.variables?.id` 是同一个取舍）。
   */
  busyAction: { id: string; transition: SitePatchTransition } | null;
  onEdit: (row: SitePatch) => void;
  /** 就地翻人工审核态（发布的前置闸门，见 `canPublish`）。 */
  onReviewChange: (row: SitePatch, status: ContentStatus) => void;
  onTransition: (row: SitePatch, transition: SitePatchTransition) => void;
  onHistory: (row: SitePatch) => void;
  onDelete: (row: SitePatch) => void;
  onOpenAction: (actionId: string) => void;
}

const STATUS_COLORS: Record<SitePatchStatus, string> = {
  draft: 'default',
  published: 'success',
  unpublished: 'warning',
};

/**
 * 草案与线上快照是否分叉（spec DR-47）。
 *
 * 🔴 这一条同时是**回滚的前置条件**：`rollback` 做的事就是把 `body` 恢复成 `published_body`，
 * 两者逐字相同时回滚是个空动作（后端也因此原样返回、不记事件）。
 * `published_body === null` = 从没发布过 ⇒ 既没有"线上"可比，也没有回滚的落点。
 */
function hasPendingChange(patch: SitePatch): boolean {
  if (patch.published_body === null) return false;
  return (
    patch.body !== patch.published_body ||
    (patch.published_kind != null && patch.kind !== patch.published_kind) ||
    (patch.published_target_url != null && patch.target_url !== patch.published_target_url) ||
    (patch.published_channel_kind != null && patch.channel_kind !== patch.published_channel_kind)
  );
}

/**
 * 能不能发布。🔴 闸门是**人工审核态**（AGENTS 规则 6 / handler 同形）：
 * AI 生成的补丁草案默认 `pending_review`，把没人看过的草案"发到官网上"正是 GEO 场景里
 * 最容易翻车的一类错误 ⇒ 界面先把按钮置灰并说明，而不是等后端 reject 再弹错误。
 */
function canPublish(patch: SitePatch): boolean {
  return patch.review_status === 'approved';
}

/** 能不能撤回：只有**正在生效**的那一条才需要撤回（已撤回 / 从未发布都没有线上版本）。 */
function canUnpublish(patch: SitePatch): boolean {
  return patch.status === 'published';
}

/**
 * 能不能删。🔴 已发布的补丁必须先撤回：删掉等于一次没有 `unpublished` 事件的隐式撤回，
 * "谁在什么时候把什么改上线了"这本账会直接断掉（handler 同样拒删）。
 */
function canDelete(patch: SitePatch): boolean {
  return patch.status !== 'published';
}

/**
 * 站点接入页第 3 块：**补丁工作台**的台账表（spec DR-47 / DR-50 / DR-54）。
 *
 * # 一行 = 站点上的一处改动
 * 主表只留能横向对比的列（落点 / 类型 / 状态 / 通道 / 审核态 / 发布时间），
 * **草案正文与"贴在哪"放展开行**：正文动辄几十行 HTML，摊在主表里就没法比对状态了。
 *
 * # 🔴 三个动作的置灰理由都在界面上说清（DR-46 / DR-47）
 * `publish` 要人工审核通过、`unpublish` 要真的在生效、`rollback` 要有可回的快照。
 * 后端这三个动作都是**全函数**（不存在"非法跃迁"错误码），所以判据只能长在界面上——
 * 而"点不动又不说为什么"是最糟的一种界面，故一律经 `DisabledHint` 挂 tooltip。
 *
 * # 🔴 展开行里刻意**没有**"最近事件"
 * `site_patch_history` 是**按补丁**查的（没有批量口径），给一张 8 行的表配 8 次查询
 * 换来一个折叠起来看不见的信息，不值。历史在行内那个「历史」按钮里一次看全。
 *
 * # 标签一律查词典
 * 类型 / 状态 / 通道 → `site.*`；审核态**复用** `action.contentStatuses`（DR-51：
 * 再造一套同形枚举就是 `entity.contentStatuses` 那个已被收掉的缺陷类）。
 */
export default function SitePatchTable({
  rows,
  loading = false,
  selectedRowKeys,
  onSelectionChange,
  actionTitles,
  busyAction,
  onEdit,
  onReviewChange,
  onTransition,
  onHistory,
  onDelete,
  onOpenAction,
}: SitePatchTableProps) {
  const { t } = useTranslation();

  function actionButton(
    patch: SitePatch,
    transition: SitePatchTransition,
    label: string,
    enabled: boolean,
    hint: string,
  ) {
    return (
      <DisabledHint hint={enabled ? null : hint}>
        <Button
          size="small"
          type="link"
          disabled={!enabled}
          loading={busyAction !== null && busyAction.id === patch.id && busyAction.transition === transition}
          onClick={() => onTransition(patch, transition)}
        >
          {label}
        </Button>
      </DisabledHint>
    );
  }

  const columns: ColumnsType<SitePatch> = [
    {
      title: '#',
      dataIndex: 'position',
      key: 'position',
      width: 52,
      render: (_, row) => <Typography.Text type="secondary">{row.position + 1}</Typography.Text>,
    },
    {
      title: t('site.patches.columns.title'),
      dataIndex: 'title',
      key: 'title',
      width: 280,
      render: (_, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Typography.Text
            strong
            ellipsis
            style={{ flex: 1, minWidth: 0, fontSize: 13 }}
          >
            {row.title}
          </Typography.Text>
          {hasPendingChange(row) ? (
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              {t('site.patches.pendingChange')}
            </Tag>
          ) : row.status === 'published' ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {t('site.patches.noPendingChange')}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: t('site.patches.columns.target'),
      dataIndex: 'target_url',
      key: 'target_url',
      width: 230,
      render: (_, row) => (
        <Typography.Text
          style={{ fontSize: 12, maxWidth: '100%' }}
          ellipsis={{ tooltip: row.target_url }}
          copyable={{ text: row.target_url }}
        >
          {row.target_url}
        </Typography.Text>
      ),
    },
    {
      title: t('site.patches.columns.kind'),
      dataIndex: 'kind',
      key: 'kind',
      width: 168,
      render: (_, row) => <Tag>{enumLabel(t, 'site.patchKinds', row.kind)}</Tag>,
    },
    {
      title: t('site.patches.columns.status'),
      dataIndex: 'status',
      key: 'status',
      width: 104,
      render: (_, row) => (
        <Tag color={STATUS_COLORS[row.status]}>{enumLabel(t, 'site.patchStatuses', row.status)}</Tag>
      ),
    },
    {
      title: t('site.patches.columns.channel'),
      dataIndex: 'channel_kind',
      key: 'channel_kind',
      width: 150,
      render: (_, row) => (
        <Tag color={row.channel_kind === 'bundle' ? 'blue' : undefined}>
          {enumLabel(t, 'site.channelKinds', row.channel_kind)}
        </Tag>
      ),
    },
    {
      title: t('site.patches.columns.review'),
      dataIndex: 'review_status',
      key: 'review_status',
      width: 140,
      render: (_, row) => (
        <Select
          size="small"
          variant="borderless"
          aria-label={t('site.patches.columns.review')}
          value={row.review_status}
          style={{ width: 128 }}
          onChange={(status: ContentStatus) => onReviewChange(row, status)}
          options={CONTENT_STATUS_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'action.contentStatuses', value),
          }))}
        />
      ),
    },
    {
      title: t('site.patches.columns.publishedAt'),
      dataIndex: 'published_at',
      key: 'published_at',
      width: 148,
      render: (_, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {row.published_at === null
            ? t('site.patches.columns.neverPublished')
            : dateTimeText(row.published_at)}
        </Typography.Text>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 360,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0} wrap>
          <Button
            size="small"
            type="link"
            aria-label={t('site.patches.actions.edit')}
            onClick={() => onEdit(row)}
          >
            {t('site.patches.actions.edit')}
          </Button>
          {actionButton(
            row,
            'publish',
            t('site.patches.actions.publish'),
            canPublish(row),
            t('site.patches.publishBlocked'),
          )}
          {actionButton(
            row,
            'unpublish',
            t('site.patches.actions.unpublish'),
            canUnpublish(row),
            t('site.patches.unpublishDisabled'),
          )}
          {actionButton(
            row,
            'rollback',
            t('site.patches.actions.rollback'),
            hasPendingChange(row),
            t('site.patches.rollbackDisabled'),
          )}
          <Button
            size="small"
            type="link"
            onClick={() => onHistory(row)}
          >
            {t('site.patches.actions.history')}
          </Button>
          <DisabledHint hint={canDelete(row) ? null : t('site.patches.deleteBlocked')}>
            <Button
              size="small"
              type="link"
              danger
              disabled={!canDelete(row)}
              aria-label={t('site.patches.actions.delete')}
              onClick={() => onDelete(row)}
            >
              {t('site.patches.actions.delete')}
            </Button>
          </DisabledHint>
        </Space>
      ),
    },
  ];

  return (
    <Table<SitePatch>
      size="small"
      rowKey="id"
      tableLayout="fixed"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 1724 }}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
        // 已发布的行不能进批量删除：handler 会整批拒绝，界面上先不给勾。
        getCheckboxProps: (row) => ({ disabled: !canDelete(row) }),
      }}
      locale={{ emptyText: t('site.patches.empty') }}
      expandable={{
        expandedRowRender: (row) => (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`${t('site.patches.columns.action')}: `}
              </Typography.Text>
              {row.action_id === null ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('site.patches.columns.noAction')}
                </Typography.Text>
              ) : (
                <Button
                  size="small"
                  type="link"
                  style={{ paddingInline: 0 }}
                  onClick={() => onOpenAction(row.action_id as string)}
                >
                  {actionTitles.get(row.action_id) ?? row.action_id}
                </Button>
              )}
            </div>
            {row.target_hint === null ? null : (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('site.editor.targetHint')}: `}
                </Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>{row.target_hint}</Typography.Text>
              </div>
            )}
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`${t('site.editor.body')}: `}
              </Typography.Text>
              {/* 🔴 用 <pre> 而不是 dangerouslySetInnerHTML：正文是要贴到客户官网上的 HTML，
                  在这里渲染成真 DOM 等于把种子数据当页面执行（i18n/index.ts 的 R-I 同一条纪律）。 */}
              <pre
                style={{
                  margin: '4px 0 0',
                  padding: 8,
                  maxHeight: 260,
                  overflow: 'auto',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {row.body}
              </pre>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {`${t('site.patches.columns.updatedAt')}: ${dateTimeText(row.updated_at)}`}
            </Typography.Text>
          </Space>
        ),
      }}
    />
  );
}
