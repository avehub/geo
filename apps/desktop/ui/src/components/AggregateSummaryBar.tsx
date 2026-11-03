import { useMemo, useState } from 'react';
import { Button, Card, Checkbox, Col, DatePicker, Radio, Row, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import {
  SEARCH_PIVOT_DIMENSION_VALUES,
  SEARCH_SURFACE_FILTER_VALUES,
  type SearchAggregate,
  type SearchAggregateFlag,
  type SearchAggregateFlagKind,
  type SearchFilter,
  type SearchPivotDimension,
  type SearchSurfaceFilter,
} from '../api/search-compose';
import type { SearchSourceKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { countText, percentText } from './format';

export interface AggregateSummaryBarProps {
  /** 已经算好的合计（`api/search-compose.ts` 的 `summarizeMetrics`，本组件不重算）。 */
  aggregate: SearchAggregate;
  filter: SearchFilter;
  /** 平台筛选器的可选集：页面传**一期**源（二期源一个入口都不给，DR-92）。 */
  platformOptions: readonly SearchSourceKind[];
  /** “今天”的锚点：预设区间必须跟页面/命令端的 `as_of` 一致。 */
  asOf: string;
  onFilterChange: (next: SearchFilter) => void;
}

/** 旗标配色：陈旧与采样是"数字可能偏低"，站内分析被排除与跨面是"口径提示"。 */
const FLAG_TYPES: Record<SearchAggregateFlagKind, 'warning' | 'secondary'> = {
  excluded_analytics: 'secondary',
  cross_surface: 'secondary',
  stale: 'warning',
  sampled: 'warning',
  partial: 'warning',
};

/** 一个合计数：标签 + 值。值单独成元素（读屏与测试都能按值本身定位）。 */
function Total({ label, value }: { label: string; value: string }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong style={{ fontSize: 18 }}>
        {value}
      </Typography.Text>
    </Space>
  );
}

/**
 * 站长数据页第 2 段：**跨平台汇总条**（spec `2026-10-12-webmaster-data-integration-design.md`
 * DR-95 / DR-109 / DR-110 / DR-112，走查 10…13）。
 *
 * # 🔴 这里一个数字都不算
 * A 类求和、B 类重算、交集区间、陈旧与采样判定全在 `api/search-compose.ts`（纯函数，
 * demo 与桌面端共用同一份）。本组件只做两件事：把结果**摆出来**，以及把四个筛选器
 * 的变化交回页面（页面重算后再喂回来）⇒ "取消勾选一个平台，合计 / CTR / 区间三个当场重算"
 * 是**数据流**的结果，不是这里的一段副作用。
 *
 * # 🔴 给数字，同时给得出这个数字的账（DR-95 撤回"没有总曝光"时一并认下的义务）
 * 合计行旁边**永远**有三样东西：汇总区间（收敛到各源 `data_through` 的交集，并点名受限源）、
 * 参与源清单（可展开，每行给出数据截至日 / 完整性 / 区间是谁声明的）、完整性旗标。
 *
 * # 🔴 汇总 CTR 是**重算值**（DR-95 B 类）
 * Σclicks ÷ Σimpressions，绝不是各平台点击率的算术平均——三家的分母各不相同。
 * `aggregate.ctrNote` 那句因此**常驻**在本条上，不藏进问号。
 */
export default function AggregateSummaryBar({
  aggregate,
  filter,
  platformOptions,
  asOf,
  onFilterChange,
}: AggregateSummaryBarProps) {
  const { t } = useTranslation();
  const [showParticipants, setShowParticipants] = useState(false);

  const separator = t('common.listSeparator');
  const labelOf = (kind: SearchSourceKind) => enumLabel(t, 'webmasterData.sources', kind);
  const labelsOf = (kinds: readonly SearchSourceKind[]) => kinds.map(labelOf).join(separator);

  /** compose 只给得出枚举 id，译名在这一层补（DR-110：旗标要点名是哪个平台）。 */
  function textOf(flag: SearchAggregateFlag): string {
    const params =
      flag.flag === 'sampled' ? { ...flag.params, source: labelsOf(flag.source_kinds) } : flag.params;
    return t(flag.flag_key, { nsSeparator: false, ...params });
  }

  // 🔴 预设区间在渲染期算：写在模块顶层会把"今天"冻在进程启动那一刻（跨零点就偏一天）。
  const presets = useMemo(() => {
    const anchor = dayjs(asOf);
    return ([7, 28, 90] as const).map((days) => ({
      label: t(`webmasterData.filters.presets.d${days}`, { nsSeparator: false }),
      value: [anchor.subtract(days, 'day'), anchor] as [dayjs.Dayjs, dayjs.Dayjs],
    }));
  }, [asOf, t]);

  const surfaceOptions = SEARCH_SURFACE_FILTER_VALUES.map((value: SearchSurfaceFilter) => ({
    value,
    // `both` 不在 `webmasterData.surfaces` 里（那张表只有两个真面）⇒ 单独一个键。
    label:
      value === 'both'
        ? t('webmasterData.filters.bothSurfaces')
        : enumLabel(t, 'webmasterData.surfaces', value),
  }));
  const pivotOptions = SEARCH_PIVOT_DIMENSION_VALUES.map((value: SearchPivotDimension) => ({
    value,
    label: enumLabel(t, 'webmasterData.pivots', value),
  }));
  // `source_kinds: []` 在 compose 里的语义是"全部源"⇒ 全选时归一回空数组，
  // 否则"勾掉一个再勾回来"会留下一份与默认值语义相同、字面不同的筛选态。
  const checkedPlatforms =
    filter.source_kinds.length === 0 ? [...platformOptions] : [...filter.source_kinds];

  return (
    <Card size="small" title={t('webmasterData.aggregate.title')} style={{ marginBottom: 12 }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('webmasterData.aggregate.hint')}
      </Typography.Paragraph>

      <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
        <Space size={8} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.filters.time')}
          </Typography.Text>
          <DatePicker.RangePicker
            size="small"
            allowEmpty={[true, true]}
            presets={presets}
            value={[
              filter.from === null ? null : dayjs(filter.from),
              filter.to === null ? null : dayjs(filter.to),
            ]}
            onChange={(_dates, text) =>
              onFilterChange({
                ...filter,
                from: text[0] === '' ? null : text[0],
                to: text[1] === '' ? null : text[1],
              })
            }
          />
        </Space>
        <Space size={8} wrap align="start">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.filters.platform')}
          </Typography.Text>
          <Checkbox.Group
            options={platformOptions.map((kind) => ({ value: kind, label: labelOf(kind) }))}
            value={checkedPlatforms}
            onChange={(checked) => {
              const kinds = checked.map((value) => String(value) as SearchSourceKind);
              // `source_kinds: []` 在 compose 里表示“全部源”。取消最后一个勾选不能传 []，
              // 否则界面会瞬间跳回全选——至少保留一个源，才表达得出“只看某几个”。
              if (kinds.length === 0) return;
              onFilterChange({
                ...filter,
                source_kinds: kinds.length === platformOptions.length ? [] : kinds,
              });
            }}
          />
        </Space>
        <Space size={8} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.filters.surface')}
          </Typography.Text>
          <Radio.Group
            size="small"
            optionType="button"
            options={surfaceOptions}
            value={filter.surface}
            onChange={(event) =>
              onFilterChange({ ...filter, surface: event.target.value as SearchSurfaceFilter })
            }
          />
        </Space>
        <Space size={8} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.filters.dimension')}
          </Typography.Text>
          <Radio.Group
            size="small"
            optionType="button"
            options={pivotOptions}
            value={filter.pivot}
            onChange={(event) =>
              onFilterChange({ ...filter, pivot: event.target.value as SearchPivotDimension })
            }
          />
        </Space>
      </Space>

      {/* 🔴 恰好四格（`aggregate.*` 词典也只有这四个键）：AI 面的点击率在**第 3 段**
          单独给（分母是引用量），在这里再摆一格就会与它同名不同值。 */}
      <Row gutter={[16, 8]} style={{ marginBottom: 8 }}>
        <Col xs={12} md={4}>
          <Total label={t('webmasterData.aggregate.impressions')} value={countText(aggregate.impressions)} />
        </Col>
        <Col xs={12} md={4}>
          <Total label={t('webmasterData.aggregate.clicks')} value={countText(aggregate.clicks)} />
        </Col>
        <Col xs={12} md={4}>
          <Total label={t('webmasterData.aggregate.citations')} value={nullableCountText(aggregate.citations)} />
        </Col>
        <Col xs={12} md={4}>
          <Total label={t('webmasterData.aggregate.ctr')} value={ratioText(aggregate.ctr)} />
        </Col>
      </Row>

      {/* 🔴 常驻：汇总点击率是重算值（走查 13 要手工验算的就是这一条）。 */}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('webmasterData.aggregate.ctrNote')}
      </Typography.Paragraph>

      {aggregate.window.start === null || aggregate.window.end === null ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {aggregate.participants.length === 0
            ? t('webmasterData.aggregate.participatingEmpty')
            : t('webmasterData.aggregate.windowEmpty')}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t(aggregate.window.note_key, {
            nsSeparator: false,
            start: aggregate.window.start,
            end: aggregate.window.end,
            source: labelsOf(aggregate.window.limited_by),
          })}
        </Typography.Text>
      )}

      <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 8 }}>
        {aggregate.flags.map((flag) => (
          <Typography.Text key={flag.flag} type={FLAG_TYPES[flag.flag]} style={{ fontSize: 12 }}>
            {textOf(flag)}
          </Typography.Text>
        ))}
      </Space>

      <div style={{ marginTop: 8 }}>
        <Button
          size="small"
          type="link"
          style={{ paddingInline: 0 }}
          onClick={() => setShowParticipants((previous) => !previous)}
        >
          {t('webmasterData.aggregate.participatingToggle')}
        </Button>
        {showParticipants ? (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('webmasterData.aggregate.participating', {
                total: aggregate.participants.length,
              })}
            </Typography.Text>
            {aggregate.participants.map((row) => (
              <Space key={row.source_kind} size={4} wrap>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('webmasterData.aggregate.participatingLine', {
                    source: labelOf(row.source_kind),
                    through: row.data_through,
                    completeness: enumLabel(t, 'webmasterData.completeness', row.completeness),
                  })}
                </Typography.Text>
                {/* 区间是谁声明的（DR-109）：百度那份导出没有日期列 ⇒ 只能写"导入时确认"。 */}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {enumLabel(t, 'webmasterData.windowSources', row.window_source)}
                </Typography.Text>
              </Space>
            ))}
          </Space>
        ) : null}
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        {t('webmasterData.surfaceNote')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {t('webmasterData.filters.recomputeHint')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {t('webmasterData.filters.stateNote')}
      </Typography.Paragraph>
    </Card>
  );
}

/**
 * A 类求和的显示形。🔴 `0` 显示成 `—`：compose 的求和把 `null`（"平台没给这一列"）当跳过，
 * 一个都没给时结果就是 0，而 DR-94 明令"没有这一列"与"这一列是 0"是两个结论。
 * 代价是 AI 面真的引用量为 0 时也显示 `—`——比反过来（把"没这列"显示成 0）好。
 */
function nullableCountText(value: number): string {
  return value === 0 ? '—' : countText(value);
}

/** B 类重算比率的显示形：`null` = 分母为 0，算不出来（不是 0%）。 */
function ratioText(value: number | null): string {
  return value === null ? '—' : percentText(value);
}
