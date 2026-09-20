import { useMemo } from 'react';
import { Layout, Menu, Typography } from 'antd';
import {
  FileTextOutlined,
  IdcardOutlined,
  ProfileOutlined,
  ProjectOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DemoBanner from './DemoBanner';

const { Header, Sider, Content } = Layout;

/**
 * 全局框架：左侧导航 + 内容区。
 *
 * 选中项由当前路由推导；未选项目时只高亮「项目」，其余项目级入口置灰。
 * 导航文案走 `nav.*` 词典（Task 6 就已建好，值与原先的硬编码中文逐字相同，UI 不漂移）；
 * 品牌名与副标题走 `common.appName` / `common.tagline`（裁定 B-3：`appName` 的 en 值
 * 就是同一个中文串，专有名词不译——留在组件里就得给 Task 15 的残留扫描开白名单）。
 */
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: projectId } = useParams();
  const { t } = useTranslation();

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/settings')) return 'settings';
    if (path.includes('/wizard')) return 'projects';
    if (path.includes('/entity-card')) return 'entity-card';
    if (path.includes('/prompts')) return 'prompts';
    return 'projects';
  }, [location.pathname]);

  const items = useMemo(
    () => [
      { key: 'projects', icon: <ProjectOutlined />, label: t('nav.projects') },
      {
        key: 'entity-card',
        icon: <IdcardOutlined />,
        label: t('nav.entityCard'),
        disabled: !projectId,
      },
      { key: 'prompts', icon: <ProfileOutlined />, label: t('nav.prompts'), disabled: !projectId },
      { key: 'settings', icon: <SettingOutlined />, label: t('nav.settings') },
    ],
    // `t` 的身份随语言切换而变，必须在依赖里，否则切语言后菜单不重渲染。
    [projectId, t],
  );

  function onSelect(key: string) {
    if (key === 'projects') navigate('/projects');
    else if (key === 'settings') navigate('/settings');
    else if (projectId) navigate(`/projects/${projectId}/${key}`);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        className="geo-titlebar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          paddingInline: 16,
        }}
      >
        <FileTextOutlined style={{ color: '#1677ff' }} />
        <Typography.Text strong>{t('common.appName')}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('common.tagline')}
        </Typography.Text>
      </Header>
      <DemoBanner />
      <Layout>
        <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={items}
            onSelect={({ key }) => onSelect(key)}
            style={{ height: '100%', borderInlineEnd: 'none' }}
          />
        </Sider>
        <Content className="geo-page" style={{ overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
