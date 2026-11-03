import { Button, Layout, Typography, theme } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import DemoModeStrip from './ui/DemoModeStrip';
import SideNav from './SideNav';

const { Header, Content } = Layout;

/**
 * 全局框架：48px 标题栏 + 32px demo 细条 + 左侧导航 + 内容区。
 *
 * # 2026-10-30 视觉重做的三处变化
 * - 标题栏 64 → **48px**：副标题（`common.tagline`）从标题栏撤掉，只保留品牌名与开发入口——
 *   企业风的上沿只做「这是谁」，不做「这是一句口号」；腾出来的 16px 留给首屏内容；
 * - demo 横幅换成 `DemoModeStrip`（32px 常驻细条，不可关闭），合规句一字不减；
 * - 外层 `Layout` 用 `100vh` 而不是 `minHeight`：只有内容区滚动，侧栏与顶部条固定，
 *   这样长页面滚动时导航不会跟着走（原来 `minHeight` + 整页滚动会让侧栏底部跑出窗口）。
 *
 * # 🔴 颜色仍一律走 token
 * 暗色下 `#fff` 的标题栏会是一块刺眼的白（DR-31）。这里不出现任何色值字面量；
 * 边框与背景全部来自 `theme.useToken()`。
 */
export default function AppLayout() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        className="geo-titlebar"
        style={{
          height: 48,
          lineHeight: '48px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          paddingInline: 16,
        }}
      >
        <FileTextOutlined style={{ color: token.colorPrimary, fontSize: 16 }} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t('common.appName')}
        </Typography.Text>
        <span style={{ flex: 1 }} />
        {import.meta.env.DEV ? (
          // 设计样张的入口只存在于开发环境；`geo-no-drag` 让它在 macOS 拖拽区里仍可点击。
          <Button
            className="geo-no-drag"
            type="text"
            size="small"
            onClick={() => navigate('/__design')}
            style={{ fontSize: 12, color: token.colorTextTertiary }}
          >
            {t('design.title')}
          </Button>
        ) : null}
      </Header>
      <DemoModeStrip />
      <Layout style={{ minHeight: 0 }}>
        <SideNav />
        <Content className="geo-page" style={{ overflow: 'auto' }}>

          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
