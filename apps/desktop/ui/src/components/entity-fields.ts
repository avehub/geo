/**
 * 实体卡字段元数据与展示格式化。
 *
 * 单独成模块（而不是放在 `EntityFieldCard.tsx` 里）有两个原因：
 * 1. `RevisionTimeline` 也要用字段标签与格式化，不该反向依赖组件文件；
 * 2. 组件文件只导出组件，Vite 的 React Fast Refresh 才能生效。
 */

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
