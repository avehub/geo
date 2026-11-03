/**
 * `components/format.ts` 的纯函数测试。
 *
 * Plan B Task 5 先建这个文件，只覆盖 `bytesText`（数据与存储段要把 `db_size_bytes`
 * 显示成人类可读的量，而不是裸字节数）。Task 8 往这里补了 delta 口径统一的判据（裁定 3 / E-40）。
 *
 * 🔴 `bytesText` **不走词典**：`B` / `KB` / `MB` / `GB` 在两种语言里逐字相同，
 * 与 `3 个百分点` / `3 pp` 那种"单位词形状随语言变"的情况不同（那批必须走
 * `common.units.*`）。多造一个两侧同值的词条只会让"哪一类单位该进词典"这条口径变糊。
 */
import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import * as format from './format';
import {
  alertMetricUnit,
  bytesText,
  countText,
  dateText,
  dateTimeSecondsText,
  dateTimeText,
  metricDeltaText,
} from './format';
import { i18n } from '../i18n';

/** 语言切换用 `getFixedT`，不动全局单例（照 `api/errors.test.ts:33-34` 的先例）。 */
const zh = () => i18n.getFixedT('zh-CN');
const en = () => i18n.getFixedT('en-US');

describe('format · bytesText', () => {
  it('按 1024 进制换档，一位小数；< 1 KB 时给整数字节', () => {
    expect(bytesText(0)).toBe('0 B');
    expect(bytesText(1)).toBe('1 B');
    expect(bytesText(1023)).toBe('1023 B');
    expect(bytesText(1024)).toBe('1.0 KB');
    expect(bytesText(1536)).toBe('1.5 KB');
    expect(bytesText(1024 * 1024)).toBe('1.0 MB');
    expect(bytesText(3_481_600)).toBe('3.3 MB');
    expect(bytesText(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(bytesText(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });

  it('🔴 不四舍五入成裸字节数，也不吐 NaN / Infinity（负数与非法值收敛成 0 B）', () => {
    // 判据本体：3.3 MB 而不是 3481600。裸字节数在设置页里既读不出量级，也会被走查的人
    // 当成"某个 id"。
    expect(bytesText(3_481_600)).not.toBe('3481600');
    expect(bytesText(3_481_600)).not.toContain('3481600');

    expect(bytesText(-1)).toBe('0 B');
    expect(bytesText(Number.NaN)).toBe('0 B');
    expect(bytesText(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('输出恒为 ASCII（要直接上屏，也会被 en-US 整页残留判据扫到）', () => {
    for (const bytes of [0, 512, 4096, 3_481_600, 9_000_000_000]) {
      expect(bytesText(bytes)).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

/**
 * 🔴 delta 口径统一到**百分点**（Plan B Task 8 · 裁定 3 / 差异台账 E-40）。
 *
 * # 统一之前是什么样
 * `AlertItem.delta` 装 0~1 的**比率**（`-0.14` = 降 14 个百分点），`ReportMetricBlock.delta`
 * 装**百分点**（`13` = +13 个百分点）⇒ `format.ts` 里必须由 `alertDeltaText` 与
 * `metricDeltaText` 两个函数分别处理，同一个"降 14 个点"在 M5 与 M7 两侧要各写一遍口径。
 * 产品负责人 2026-09-29 裁定：**需要统一**；方向取百分点（`ReportMetricBlock` 那侧的口径，
 * 也是 `AlertItem.delta` 注释里本来就写着的那一个）。
 *
 * # 判据为什么是"旧函数不再被导出"
 * 只改种子数字、把 `alertDeltaText` 留在原地，等于口径没统一：下一个消费方仍会挑到那个
 * 乘 100 的版本，同一个数字又会放大 100 倍。所以这条断言钉的是**导出面**，不是行为。
 */
describe('format · delta 口径统一（裁定 3 / E-40）', () => {
  it('percent 的 delta 就是百分点，count 就是条数，score 原样带符号', () => {
    expect(metricDeltaText(zh(), 'percent', 13)).toBe('+13 个百分点');
    expect(metricDeltaText(zh(), 'percent', -3)).toBe('-3 个百分点');
    expect(metricDeltaText(zh(), 'count', -12)).toBe('-12 条');
    expect(metricDeltaText(zh(), 'count', 9)).toBe('+9 条');
    expect(metricDeltaText(zh(), 'score', 4)).toBe('+4');
  });

  it('🔴 `alertDeltaText` 不再被导出（留着旧函数就等于口径没统一）', () => {
    expect(Object.keys(format)).not.toContain('alertDeltaText');
    // 防空跑：这个模块确实导出了东西，否则上一条对空模块也永真。
    expect(Object.keys(format)).toContain('metricDeltaText');
    expect(Object.keys(format)).toContain('alertMetricUnit');
  });

  it('告警指标 → 单位：只有事实错误数按"条"，其余都按百分点（原来那支乘 100 的逻辑搬到这里）', () => {
    expect(alertMetricUnit('fact_error_count')).toBe('count');
    for (const metric of ['brand_coverage', 'negative_rate', 'share_of_voice']) {
      expect(alertMetricUnit(metric), metric).toBe('percent');
    }
    // 契约外的记号按百分点处理：比率类是多数派，猜错方向的代价（少乘 100）比反过来小，
    // 而且 `AlertItem.metric` 在 DTO 里就是 `string`，没有编译期白名单可依赖。
    expect(alertMetricUnit('something_new')).toBe('percent');
  });

  it('en 侧同一口径：变的是单位词，不是数字', () => {
    expect(metricDeltaText(en(), 'percent', 13)).toBe('+13 pp');
    expect(metricDeltaText(en(), 'count', -12)).toBe('-12 items');
  });
});

/**
 * 条数 / 日期的**单一口径**（P3 体验切片 A）。
 *
 * # 为什么必须收敛到一个 helper
 * `KeywordTable` 用裸 `toLocaleString()`（跟随运行环境的默认 locale，中文 Windows 与
 * 英文 macOS 会给出不同的分组符），`CollectionPage` / `OverviewStationCard` 各写一份
 * `toLocaleString('en-US')`，`ProjectTable` / `RevisionTimeline` 各写一份
 * `dayjs(...).format(...)` 且精度不同。四份实现的注释都声称"同口径"，实际是四个漂移面。
 */
describe('format · countText', () => {
  it('固定 en-US 千分位，不跟随运行环境 locale', () => {
    expect(countText(0)).toBe('0');
    expect(countText(7)).toBe('7');
    expect(countText(1234)).toBe('1,234');
    expect(countText(1_234_567)).toBe('1,234,567');
  });

  it('非有限值收敛成 0（照 `bytesText` 的口径，不吐 NaN / Infinity）', () => {
    expect(countText(Number.NaN)).toBe('0');
    expect(countText(Number.POSITIVE_INFINITY)).toBe('0');
    expect(countText(Number.NEGATIVE_INFINITY)).toBe('0');
  });

  it('只做分组，不改数值：不做取整也不改小数位', () => {
    expect(countText(1234.5)).toBe('1,234.5');
  });
});

describe('format · 日期文本', () => {
  it('`dateText` 只到天：`YYYY-MM-DD`', () => {
    expect(dateText('2026-09-16T02:18:45.123Z')).toBe(
      dayjs('2026-09-16T02:18:45.123Z').format('YYYY-MM-DD'),
    );
    expect(dateText('2026-09-16T02:18:45.123Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('`dateTimeSecondsText` 到秒：`YYYY-MM-DD HH:mm:ss`', () => {
    expect(dateTimeSecondsText('2026-09-16T02:18:45.123Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('🔴 null 一律空串（不吐 "Invalid Date"、也不落成 1970）', () => {
    expect(dateText(null)).toBe('');
    expect(dateTimeSecondsText(null)).toBe('');
    expect(dateTimeText(null)).toBe('');
  });

  it('三档精度同源：同一天、同一分钟，只是截断粒度不同', () => {
    const iso = '2026-09-16T02:18:45.123Z';
    const day = dateText(iso);
    const minute = dateTimeText(iso);
    const second = dateTimeSecondsText(iso);
    expect(minute.startsWith(day)).toBe(true);
    expect(second.startsWith(minute)).toBe(true);
    expect(second.length).toBe(minute.length + 3);
  });
});

/**
 * 组件层不得各写一份（判据是**源码里不再出现**那些裸调用）。
 *
 * 光有 helper 的单测救不了漂移：组件继续用自己的 `toLocaleString()` / `dayjs().format()`
 * 时，helper 测试照样全绿。这里把六个消费方的源码抓出来做缺席断言。
 */
describe('format · 单一口径（组件里不再各写一份）', () => {
  const INLINE = import.meta.glob(
    [
      './KeywordTable.tsx',
      './ArticleTemplateTable.tsx',
      './ProjectTable.tsx',
      './RevisionTimeline.tsx',
      './OverviewStationCard.tsx',
      '../pages/CollectionPage.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  it('扫描面非空且覆盖六个消费方（防 glob 空跑）', () => {
    expect(Object.keys(INLINE)).toHaveLength(6);
  });

  it('千分位只走 `countText`：没有裸 `toLocaleString`', () => {
    for (const [file, source] of Object.entries(INLINE)) {
      expect(source, file).not.toMatch(/toLocaleString/);
    }
  });

  it('日期格式只走 `dateText` / `dateTimeSecondsText`：没有裸 `dayjs`', () => {
    for (const [file, source] of Object.entries(INLINE)) {
      expect(source, file).not.toMatch(/from 'dayjs'/);
    }
  });
});
