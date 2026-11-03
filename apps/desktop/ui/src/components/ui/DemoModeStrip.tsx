import { Button, Popover, theme } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { runtime } from '../../api/runtime';

/**
 * 演示模式细条（2026-10-30 二稿）。
 *
 * 一稿是蓝底信息条，在每页顶部像一条常驻告警；企业风里「演示模式」属于环境事实，
 * 应该像构建号一样安静。二稿改为**灰底 + 小 DEMO 徽标**，文字走次级色，
 * 帮助入口收成一个图标。合规句仍然一字不减、仍然常驻。
 *
 * ⚠ 不写 Tailwind 工具类（`components/**` 在 oxide 扫描面里），排版用内联样式。
 */
export default function DemoModeStrip() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  if (runtime !== 'demo') return null;

  return (
    <div
      role="note"
      style={{
        height: 32,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        paddingInline: 16,
        background: token.colorFillQuaternary,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        color: token.colorTextSecondary,
        fontSize: 12,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 18,
          paddingInline: 6,
          borderRadius: 4,
          border: `1px solid ${token.colorBorder}`,
          color: token.colorTextTertiary,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          flexShrink: 0,
        }}
      >
        {t('demo.shortBadge')}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('demo.banner')}</span>
      <span style={{ flex: 1 }} />
      <Popover
        trigger="click"
        placement="bottomRight"
        title={t('demo.about')}
        content={<div style={{ maxWidth: 340, fontSize: 12, lineHeight: '20px' }}>{t('demo.aboutBody')}</div>}
      >
        <Button
          type="text"
          size="small"
          aria-label={t('demo.about')}
          icon={<QuestionCircleOutlined />}
          style={{ color: token.colorTextTertiary, flexShrink: 0 }}
        />
      </Popover>
    </div>
  );
}
