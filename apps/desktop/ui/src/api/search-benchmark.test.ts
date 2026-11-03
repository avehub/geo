/**
 * 外部 CTR 曲线的判据（DR-115：**凡引用外部数据一律标出处**，且**默认不参与判定**）。
 *
 * 🔴 这一份文件存在的理由就是"不能拿它当阈值"：四份主流研究对"排名第一的平均点击率"给的值
 * 差近一倍（22.4% / 28.5% / 31.73% / 45.35%），而且**全是英文 Google SERP**
 * ⇒ 拿这种曲线去判"这个页面的标题不行"，客户一查就穿。所以：
 * ① 每条都带机构名 + 年份 + 链接 + 转录日期（§5.2 第 15 条）；
 * ② `enabled_by_default` **恒为 `false`**（§7 变异 ⑥：改成 `true` 这里就红）；
 * ③ 主基准是站点自身同位次的分位数（`MINIMUM_SAMPLE_SIZE` 那条门槛），外部曲线只作冷启动参考带。
 */
import { describe, expect, it } from 'vitest';

import {
  SEARCH_CTR_BENCHMARKS,
  ctrReferenceBand,
  topOneSpread,
} from './search-benchmark';

describe('出处（DR-115 ①：机构名 + 年份 + 链接，一个都不许缺）', () => {
  it('四条曲线各是一家机构，source / url / as_of 都非空', () => {
    expect(SEARCH_CTR_BENCHMARKS).toHaveLength(4);
    const sources = SEARCH_CTR_BENCHMARKS.map((curve) => curve.source);
    expect(new Set(sources).size).toBe(4);
    for (const curve of SEARCH_CTR_BENCHMARKS) {
      expect(curve.source.trim(), '缺机构名').not.toBe('');
      expect(curve.year, '缺研究年份').toBeGreaterThan(2000);
      expect(curve.url.startsWith('https://'), `${curve.source} 的链接不是 https`).toBe(true);
      expect(curve.as_of, `${curve.source} 缺转录日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(curve.points.length, `${curve.source} 没有数据点`).toBeGreaterThan(0);
    }
  });

  it('数值与规格 DR-115 逐字对上（转录错了这里就红）', () => {
    const topOne = (source: string) =>
      SEARCH_CTR_BENCHMARKS.find((curve) => curve.source === source)?.points.find(
        (point) => point.position === 1,
      )?.ctr;
    expect(topOne('SISTRIX')).toBe(0.285);
    expect(topOne('Backlinko')).toBe(0.3173);
    expect(topOne('Semrush')).toBe(0.224);
    // AWR 分行业：2025Q1 桌面第一位，教育 45.35%、宠物 15.75%。
    const awr = SEARCH_CTR_BENCHMARKS.find((curve) => curve.source === 'Advanced Web Ranking');
    expect(awr?.points.map((point) => point.segment)).toEqual(['education', 'pets']);
    expect(awr?.points.map((point) => point.ctr)).toEqual([0.4535, 0.1575]);
  });

  it('🔴 全是英文 Google SERP 的传统搜索面（不能拿去判百度 / 头条 / AI 回答面）', () => {
    for (const curve of SEARCH_CTR_BENCHMARKS) {
      expect(curve.engine).toBe('google');
      expect(curve.surface).toBe('web_search');
    }
  });

  it('第一位的 CTR 差近一倍 —— 这就是"只作参考带、不作阈值"的物证', () => {
    expect(topOneSpread()).toBeGreaterThan(1.5);
  });
});

describe('默认不参与判定（DR-115 ③ / §7 变异 ⑥）', () => {
  it('每一条的 enabled_by_default 都是 false', () => {
    for (const curve of SEARCH_CTR_BENCHMARKS) {
      expect(curve.enabled_by_default, `${curve.source} 默认就参与判定了`).toBe(false);
    }
    // 类型层也钉一道：这个字段的类型就是字面量 `false`，写成 `true` 编译不过。
    const literal: false = SEARCH_CTR_BENCHMARKS[0].enabled_by_default;
    expect(literal).toBe(false);
  });

  it('设置里没开 ⇒ 参考带是空的（判定拿不到任何外部曲线）', () => {
    expect(ctrReferenceBand(false)).toEqual([]);
    expect(ctrReferenceBand(true)).toHaveLength(SEARCH_CTR_BENCHMARKS.length);
  });
});

describe('数据形状', () => {
  it('位次升序、点击率是 0~1 的比率（不是百分数）、位次从 1 起', () => {
    for (const curve of SEARCH_CTR_BENCHMARKS) {
      const positions = curve.points.map((point) => point.position);
      expect([...positions].sort((left, right) => left - right)).toEqual(positions);
      for (const point of curve.points) {
        expect(point.position).toBeGreaterThanOrEqual(1);
        expect(point.ctr).toBeGreaterThan(0);
        expect(point.ctr, `${curve.source} 的 ctr 像是百分数而不是比率`).toBeLessThan(1);
      }
    }
  });
});
