import { useState } from 'react';
import { Button, Drawer, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { ApiOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { catalogEntryOf, searchSecretRef } from '../api/search-catalog';
import type { SearchBindingField, SearchIngestMode, SearchSource } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import CheckDetailText from './CheckDetailText';
import { dateTimeText } from './format';

export interface SearchSourceDrawerProps {
  source: SearchSource;
  /** 这个源正在写（保存 / 自检 / 移除共用一个开关，照 `SitePage` 的 `busyKind`）。 */
  busy: boolean;
  onClose: () => void;
  onSave: (binding: Partial<Record<SearchBindingField, string>>, note: string | null) => void;
  onTest: () => void;
  onRemove: () => void;
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
}: SearchSourceDrawerProps) {
  const { t } = useTranslation();
  const entry = catalogEntryOf(source.kind);
  const [binding, setBinding] = useState<Partial<Record<SearchBindingField, string>>>(
    source.binding,
  );
  const [note, setNote] = useState(source.note ?? '');

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
              {t('webmasterData.sourceCards.demoCredentials')}
            </Typography.Paragraph>
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
