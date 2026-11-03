import { Collapse, Row, Col, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { enumLabel } from '../i18n/enum-label';
import { groupByScenario, isMediaKind, isScriptModule, type KbModuleGroup, type KbRow } from './kb-view';
import KbEntryCard from './KbEntryCard';

export interface KbModulePanelsProps {
  groups: KbModuleGroup[];
  selectedIds: string[];
  busyId: string | null;
  emptyText: string;
  onSelect: (row: KbRow, selected: boolean) => void;
  onEdit: (row: KbRow) => void;
  onDelete: (row: KbRow) => void;
  onVerify: (row: KbRow) => void;
  onCopy: (row: KbRow) => void;
  onPreview: (row: KbRow) => void;
}

/**
 * 分组视图（DR-76 的 `group` 档）：模块面板 →（话术模块）场景子标题 → 卡片。
 *
 * - 话术模块按 `KB_SCENARIO_VALUES` 的序出子标题（Highspot / Seismic 的 playbook 分段同族）；
 * - 素材模块走**画廊格**（一行三列），其余模块单列卡片；
 * - 面板头 = 模块标签 + 条数 + 一句用途说明（`kb.modulesHint.*`）。
 */
export default function KbModulePanels({
  groups,
  selectedIds,
  busyId,
  emptyText,
  onSelect,
  onEdit,
  onDelete,
  onVerify,
  onCopy,
  onPreview,
}: KbModulePanelsProps) {
  const { t } = useTranslation();

  if (groups.length === 0) {
    return <Typography.Paragraph type="secondary">{emptyText}</Typography.Paragraph>;
  }

  const cardOf = (row: KbRow) => (
    <KbEntryCard
      row={row}
      selected={selectedIds.includes(row.id)}
      busy={busyId === row.id}
      onSelect={onSelect}
      onEdit={onEdit}
      onDelete={onDelete}
      onVerify={onVerify}
      onCopy={onCopy}
      onPreview={onPreview}
    />
  );

  const bodyOf = (group: KbModuleGroup) => {
    if (isScriptModule(group.module)) {
      return groupByScenario(group.rows).map((section) => (
        <div key={section.scenario ?? 'none'} style={{ marginBottom: 12 }}>
          <Typography.Text strong type="secondary">
            {section.scenario === null
              ? t('kb.editor.scenarioNone')
              : enumLabel(t, 'kb.scenarios', section.scenario)}
          </Typography.Text>
          <Row gutter={[12, 12]} style={{ marginTop: 6 }}>
            {section.rows.map((row) => (
              <Col key={row.id} span={12}>
                {cardOf(row)}
              </Col>
            ))}
          </Row>
        </div>
      ));
    }
    const media = group.rows.every((row) => isMediaKind(row.kind));
    return (
      <Row gutter={[12, 12]}>
        {group.rows.map((row) => (
          <Col key={row.id} span={media ? 8 : 12}>
            {cardOf(row)}
          </Col>
        ))}
      </Row>
    );
  };

  return (
    <Collapse
      defaultActiveKey={groups.map((group) => group.module)}
      items={groups.map((group) => ({
        key: group.module,
        label: (
          <span>
            <Typography.Text strong>{enumLabel(t, 'kb.modules', group.module)}</Typography.Text>
            {'  '}
            <Typography.Text type="secondary">
              {t('kb.stats.modulesCount', { count: group.rows.length })}
            </Typography.Text>
            {'  '}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(`kb.modulesHint.${group.module}`, { nsSeparator: false })}
            </Typography.Text>
          </span>
        ),
        children: bodyOf(group),
      }))}
    />
  );
}
