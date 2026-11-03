/**
 * 设置页的骨架：左侧二级菜单 + 右侧分段内容（Plan B Task 2 · spec DR-27 / §6）。
 *
 * # 为什么骨架不含数据获取
 * 数据（`settings_get` / `llm_providers`）与草稿、保存态全部由 `pages/SettingsPage.tsx` 持有，
 * 这里只做**布局与分段分派**。理由：五个分段共享同一份草稿，把 query 放进分段就会变成
 * "切一段重新拉一次"，而 `settings_update` 是整包写——两份并存的草稿必然互相冲掉。
 *
 * # 菜单是 `<nav>` 里的普通 `Menu`，不是路由嵌套
 * 用 `onClick → navigate` 而不是 `<Routes>` 嵌套：分段切换要保住 `SettingsPage` 的草稿状态，
 * 嵌套路由会卸载父组件（草稿随之消失），而"改了并发数再去看看模型"是很自然的动作。
 */
import type { ComponentType } from 'react';
import { Col, Menu, Row } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PageHeader from '../../components/ui/PageHeader';

import AboutSection from './AboutSection';
import CollectionSection from './CollectionSection';
import GeneralSection from './GeneralSection';
import ModelsSection from './ModelsSection';
import StorageSection from './StorageSection';
import {
  SECTION_LABEL_KEYS,
  SETTINGS_SECTIONS,
  type SectionProps,
  type SettingsSection,
} from './sections';

/** slug → 分段组件。漏一个 slug 在 `tsc` 就红（`Record` 是全覆盖的）。 */
const SECTION_COMPONENTS: Record<SettingsSection, ComponentType<SectionProps>> = {
  general: GeneralSection,
  models: ModelsSection,
  collection: CollectionSection,
  storage: StorageSection,
  about: AboutSection,
};

export interface SettingsLayoutProps extends SectionProps {
  section: SettingsSection;
}

export default function SettingsLayout({ section, ...sectionProps }: SettingsLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Section = SECTION_COMPONENTS[section];

  return (
    <div>
      <PageHeader title={t(SECTION_LABEL_KEYS[section])} />
      <Row gutter={16}>
        <Col span={5}>
          {/* `aria-label` 用「设置」而不是当前分段名：地标要说清"这一块是什么"，
              当前分段已经由 `aria-current`（antd 的 selected 态）与右侧标题表达。 */}
          <nav aria-label={t('settings.page.title')}>
            <Menu
              mode="inline"
              selectedKeys={[section]}
              items={SETTINGS_SECTIONS.map((slug) => ({
                key: slug,
                label: t(SECTION_LABEL_KEYS[slug]),
              }))}
              onClick={({ key }) => navigate(`/settings/${key}`)}
              style={{ borderInlineEnd: 'none' }}
            />
          </nav>
        </Col>
        <Col span={19}>
          <Section {...sectionProps} />
        </Col>
      </Row>
    </div>
  );
}
