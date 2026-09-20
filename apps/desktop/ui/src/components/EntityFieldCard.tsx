import { useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { FieldStatus } from '../api/types';
import { FIELD_STATUS_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { formatFieldValue, type FieldDescriptor } from './entity-fields';
import FieldStatusTag from './FieldStatusTag';

function toEditable(descriptor: FieldDescriptor, value: unknown): string {
  if (descriptor.kind === 'json') return value == null ? '' : JSON.stringify(value, null, 2);
  if (descriptor.kind === 'textarea' || descriptor.kind === 'text') {
    return typeof value === 'string' ? value : '';
  }
  return '';
}

export interface EntityFieldCardProps {
  descriptor: FieldDescriptor;
  value: unknown;
  status: FieldStatus;
  saving?: boolean;
  onSave: (value: unknown, status: FieldStatus) => void;
}

/**
 * 单个实体卡字段：展示值 + 可信状态，支持就地编辑并写修订留痕。
 *
 * `json` 类字段（产品、联系方式）用 JSON 文本编辑，解析失败就地报错、不提交。
 *
 * 标题渲染 `t(descriptor.labelKey)`：`FieldDescriptor` 装的是**词典 key** 而不是译文，
 * 因为 `entity-fields.ts` 是模块级常量、求值时没有 React 上下文（裁定 B-2）。
 * 状态单选的**运行时清单**是 `api/types.ts` 的 `FIELD_STATUS_VALUES`（语言中立的稳定 id）；
 * 标签查词典 `entity.fieldStatuses.<id>`（`enumLabel`，查不到回退 id 本身）。选项在组件体内
 * 就地构造：模块级常量求值时没有 React 上下文、拿不到 `t`（裁定 B-2 同族）。
 */
export default function EntityFieldCard({
  descriptor,
  value,
  status,
  saving = false,
  onSave,
}: EntityFieldCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<FieldStatus>(status);
  const [lastStatus, setLastStatus] = useState<FieldStatus>(status);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // 外部状态变化时对齐本地草稿：用「渲染期比较」而不是 effect，
  // 否则会多一次级联渲染（react-hooks/set-state-in-effect）。
  if (lastStatus !== status) {
    setLastStatus(status);
    setDraftStatus(status);
  }

  function beginEdit() {
    setText(toEditable(descriptor, value));
    setTags(Array.isArray(value) ? (value as string[]).filter((item) => typeof item === 'string') : []);
    setYear(typeof value === 'number' ? value : null);
    setDraftStatus(status);
    setParseError(null);
    setEditing(true);
  }

  function buildValue(): { ok: true; next: unknown } | { ok: false; reason: string } {
    switch (descriptor.kind) {
      case 'tags':
        return { ok: true, next: tags.map((item) => item.trim()).filter((item) => item !== '') };
      case 'number':
        return { ok: true, next: year };
      case 'json': {
        if (text.trim() === '' || text.trim() === 'null') return { ok: true, next: null };
        try {
          return { ok: true, next: JSON.parse(text) as unknown };
        } catch (error) {
          // `JSON.parse` 的原文是引擎给的英文诊断，属**该显示的数据**，照原样插进模板。
          return { ok: false, reason: t('entity.fieldCard.jsonParseFailed', { detail: (error as Error).message }) };
        }
      }
      default:
        return { ok: true, next: text };
    }
  }

  function commit() {
    const built = buildValue();
    if (!built.ok) {
      setParseError(built.reason);
      return;
    }
    setParseError(null);
    onSave(built.next, draftStatus);
    setEditing(false);
  }

  return (
    <Card
      size="small"
      data-testid={`entity-field-${descriptor.path}`}
      title={
        <Space size={8}>
          <Typography.Text strong>{t(descriptor.labelKey)}</Typography.Text>
          <FieldStatusTag status={status} />
          {descriptor.required ? null : (
            <Typography.Text type="secondary">{t('entity.fieldCard.optional')}</Typography.Text>
          )}
        </Space>
      }
      extra={
        editing ? null : (
          <Button size="small" icon={<EditOutlined />} onClick={beginEdit}>
            {t('common.edit')}
          </Button>
        )
      }
    >
      {editing ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {descriptor.kind === 'tags' ? (
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={tags}
              onChange={setTags}
              placeholder={t('entity.fieldCard.tagsPlaceholder')}
              tokenSeparators={[',', '，']}
              open={false}
              suffixIcon={null}
            />
          ) : null}
          {descriptor.kind === 'number' ? (
            <InputNumber
              style={{ width: 180 }}
              min={1800}
              max={2100}
              value={year}
              onChange={(next) => setYear(next)}
              placeholder={t('entity.fieldCard.yearPlaceholder')}
            />
          ) : null}
          {descriptor.kind === 'text' ? (
            <Input value={text} onChange={(event) => setText(event.target.value)} allowClear />
          ) : null}
          {descriptor.kind === 'textarea' || descriptor.kind === 'json' ? (
            <Input.TextArea
              rows={descriptor.kind === 'json' ? 6 : 3}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : null}

          {parseError && <Alert type="error" showIcon message={parseError} />}

          <Radio.Group
            optionType="button"
            size="small"
            options={FIELD_STATUS_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'entity.fieldStatuses', value),
            }))}
            value={draftStatus}
            onChange={(event) => setDraftStatus(event.target.value as FieldStatus)}
          />

          <Space>
            <Button type="primary" size="small" loading={saving} onClick={commit}>
              {t('common.save')}
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </Space>
        </Space>
      ) : (
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
          {formatFieldValue(value, t('common.listSeparator'))}
        </Typography.Paragraph>
      )}
    </Card>
  );
}
