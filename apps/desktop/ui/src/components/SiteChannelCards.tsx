import { useState } from 'react';
import { Button, Card, Col, Input, Row, Space, Tag, Tooltip, Typography } from 'antd';
import { ApiOutlined, ClearOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { SiteChannel, SiteChannelKind, SiteChannelStatus } from '../api/types';
import { SITE_CHANNEL_KIND_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import CheckDetailText from './CheckDetailText';
import { dateTimeText } from './format';

export interface SiteChannelCardsProps {
  /** 已存在的通道行；缺的 kind 由本组件补一张「未配置」卡（四张卡恒定都在，见下）。 */
  channels: SiteChannel[];
  /** 正在跑写操作的那一条 kind（`null` = 空闲）：只让那一张卡转圈。 */
  busyKind: SiteChannelKind | null;
  onTest: (kind: SiteChannelKind) => void;
  onSave: (
    kind: SiteChannelKind,
    endpoint: string | null,
    username: string | null,
    note: string | null,
  ) => void;
  onClear: (kind: SiteChannelKind) => void;
}

/** 状态标签配色：`ready` 绿、`failed` 红、`pending_verify` 黄、`not_configured` 灰。 */
const STATUS_COLORS: Record<SiteChannelStatus, string> = {
  not_configured: 'default',
  pending_verify: 'gold',
  ready: 'success',
  failed: 'error',
};

/** 只有 WordPress 连接器要填后台用户名（其余三条通道没有"用户名"这个概念）。 */
const NEEDS_USERNAME: readonly SiteChannelKind[] = ['cms'];

/**
 * 哪几条通道要凭据。🔴 真值源在 `demo/handlers/site.ts` 的 `CREDENTIALS_BY_KIND`
 * （组件不许 import demo 侧），这里只用来给**还没有通道行**的那张空卡推一个初始显示值：
 * 一行都不存在时后端无从回答"凭据面是什么状态"，而界面上又必须说清
 * "演示模式不收密码"⇒ 按 kind 静态推导，与后端逐字同形。
 */
const CREDENTIAL_REQUIRED_KINDS: readonly SiteChannelKind[] = ['cms', 'edge'];

/**
 * 站点接入页第 2 块：**四条落地通道**（spec DR-46 / DR-48 / DR-54）。
 *
 * # 🔴 四张卡恒定都在，缺行就补一张「未配置」
 * 通道行是**懒建**的（`site_channel_upsert` / `site_channel_test` 才落一行），
 * 一个刚建好的项目一行都没有。按 `channels` 直接 map 就会渲染出一片空白，
 * 用户看不出"这里本该有四条路"⇒ 一律按 `SITE_CHANNEL_KIND_VALUES` 遍历，缺的补空卡。
 *
 * # 🔴 卡片的 `key` 带 `updated_at`：这是刻意的 remount
 * 三个输入框的值是**本地草稿**，服务端那一行变了（保存 / 自检 / 清除）就要拿新值重新初始化。
 * antd 的受控 `Input` 不会因为 `initialValue` 变了而回写，所以这里让 React 直接换掉整张卡。
 * 代价是"改了半截配置又去点自检"会丢掉那半截——这与后端的语义一致
 * （`site_channel_upsert` 的头注释：改配置 ⇒ 上一次的自检结论作废），不是 bug。
 *
 * # 🔴 凭据面（DR-48 / AGENTS 规则 3）
 * 卡上只有**非敏感**配置（落点地址 / 用户名 / 备注）与一个 `secret_ref` 引用串。
 * 演示模式一个密码都不收，所以 `credentials_state` 恒不为 `stored`，
 * 并且每张需要凭据的卡都常驻 `channels.demoCredentials` 那一句。
 */
export default function SiteChannelCards({
  channels,
  busyKind,
  onTest,
  onSave,
  onClear,
}: SiteChannelCardsProps) {
  const { t } = useTranslation();

  return (
    <Card
      size="small"
      title={t('site.channels.title')}
      style={{ marginBottom: 12 }}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('site.channels.hint')}
        </Typography.Text>
      }
    >
      <Row gutter={[12, 12]}>
        {SITE_CHANNEL_KIND_VALUES.map((kind) => {
          const channel = channels.find((row) => row.kind === kind) ?? null;
          return (
            // 🔴 `updated_at` 进 key：服务端那一行变了就整张卡换掉，让三个输入框拿新值重新初始化
            // （受控 `Input` 不会因为初始值变了而回写，理由见上面的 docblock）。
            <Col key={`${kind}:${channel?.updated_at ?? 'none'}`} xs={24} lg={12}>
              <ChannelCard
                kind={kind}
                channel={channel}
                busy={busyKind === kind}
                onTest={onTest}
                onSave={onSave}
                onClear={onClear}
              />
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}

function ChannelCard({
  kind,
  channel,
  busy,
  onTest,
  onSave,
  onClear,
}: {
  kind: SiteChannelKind;
  channel: SiteChannel | null;
  busy: boolean;
  onTest: (kind: SiteChannelKind) => void;
  onSave: SiteChannelCardsProps['onSave'];
  onClear: (kind: SiteChannelKind) => void;
}) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(channel?.endpoint ?? '');
  const [username, setUsername] = useState(channel?.username ?? '');
  const [note, setNote] = useState(channel?.note ?? '');

  // `bundle` 是唯一零配置的通道：后端把它的 endpoint / username 一律清成 null（DR-46），
  // 所以这张卡不给输入框，只留备注与自检。
  const configurable = kind !== 'bundle';
  const needsUsername = NEEDS_USERNAME.includes(kind);
  const status: SiteChannelStatus = channel?.status ?? 'not_configured';
  const credentials =
    channel?.credentials_state ??
    (CREDENTIAL_REQUIRED_KINDS.includes(kind) ? 'missing' : 'not_required');

  return (
    <Card
      size="small"
      type="inner"
      title={
        <Space size={6}>
          <Tooltip title={enumLabel(t, 'site.channels.about', kind)}>
            <Typography.Text strong>{enumLabel(t, 'site.channelKinds', kind)}</Typography.Text>
          </Tooltip>
          <Tag color={STATUS_COLORS[status]}>{enumLabel(t, 'site.channelStatuses', status)}</Tag>
        </Space>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {enumLabel(t, 'site.credentialsStates', credentials)}
        </Typography.Text>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {configurable ? (
          <Input
            size="small"
            aria-label={t('site.channels.endpoint')}
            placeholder={enumLabel(t, 'site.channels.endpointPlaceholder', kind)}
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        ) : null}
        {needsUsername ? (
          <Input
            size="small"
            aria-label={t('site.channels.username')}
            placeholder={t('site.channels.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        ) : null}
        <Input.TextArea
          rows={1}
          aria-label={t('site.channels.note')}
          placeholder={t('site.channels.note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <Space size={6} wrap>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={busy}
            onClick={() =>
              onSave(
                kind,
                endpoint.trim() === '' ? null : endpoint.trim(),
                username.trim() === '' ? null : username.trim(),
                note.trim() === '' ? null : note.trim(),
              )
            }
          >
            {t('site.channels.save')}
          </Button>
          <Button size="small" icon={<ApiOutlined />} loading={busy} onClick={() => onTest(kind)}>
            {busy ? t('site.channels.testing') : t('site.channels.test')}
          </Button>
          {channel === null ? null : (
            <Button size="small" danger icon={<ClearOutlined />} onClick={() => onClear(kind)}>
              {t('site.channels.clear')}
            </Button>
          )}
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`${t('site.channels.checkedAt')}: `}
          {channel?.checked_at === undefined || channel?.checked_at === null
            ? t('site.channels.neverChecked')
            : dateTimeText(channel.checked_at)}
        </Typography.Text>
        {channel?.check_detail === undefined || channel.check_detail === null ? null : (
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
          >
            {t('site.channels.checkDetail')}: <CheckDetailText detail={channel.check_detail} />
          </Typography.Paragraph>
        )}
        {channel?.secret_ref === undefined || channel.secret_ref === null ? null : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {`${t('site.channels.secretRef')}: `}
            <Typography.Text code style={{ fontSize: 12 }}>
              {channel.secret_ref}
            </Typography.Text>
          </Typography.Paragraph>
        )}
        {credentials === 'not_required' ? null : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('site.channels.demoCredentials')}
          </Typography.Paragraph>
        )}
      </Space>
    </Card>
  );
}
