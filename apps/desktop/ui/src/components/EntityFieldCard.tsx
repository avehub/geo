import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';

import type { FieldStatus } from '../api/types';
import { FIELD_STATUS_LABELS } from '../api/types';
import FieldStatusTag from './FieldStatusTag';

export type FieldKind = 'text' | 'textarea' | 'tags' | 'number' | 'json';

export interface FieldDescriptor {
  path: string;
  label: string;
  kind: FieldKind;
  required: boolean;
}

/** 11 个实体卡字段，顺序即 UI 展示顺序（前 10 个计入完整率）。 */
export const ENTITY_FIELDS: FieldDescriptor[] = [
  { path: 'standard_name', label: '标准名', kind: 'text', required: true },
  { path: 'aliases', label: '品牌别名', kind: 'tags', required: true },
  { path: 'founded_year', label: '成立年份', kind: 'number', required: true },
  { path: 'qualifications', label: '资质认证', kind: 'tags', required: true },
  { path: 'products', label: '产品与参数', kind: 'json', required: true },
  { path: 'price_range', label: '价格区间', kind: 'text', required: true },
  { path: 'service_regions', label: '服务地域', kind: 'tags', required: true },
  { path: 'cases', label: '客户案例', kind: 'tags', required: true },
  { path: 'differentiators', label: '差异化卖点', kind: 'tags', required: true },
  { path: 'official_tone', label: '官方口径', kind: 'textarea', required: false },
  { path: 'contact', label: '联系方式', kind: 'json', required: true },
];

const STATUS_OPTIONS = (Object.keys(FIELD_STATUS_LABELS) as FieldStatus[]).map((value) => ({
  value,
  label: FIELD_STATUS_LABELS[value],
}));

/** 把任意字段值渲染成人能读的文本。 */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() === '' ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => typeof item === 'string')) return (value as string[]).join('、');
    return JSON.stringify(value, null, 2);
  }
  return JSON.stringify(value, null, 2);
}

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
 */
export default function EntityFieldCard({
  descriptor,
  value,
  status,
  saving = false,
  onSave,
}: EntityFieldCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<FieldStatus>(status);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraftStatus(status);
  }, [status]);

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
          return { ok: false, reason: `JSON 解析失败：${(error as Error).message}` };
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
          <Typography.Text strong>{descriptor.label}</Typography.Text>
          <FieldStatusTag status={status} />
          {descriptor.required ? null : <Typography.Text type="secondary">（选填）</Typography.Text>}
        </Space>
      }
      extra={
        editing ? null : (
          <Button size="small" icon={<EditOutlined />} onClick={beginEdit}>
            编辑
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
              placeholder="输入后回车添加"
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
              placeholder="例如：2006"
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
            options={STATUS_OPTIONS}
            value={draftStatus}
            onChange={(event) => setDraftStatus(event.target.value as FieldStatus)}
          />

          <Space>
            <Button type="primary" size="small" loading={saving} onClick={commit}>
              保存
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              取消
            </Button>
          </Space>
        </Space>
      ) : (
        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
          {formatFieldValue(value)}
        </Typography.Paragraph>
      )}
    </Card>
  );
}
