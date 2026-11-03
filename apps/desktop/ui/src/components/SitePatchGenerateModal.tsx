import { useMemo, useState } from 'react';
import { Alert, Checkbox, Form, Modal, Select, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ActionItem, SitePatchKind, SitePatchPoolEntry } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface SitePatchGenerateModalProps {
  /** 这个项目的全部处方（页面从 `action_board` 拿）。 */
  actions: ActionItem[];
  /** 生成池的**目录**（`site_board.pool`）：哪条处方能生成哪几类补丁。 */
  pool: SitePatchPoolEntry[];
  /** `?from=<action_id>` 带进来的预选处方（DR-50：从行动中心点「站点补丁」跳过来）。 */
  presetActionId: string | null;
  generating: boolean;
  onCancel: () => void;
  onGenerate: (actionId: string, kinds: SitePatchKind[]) => void;
}

/**
 * 「从处方生成补丁草案」弹窗（spec DR-50 / DR-56④）。
 *
 * # 🔴 候选项来自后端的**目录**，不是前端枚举全表
 * `site_board.pool` 端的是"这条处方**能**生成哪几类补丁 + 各自叫什么"。
 * 拿 `SITE_PATCH_KIND_VALUES` 全表当选项的话，用户会勾上一堆生成不出来的类型，
 * 然后拿到一个空结果——比一开始就只列可选项难懂得多。
 *
 * # 🔴 `source_layout` 类处方在这里也置灰（DR-46）
 * 它的落点在**站外平台**（百科词条、行业媒体稿、B2B 平台报价），不在四条站点通道的范围内。
 * 行动中心那个入口按钮已经拦了一道；这里再拦一道是因为弹窗可以不经过那个按钮打开
 * （工具条上的「从处方生成」），而"选了一条生成不出东西的处方"必须给出**理由**，
 * 不能只回一个空列表。这句理由与行动中心的 tooltip 是**同一条词典值**
 * （`site.generate.sourceLayout`），两处措辞不会漂移。
 *
 * # 🔴 demo 不调模型（DR-56④）
 * `hint` 那句常驻：候选来自预置模板，生成出来一律是「草案 + 待人工审核」。
 */
export default function SitePatchGenerateModal({
  actions,
  pool,
  presetActionId,
  generating,
  onCancel,
  onGenerate,
}: SitePatchGenerateModalProps) {
  const { t } = useTranslation();
  const [actionId, setActionId] = useState<string | null>(presetActionId);
  const [kinds, setKinds] = useState<SitePatchKind[]>([]);

  const selected = actions.find((item) => item.id === actionId) ?? null;
  const candidates = useMemo(
    () => pool.filter((entry) => entry.action_id === actionId),
    [pool, actionId],
  );
  // 🔴 换处方就要清空勾选：`kind` 只在**同一条处方内**唯一，跨处方留着旧勾选
  // 会把"术语页的 JSON-LD"当成"资质页的 JSON-LD"发出去。
  const offSource = selected?.category === 'source_layout';
  const canRun = selected !== null && !offSource && kinds.length > 0;

  return (
    <Modal
      open
      title={t('site.generate.title')}
      width={720}
      okText={t('site.generate.run')}
      cancelText={t('site.generate.cancel')}
      okButtonProps={{ disabled: !canRun }}
      confirmLoading={generating}
      onCancel={onCancel}
      onOk={() => {
        if (selected !== null && kinds.length > 0) onGenerate(selected.id, kinds);
      }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('site.generate.hint')}
      </Typography.Paragraph>

      <Form layout="vertical">
        <Form.Item label={t('site.generate.action')}>
          {/* 🔴 刻意不开 `showSearch`：处方只有十条，而"这条有没有预置模板"必须**在选项里就看得见**
              （`generate.none` 那个尾巴），ReactNode 标签与字符串搜索不能同时成立。 */}
          <Select
            placeholder={t('site.generate.action')}
            value={actionId}
            onChange={(value: string) => {
              setActionId(value);
              setKinds([]);
            }}
            options={actions.map((item) => ({
              value: item.id,
              label: (
                <Space size={6}>
                  <Tag>{enumLabel(t, 'action.categories', item.category)}</Tag>
                  <span>{item.title}</span>
                  {pool.some((entry) => entry.action_id === item.id) ? null : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('site.generate.none')}
                    </Typography.Text>
                  )}
                </Space>
              ),
            }))}
          />
        </Form.Item>

        {selected === null ? null : offSource ? (
          <Alert type="warning" showIcon message={t('site.generate.sourceLayout')} />
        ) : (
          <Form.Item label={t('site.generate.kinds')}>
            {candidates.length === 0 ? (
              <Alert type="info" showIcon message={t('site.generate.emptyHint')} />
            ) : (
              <Checkbox.Group
                value={kinds}
                onChange={(values) => setKinds(values as SitePatchKind[])}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                {candidates.map((entry) => (
                  <Checkbox key={entry.kind} value={entry.kind}>
                    <Space size={6}>
                      <Tag>{enumLabel(t, 'site.patchKinds', entry.kind)}</Tag>
                      <Typography.Text style={{ fontSize: 12 }}>{entry.title}</Typography.Text>
                    </Space>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            )}
          </Form.Item>
        )}
      </Form>

    </Modal>
  );
}
