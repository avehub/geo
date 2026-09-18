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

const { Header, Sider, Content } = Layout;

/**
 * 全局框架：左侧导航 + 内容区。
 *
 * 选中项由当前路由推导；未选项目时只高亮「项目」，其余项目级入口置灰。
 */
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: projectId } = useParams();

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
      { key: 'projects', icon: <ProjectOutlined />, label: '项目' },
      {
        key: 'entity-card',
        icon: <IdcardOutlined />,
        label: '品牌实体卡',
        disabled: !projectId,
      },
      { key: 'prompts', icon: <ProfileOutlined />, label: 'Prompt 题库', disabled: !projectId },
      { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    ],
    [projectId],
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
        <Typography.Text strong>稿得快 GEO</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          生成式引擎优化 · 本地优先
        </Typography.Text>
      </Header>
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
