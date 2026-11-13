import { useState } from 'react';
import { BROWSER_ONLY_SOURCE_KINDS, isStoreBuild } from '../api/build-flavor';
import { App, Button, Drawer, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { ApiOutlined, DeleteOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import { runtime } from '../api/runtime';
import {
  catalogEntryOf,
  searchSecretRef,
} from '../api/search-catalog';
import type { SearchBindingField, SearchIngestMode, SearchSource } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import CheckDetailText from './CheckDetailText';
import SecretStatusPanel from './SecretStatus';
import { dateTimeText } from './format';

export interface SearchSourceDrawerProps {
  source: SearchSource;
  /** 这个源正在写（保存 / 自检 / 移除共用一个开关，照 `SitePage` 的 `busyKind`）。 */
  busy: boolean;
  onClose: () => void;
  onSave: (binding: Partial<Record<SearchBindingField, string>>, note: string | null) => void;
  onTest: () => void;
  onRemove: () => void;
  /** `search_board.as_of`：取数区间只从页面锚点推导，不取系统今天。 */
  asOf: string;
}

/** 状态标签配色：与站点通道同一套（DR-94 复用 `SiteChannelStatus`，配色也一并复用）。 */
const STATUS_COLORS: Record<SearchSource['status'], string> = {
  not_configured: 'default',
  pending_verify: 'gold',
  ready: 'success',
  failed: 'error',
};

/**
 * 一个数据源的配置侧滑（spec `2026-10-12-webmaster-data-integration-design.md` §5.3 第 1 段，
 * DR-93 / DR-96 / DR-108，走查 2 / 3）。
 *
 * # 🔴 这个源支持什么，一律**查目录表**（DR-108：加一个源只加数据、不改页面）
 * 凭据形态、取数形态、绑定字段、口径说明、后台入口全在 `api/search-catalog.ts` 的那一行里。
 * 本组件一个 `if (kind === 'gsc')` 都不写——二期把 `phase` 改成 1，这里零改动。
 *
 * # 🔴 未开放 OAuth 的源**看不到** OAuth 那一档（走查 3）
 * `auth_mode` 只渲染它自己那一档，另一档**不置灰、根本不渲染**：渲染一个点不动的选项，
 * 用户只会以为是自己配错了（与二期源不渲染入口是同一个姿态，DR-92 / DR-93）。
 *
 * # 🔴 这里不收任何凭据（DR-96 / AGENTS 规则 3）
 * 表单里只有**非敏感**的站点绑定（站点地址 / 站点 ID）与备注；凭据那一栏只展示
 * `keyring://search/<kind>` 这个**引用串**，并常驻 `sourceCards.demoCredentials`
 * 说清"演示模式不收密码与令牌"。
 */
export default function SearchSourceDrawer({
  source,
  busy,
  onClose,
  onSave,
  onTest,
  onRemove,
  asOf,
}: SearchSourceDrawerProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const entry = catalogEntryOf(source.kind);
  const [binding, setBinding] = useState<Partial<Record<SearchBindingField, string>>>(
    source.binding,
  );
  const [note, setNote] = useState(source.note ?? '');
  /** 系统 Chrome 的 CDP 地址：只在本次抽屉会话里保存，不落库、不进 URL。 */
  const [browserWsUrl, setBrowserWsUrl] = useState<string | null>(null);
  const browserAssist =
    runtime === 'tauri' &&
    (source.kind === 'baidu_ziyuan' || source.kind === 'baidu_ziyuan_ai');
  /** 近 28 天：`period_end = asOf`、`period_start = asOf - 27 天`。 */
  const browserStart = dayjs(asOf).subtract(27, 'day').format('YYYY-MM-DD');

  const oauthMutation = useMutation({
    mutationFn: () => client.searchOauthBegin(source.project_id, source.kind),
    onSuccess: async (start) => {
      try {
        await openUrl(start.auth_url);
      } catch (error) {
        message.error(describeIpcError(error, t));
        return;
      }
      message.success(t('webmasterData.sourceCards.oauthStarted'));
      // 授权在系统浏览器里完成；2 秒后拉一次 board，把 token 落库后的状态带回来。
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['search-board', source.project_id] });
      }, 2000);
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const browserOpenMutation = useMutation({
    mutationFn: () => client.searchBrowserOpen(source.project_id, source.kind),
    onSuccess: (session) => {
      setBrowserWsUrl(session.ws_url);
      message.success(t('webmasterData.sourceCards.browserOpened'));
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const browserCaptureMutation = useMutation({
    mutationFn: (wsUrl: string) =>
      client.searchBrowserCapture(source.project_id, source.kind, wsUrl, browserStart, asOf),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['search-board', source.project_id] });
      message.success(
        t('webmasterData.sourceCards.browserImported', {
          metrics: result.metrics.length,
          overviews: result.ai_overviews.length,
        }),
      );
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  function setField(field: SearchBindingField, value: string) {
    setBinding((previous) => ({ ...previous, [field]: value }));
  }

  return (
    <Drawer
      open
      width={520}
      title={t('webmasterData.sourceCards.drawerTitle')}
      onClose={onClose}
      footer={
        <Space size={6} wrap>
          {/* 🔴 只有 GSC 走 OAuth：Bing 的 OAuth 控制台不接受 loopback 回调地址
              （`http://localhost:…` 会被判“不是有效的 http 或 https url”），
              所以 Bing 统一走官方 API Key，不给一个走不通的授权按钮。 */}
          {runtime === 'tauri' && source.auth_mode === 'oauth' && source.kind === 'gsc' ? (
            <Button
              size="small"
              icon={<LinkOutlined />}
              loading={oauthMutation.isPending}
              onClick={() => oauthMutation.mutate()}
            >
              {t('webmasterData.sourceCards.oauthStart')}
            </Button>
          ) : null}
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            loading={busy}
            onClick={() =>
              onSave(
                Object.fromEntries(
                  Object.entries(binding).filter(([, value]) => value !== undefined && value !== ''),
                ),
                note.trim() === '' ? null : note.trim(),
              )
            }
          >
            {t('common.save')}
          </Button>
          <Button size="small" icon={<ApiOutlined />} loading={busy} onClick={onTest}>
            {busy ? t('webmasterData.sourceCards.testing') : t('webmasterData.sourceCards.test')}
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} loading={busy} onClick={onRemove}>
            {t('webmasterData.sourceCards.remove')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Typography.Text strong>{enumLabel(t, 'webmasterData.sources', source.kind)}</Typography.Text>
          <Tag color={STATUS_COLORS[source.status]}>
            {enumLabel(t, 'site.channelStatuses', source.status)}
          </Tag>
          <Tag>{enumLabel(t, 'site.credentialsStates', source.credentials_state)}</Tag>
        </Space>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t(`webmasterData.sourceHints.${source.kind}`, { nsSeparator: false })}
        </Typography.Paragraph>
        {/* 口径说明常驻（DR-95）：分母不同的比率绝不跨平台平均，这句话得在配置时就看得见。 */}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t(entry.metric_notes_key, { nsSeparator: false })}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t(`webmasterData.howToExport.${source.kind}`, { nsSeparator: false })}
        </Typography.Paragraph>

        <Space size={4} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.sourceCards.authModeLabel')}
          </Typography.Text>
          <Tag>{enumLabel(t, 'webmasterData.authModes', source.auth_mode)}</Tag>
        </Space>
        <Space size={4} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.sourceCards.ingestModesLabel')}
          </Typography.Text>
          {entry.ingest_modes.map((mode: SearchIngestMode) => (
            <Tooltip key={mode} title={t(`webmasterData.ingestModeNotes.${mode}`, { nsSeparator: false })}>
              <Tag>{enumLabel(t, 'webmasterData.ingestModes', mode)}</Tag>
            </Tooltip>
          ))}
        </Space>

        {entry.binding_fields.map((field) => {
          const label = t(`webmasterData.sourceCards.${field}`, { nsSeparator: false });
          return (
            <div key={field}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {label}
              </Typography.Text>
              <Input
                size="small"
                aria-label={label}
                value={binding[field] ?? ''}
                onChange={(event) => setField(field, event.target.value)}
              />
            </div>
          );
        })}
        {entry.binding_fields.length === 0 ? null : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('webmasterData.sourceCards.bindingHint')}
          </Typography.Paragraph>
        )}

        {browserAssist ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('webmasterData.sourceCards.browserHint')}
            </Typography.Text>
            <Space size={6} wrap>
              {/* 2026-11-13 裁定 B8：Store 版不含浏览器取数通道，入口隐藏 */}
              {!(isStoreBuild() && BROWSER_ONLY_SOURCE_KINDS.includes(source.kind)) && (
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  aria-label={t('webmasterData.sourceCards.browserOpen')}
                  loading={browserOpenMutation.isPending}
                  onClick={() => browserOpenMutation.mutate()}
                >
                  {t('webmasterData.sourceCards.browserOpen')}
                </Button>
              )}
              <Button
                size="small"
                icon={<ApiOutlined />}
                aria-label={t('webmasterData.sourceCards.browserCapture')}
                loading={browserCaptureMutation.isPending}
                disabled={browserWsUrl === null}
                onClick={() => {
                  if (browserWsUrl !== null) browserCaptureMutation.mutate(browserWsUrl);
                }}
              >
                {t('webmasterData.sourceCards.browserCapture')}
              </Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              {t('webmasterData.sourceCards.browserWindow', { start: browserStart, end: asOf })}
            </Typography.Paragraph>
            {browserWsUrl === null ? (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {t('webmasterData.sourceCards.browserConnectFirst')}
              </Typography.Paragraph>
            ) : null}
          </Space>
        ) : null}

        <Input.TextArea
          rows={2}
          aria-label={t('common.noteOptional')}
          placeholder={t('common.noteOptional')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`${t('webmasterData.sourceCards.dataThrough')}: `}
          {source.data_through === null
            ? t('webmasterData.sourceCards.neverImported')
            : source.data_through}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`${t('webmasterData.sourceCards.checkedAt')}: `}
          {source.checked_at === null
            ? t('webmasterData.sourceCards.neverChecked')
            : dateTimeText(source.checked_at)}
        </Typography.Text>
        {source.check_detail === null ? null : (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('webmasterData.sourceCards.checkDetail')}: <CheckDetailText detail={source.check_detail} />
          </Typography.Paragraph>
        )}

        {source.auth_mode === 'oauth' ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {`${t('webmasterData.sourceCards.secretRef')}: `}
              <Typography.Text code style={{ fontSize: 12 }}>
                {source.secret_ref ?? searchSecretRef(source.kind)}
              </Typography.Text>
            </Typography.Text>
            {/* 🔴 常驻（AGENTS 规则 3）：演示模式一个密码与令牌都不收。 */}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              {t(
                runtime === 'demo'
                  ? 'webmasterData.sourceCards.demoCredentials'
                  : 'webmasterData.sourceCards.liveCredentials',
              )}
            </Typography.Paragraph>
            {runtime === 'tauri' && source.kind === 'gsc' ? (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('webmasterData.sourceCards.googleClientSecret')}
                </Typography.Text>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                  {t('webmasterData.sourceCards.googleClientSecretHint')}
                </Typography.Paragraph>
                <SecretStatusPanel provider="google_oauth" allowTest={false} />
              </Space>
            ) : null}
            {runtime === 'tauri' && source.kind === 'bing_wmt' ? (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('webmasterData.sourceCards.bingApiKey')}
                </Typography.Text>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                  {t('webmasterData.sourceCards.bingApiKeyHint')}
                </Typography.Paragraph>
                <SecretStatusPanel provider="bing_wmt" allowTest={false} />
              </Space>
            ) : null}
          </Space>
        ) : null}

        {/* 官方文档 / 后台入口：目录表里那一条 `docs_url`，界面上作为可点出处（DR-105）。 */}
        {entry.docs_url === null ? null : (
          <Typography.Link
            href={entry.docs_url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12 }}
          >
            {enumLabel(t, 'webmasterData.sources', source.kind)}
          </Typography.Link>
        )}
      </Space>
    </Drawer>
  );
}
