/**
 * 「引擎接入」弹窗（2026-11-20）。
 *
 * # 为什么存在
 * 用户报障：采集页的豆包任务失败，原因写着「需要登录」，但页面上没有任何补 Key 或扫码的入口。
 * 后端的真实要求是——每个引擎要先在系统钥匙串里有一把对应服务商的 API Key
 * （元宝除外，它走浏览器扫码登录）。这张弹窗把这些要求逐引擎摆出来，并且**就地**给出
 * `SecretStatusPanel`（复用既有 `secret_*` 命令，不新增命令面），用户不必再去设置页
 * 切换「当前模型服务商」才能给某个采集引擎配 Key。
 *
 * # 🔴 只做「接入」，不改采集口径
 * - Key 仍只写系统钥匙串（AGENTS 规则 3）：这里没有任何本地缓存，读写都走 `secret_*`；
 * - 元宝只解释真实流程（受控 Chrome + 用户自己扫码，`services/browser.rs`），
 *   不代登录、不绕验证码（规则 11）；
 * - 状态只来自 `secret_status`（`exists`，不解密、不触发钥匙串授权框）。
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Collapse, Modal, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { availableEngines } from '../api/build-flavor';
import { ENGINE_ACCESS, engineAccessState, type EngineAccessState } from '../api/engine-access';
import type { EngineId } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import SecretStatusPanel from './SecretStatus';
import type { EngineAccessStatus } from './use-engine-access';

function StateTag({ state }: { state: EngineAccessState }) {
  const { t } = useTranslation();
  switch (state) {
    case 'ready':
      return <Tag color="success">{t('collection.access.ready')}</Tag>;
    case 'needs_setup':
      return <Tag color="warning">{t('collection.access.needsSetup')}</Tag>;
    case 'browser_login':
      return <Tag color="processing">{t('collection.access.browserLogin')}</Tag>;
    case 'unknown':
      return <Tag>{t('collection.access.unknown')}</Tag>;
  }
}

export default function EngineAccessModal({
  open,
  onClose,
  focusEngine = null,
  status,
}: {
  open: boolean;
  onClose: () => void;
  /** 从某条失败任务 / 提示卡点进来时，直接展开那个引擎。 */
  focusEngine?: EngineId | null;
  status: EngineAccessStatus;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t('collection.access.title')}
      onCancel={onClose}
      width={680}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          {t('common.close')}
        </Button>,
      ]}
    >
      {/*
        `key` 让每次打开 / 换焦点都重挂载 Body ⇒ 展开项直接取 `focusEngine` 作初值，
        不用 effect 里 setState（`react-hooks/set-state-in-effect` 会报级联渲染）。
      */}
      <AccessBody
        key={`${open ? 'open' : 'closed'}:${focusEngine ?? 'none'}`}
        focusEngine={focusEngine}
        status={status}
        onClose={onClose}
      />
    </Modal>
  );
}

function AccessBody({
  focusEngine,
  status,
  onClose,
}: {
  focusEngine: EngineId | null;
  status: EngineAccessStatus;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // 构建形态门禁（B8）：Store 版不含元宝通道，这里也不展示它。
  const engines = useMemo(() => [...availableEngines()], []);
  const [active, setActive] = useState<string | null>(focusEngine);

  const items = engines.map((engine) => {
    const spec = ENGINE_ACCESS[engine];
    const state = engineAccessState(engine, (provider) => status.byProvider[provider], {
      currentModelProvider: status.currentModelProvider,
    });
    return {
      key: engine,
      label: (
        <Space size={8} wrap>
          <span>{enumLabel(t, 'collection.engines', engine)}</span>
          <StateTag state={state} />
        </Space>
      ),
      children: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t(spec.noteKey)}
          </Typography.Paragraph>
          {spec.kind === 'api_key' &&
            spec.providers.map((provider) => (
              <SecretStatusPanel key={provider} provider={provider} allowTest={provider !== 'metaso'} />
            ))}
          {spec.kind === 'browser_login' && (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('collection.access.yuanbaoSteps')}
            </Typography.Paragraph>
          )}
          {/* 秘塔还要当前对话模型的 Key，那条属于「模型服务商」段，给一个直达入口。 */}
          {engine === 'metaso' && (
            <Link to="/settings/models" onClick={onClose}>
              {t('collection.access.openSettings')}
            </Link>
          )}
        </Space>
      ),
    };
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={t('collection.access.intro')} />
      {status.error && (
        <Alert type="warning" showIcon message={t('settings.secret.readFailed')} />
      )}
      <Collapse
        accordion
        activeKey={active ?? undefined}
        onChange={(key) => setActive(typeof key === 'string' ? key : null)}
        items={items}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {t('collection.access.settingsHint')}
      </Typography.Paragraph>
    </Space>
  );
}
