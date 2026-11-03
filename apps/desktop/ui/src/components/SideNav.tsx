/**
 * 左侧导航（2026-10-30 二稿 · 企业风）。
 *
 * # 双模式
 * - **项目外**（`/projects`、`/portfolio`、`/settings`）：全部项目 / 组合总览 / 项目清单；
 * - **项目内**（`/projects/:id/*`）：项目切换器（含「全部项目」）+ 概览 + 四个阶段组。
 *
 * 二稿相比一稿删掉的东西：分组计数、独立的「← 全部项目」行、组标题的品牌色。
 * 企业风里侧栏只做两件事——**定位**与**切换**；计数、进度这类信息属于内容区。
 *
 * # 为什么组标题是 `<button>` 而不是 antd SubMenu
 * 三级 SubMenu 在 216px 宽下会把文字截成省略号，且组标题是折叠控件、不是导航目标。
 * 所以它是 `aria-expanded` + `aria-controls` 的按钮；组内仍然是 antd `Menu`，
 * 选中态继续由 `location.pathname` 推导，路由一个都没改。
 *
 * # 🔴 零取数
 * 侧栏只读 `project_list` 这一条已存在的查询（与项目列表页共用缓存键），
 * **不为导航额外发任何命令**（命令面保持 105）。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Dropdown, Layout, Menu, theme, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  DownOutlined,
  EditOutlined,
  FileSearchOutlined,
  FolderOutlined,
  GlobalOutlined,
  HomeOutlined,
  IdcardOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  RightOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { TranslationKey } from '../i18n/resources';

const { Sider } = Layout;

const ALL_PROJECTS_KEY = 'all-projects';
const PORTFOLIO_KEY = 'portfolio';
const SETTINGS_KEY = 'settings';
const EMPTY_KEY = 'no-projects';
const PROJECT_KEY_PREFIX = 'project:';

/** 14 个业务项，顺序 = 产品闭环顺序（M1 → M7）。分组不改变这个顺序。 */
const PROJECT_SECTIONS = [
  'overview',
  'entity-card',
  'knowledge',
  'keywords',
  'faq',
  'prompts',
  'collection',
  'insight',
  'webmaster-data',
  'diagnosis',
  'action',
  'articles',
  'site',
  'report',
] as const;

type ProjectSection = (typeof PROJECT_SECTIONS)[number];

interface ProjectGroup {
  key: string;
  labelKey: TranslationKey;
  sections: readonly ProjectSection[];
}

/** `overview` 不放进任何组：它是项目的落点页，永远置顶。 */
const PROJECT_GROUPS: readonly ProjectGroup[] = [
  {
    key: 'prepare',
    labelKey: 'nav.groups.prepare',
    sections: ['entity-card', 'knowledge', 'keywords', 'faq', 'prompts'],
  },
  {
    key: 'monitor',
    labelKey: 'nav.groups.monitor',
    sections: ['collection', 'insight', 'webmaster-data'],
  },
  {
    key: 'diagnose',
    labelKey: 'nav.groups.diagnose',
    sections: ['diagnosis', 'action'],
  },
  {
    key: 'deliver',
    labelKey: 'nav.groups.deliver',
    sections: ['articles', 'site', 'report'],
  },
];

const SECTION_LABEL_KEYS: Record<ProjectSection, TranslationKey> = {
  overview: 'nav.overview',
  'entity-card': 'nav.entityCard',
  knowledge: 'nav.knowledge',
  keywords: 'nav.keywords',
  faq: 'nav.faq',
  prompts: 'nav.prompts',
  collection: 'nav.collection',
  insight: 'nav.insight',
  'webmaster-data': 'nav.webmasterData',
  diagnosis: 'nav.diagnosis',
  action: 'nav.action',
  articles: 'nav.articles',
  site: 'nav.site',
  report: 'nav.report',
};

const SECTION_ICONS: Record<ProjectSection, ReactNode> = {
  overview: <HomeOutlined />,
  'entity-card': <IdcardOutlined />,
  knowledge: <ReadOutlined />,
  keywords: <TagsOutlined />,
  faq: <QuestionCircleOutlined />,
  prompts: <ProfileOutlined />,
  collection: <CloudDownloadOutlined />,
  insight: <FileSearchOutlined />,
  'webmaster-data': <LineChartOutlined />,
  diagnosis: <DashboardOutlined />,
  action: <ThunderboltOutlined />,
  articles: <EditOutlined />,
  site: <GlobalOutlined />,
  report: <BarChartOutlined />,
};

function projectKey(id: string): string {
  return `${PROJECT_KEY_PREFIX}${id}`;
}

function sectionKey(id: string, section: ProjectSection): string {
  return `${PROJECT_KEY_PREFIX}${id}:${section}`;
}

function sectionOf(pathname: string, projectId: string): ProjectSection | null {
  const rest = pathname.slice(`/projects/${projectId}/`.length);
  const section = rest.split('/')[0];
  return (PROJECT_SECTIONS as readonly string[]).includes(section)
    ? (section as ProjectSection)
    : null;
}

function groupOf(section: ProjectSection | null): string | null {
  if (section === null) return null;
  return PROJECT_GROUPS.find((entry) => entry.sections.includes(section))?.key ?? null;
}

/** 选中态一律由 `location.pathname` 推导（路由不变，侧栏跟着路由走）。 */
function selectedKeysOf(pathname: string, projectId: string | null): string[] {
  if (pathname.startsWith('/settings')) return [SETTINGS_KEY];
  if (pathname === '/portfolio') return [PORTFOLIO_KEY];
  if (pathname.startsWith('/projects/new')) return [];
  if (projectId !== null) {
    const section = sectionOf(pathname, projectId);
    return section === null ? [projectKey(projectId)] : [sectionKey(projectId, section)];
  }
  if (pathname === '/' || pathname === '/projects') return [ALL_PROJECTS_KEY];
  return [];
}

function initialOpenGroups(projectId: string | null, section: ProjectSection | null): string[] {
  if (projectId === null) return [];
  const group = groupOf(section);
  return group === null ? [] : [group];
}

export default function SideNav() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const projectMatch = useMatch('/projects/:id/*');

  const projectsQuery = useQuery({
    queryKey: ['projects', { query: null, include_archived: true }],
    queryFn: () => client.projectList({ query: null, include_archived: true }),
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const projectId =
    projectMatch !== null && !location.pathname.startsWith('/projects/new')
      ? (projectMatch.params.id ?? null)
      : null;
  const section = useMemo(
    () => (projectId === null ? null : sectionOf(location.pathname, projectId)),
    [location.pathname, projectId],
  );
  const currentProject = useMemo(
    () => (projectId === null ? undefined : projects.find((project) => project.id === projectId)),
    [projectId, projects],
  );

  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>(() => initialOpenGroups(projectId, section));
  const [trackedSection, setTrackedSection] = useState<ProjectSection | null>(section);

  // 路由换到另一个阶段时「补开」它所在的组：只开不关（渲染期调整状态，不用 effect）。
  if (section !== trackedSection) {
    setTrackedSection(section);
    const group = groupOf(section);
    if (group !== null) {
      setOpenGroups((previous) => (previous.includes(group) ? previous : [...previous, group]));
    }
  }

  const selectedKeys = selectedKeysOf(location.pathname, projectId);

  function onSelect({ key }: { key: string }) {
    if (key === SETTINGS_KEY) {
      navigate('/settings');
      return;
    }
    if (key === ALL_PROJECTS_KEY) {
      navigate('/projects');
      return;
    }
    if (key === PORTFOLIO_KEY) {
      navigate('/portfolio');
      return;
    }
    if (!key.startsWith(PROJECT_KEY_PREFIX)) return;
    const [id, target] = key.slice(PROJECT_KEY_PREFIX.length).split(':');
    if (id === undefined || id === '') return;
    navigate(target === undefined ? `/projects/${id}/overview` : `/projects/${id}/${target}`);
  }

  const projectItems: MenuProps['items'] = projects.map((project) => ({
    key: projectKey(project.id),
    icon: <FolderOutlined />,
    label: project.name,
    title: project.name,
    disabled: project.status === 'archived',
  }));

  const newProjectButton = (
    <Button
      type="text"
      size="small"
      icon={<PlusOutlined />}
      aria-label={t('nav.newProject')}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        navigate('/projects/new');
      }}
    />
  );

  const outsideItems: MenuProps['items'] = [
    {
      key: ALL_PROJECTS_KEY,
      icon: <AppstoreOutlined />,
      label: t('nav.allProjects'),
      title: t('nav.allProjects'),
    },
    {
      key: PORTFOLIO_KEY,
      icon: <BarChartOutlined />,
      label: t('nav.portfolio'),
      title: t('nav.portfolio'),
    },
    { type: 'divider' },
    {
      type: 'group',
      label: (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <span>{t('nav.projects')}</span>
          {newProjectButton}
        </span>
      ),
      children:
        projectsQuery.isSuccess && projects.length === 0
          ? [{ key: EMPTY_KEY, label: t('nav.noProjects'), disabled: true }]
          : projectItems,
    },
  ];

  const overviewItem = {
    key: projectId === null ? ALL_PROJECTS_KEY : sectionKey(projectId, 'overview'),
    icon: <HomeOutlined />,
    label: t('nav.overview'),
    title: t('nav.overview'),
  };

  const settingsItems: MenuProps['items'] = [
    { key: SETTINGS_KEY, icon: <SettingOutlined />, label: t('nav.settings'), title: t('nav.settings') },
  ];

  /** 折叠态：一条扁平图标菜单，组结构让位于宽度。 */
  const railItems: MenuProps['items'] =
    projectId !== null
      ? [
          {
            key: ALL_PROJECTS_KEY,
            icon: <ArrowLeftOutlined />,
            label: t('nav.allProjects'),
            title: t('nav.allProjects'),
          },
          {
            key: sectionKey(projectId, 'overview'),
            icon: <HomeOutlined />,
            label: t('nav.overview'),
            title: t('nav.overview'),
          },
          ...PROJECT_SECTIONS.filter((entry) => entry !== 'overview').map((entry) => ({
            key: sectionKey(projectId, entry),
            icon: SECTION_ICONS[entry],
            label: t(SECTION_LABEL_KEYS[entry]),
            title: t(SECTION_LABEL_KEYS[entry]),
          })),
        ]
      : [
          {
            key: ALL_PROJECTS_KEY,
            icon: <AppstoreOutlined />,
            label: t('nav.allProjects'),
            title: t('nav.allProjects'),
          },
          {
            key: PORTFOLIO_KEY,
            icon: <BarChartOutlined />,
            label: t('nav.portfolio'),
            title: t('nav.portfolio'),
          },
          ...projectItems,
        ];

  /** 切换器第一项是「全部项目」：一稿里那行独立的返回链接被收进来了。 */
  const switchItems: MenuProps['items'] = [
    {
      key: 'all',
      icon: <AppstoreOutlined />,
      label: t('nav.allProjects'),
      onClick: () => navigate('/projects'),
    },
    { type: 'divider' },
    ...projects
      .filter((project) => project.status !== 'archived')
      .map((project) => ({
        key: project.id,
        label: project.name,
        onClick: () => navigate(`/projects/${project.id}/overview`),
      })),
  ];

  function toggleGroup(key: string) {
    setOpenGroups((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key],
    );
  }

  return (
    <Sider
      width={240}
      collapsedWidth={64}
      collapsed={collapsed}
      trigger={null}
      theme="light"
      style={{
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <nav
          aria-label={t('nav.projectsAria')}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBlock: 6 }}
        >
          {projectId === null ? (
            <Menu
              mode="inline"
              inlineCollapsed={collapsed}
              items={collapsed ? railItems : outsideItems}
              selectedKeys={selectedKeys}
              onSelect={onSelect}
              style={{ borderInlineEnd: 'none', background: 'transparent' }}
            />
          ) : collapsed ? (
            <Menu
              mode="inline"
              inlineCollapsed
              items={railItems}
              selectedKeys={selectedKeys}
              onSelect={onSelect}
              style={{ borderInlineEnd: 'none', background: 'transparent' }}
            />
          ) : (
            <>
              {currentProject === undefined ? null : (
                <div style={{ padding: '2px 8px 10px' }}>
                  <Dropdown menu={{ items: switchItems }} trigger={['click']} placement="bottomLeft">
                    <Button
                      type="text"
                      aria-label={t('nav.switchProject')}
                      style={{
                        width: '100%',
                        height: 44,
                        paddingInline: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        color: token.colorText,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: token.colorPrimaryBg,
                          color: token.colorPrimary,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {currentProject.name.slice(0, 1)}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        {currentProject.name}
                      </span>
                      <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                    </Button>
                  </Dropdown>
                </div>
              )}

              <Menu
                mode="inline"
                items={[overviewItem]}
                selectedKeys={selectedKeys}
                onSelect={onSelect}
                style={{ borderInlineEnd: 'none', background: 'transparent' }}
              />

              {PROJECT_GROUPS.map((group) => {
                const open = openGroups.includes(group.key);
                const active = section !== null && group.sections.includes(section);
                const panelId = `nav-group-${group.key}`;
                return (
                  <div key={group.key}>
                    <Button
                      type="text"
                      block
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => toggleGroup(group.key)}
                      style={{
                        height: 40,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        gap: 6,
                        paddingInline: 12,
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        color: active ? token.colorText : token.colorTextTertiary,
                      }}
                    >
                      <RightOutlined
                        aria-hidden
                        style={{
                          fontSize: 9,
                          transition: `transform ${token.motionDurationMid}`,
                          transform: open ? 'rotate(90deg)' : 'none',
                        }}
                      />
                      <span>{t(group.labelKey)}</span>
                    </Button>
                    <div id={panelId} style={{ display: open ? 'block' : 'none' }}>
                      <Menu
                        mode="inline"
                        items={group.sections.map((entry) => ({
                          key: sectionKey(projectId, entry),
                          icon: SECTION_ICONS[entry],
                          label: t(SECTION_LABEL_KEYS[entry]),
                          title: t(SECTION_LABEL_KEYS[entry]),
                        }))}
                        selectedKeys={selectedKeys}
                        onSelect={onSelect}
                        style={{ borderInlineEnd: 'none', background: 'transparent', paddingInline: 4 }}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {projectsQuery.isError && !collapsed && (
            <Alert
              type="error"
              showIcon
              style={{ margin: 8 }}
              message={t('nav.loadFailed')}
              description={
                <Typography.Text style={{ fontSize: 12 }}>
                  {describeIpcError(projectsQuery.error, t)}
                </Typography.Text>
              }
            />
          )}
        </nav>

        <div
          style={{
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
            padding: '4px 10px',
          }}
        >
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? t('nav.expandNav') : t('nav.collapseNav')}
            onClick={() => setCollapsed((value) => !value)}
            style={{ color: token.colorTextTertiary }}
          />
        </div>

        <nav aria-label={t('nav.settingsAria')} style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            items={settingsItems}
            selectedKeys={selectedKeys.filter((key) => key === SETTINGS_KEY)}
            onSelect={onSelect}
            style={{ borderInlineEnd: 'none', background: 'transparent' }}
          />
        </nav>
      </div>
    </Sider>
  );
}
