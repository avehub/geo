import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { TrendPoint } from '../api/types';

/**
 * 环比趋势折线图（M5 视图 2）。
 *
 * # 🔴 为什么是手写 SVG，不是 echarts / antd charts
 * 两条理由，都是硬的：
 * 1. **测试环境**：门禁在 jsdom 下跑，jsdom 没有 canvas，任何基于 canvas 的图表库在
 *    页面测试里要么抛错要么静默画不出东西 ⇒「渲染出趋势」这条断言就没法写；
 * 2. **依赖面**：为一个两点一线的折线图引一个图表库，与 AGENTS「不要在 demo 里顺手实现
 *    注定要重写的东西」同向的取舍反过来也成立——不要为了 demo 引一个桌面端也要背的依赖。
 * SVG 是 DOM，`getByText` / `querySelectorAll('polyline')` 直接可断言。
 *
 * # 口径
 * 两条线共用 0~100 的纵轴：Brand Coverage 是 0~1 的比率（乘 100 显示），体检总分本来就是
 * 0~100。**不做任何插值或平滑**（AGENTS 规则 9 的同族纪律：图上每个点都是后端给的静态值），
 * 点少于 2 个时就画点不画线。
 */
const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 52;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
const COVERAGE_COLOR = '#1677ff';
const SCORE_COLOR = '#52c41a';
const AXIS_COLOR = '#d9d9d9';

/** 0~100 的值 → y 坐标。 */
function yOf(value: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  return PAD_TOP + PLOT_HEIGHT - (clamped / 100) * PLOT_HEIGHT;
}

/** 第 index 个点（共 total 个）→ x 坐标；只有一个点时放在绘图区中间。 */
function xOf(index: number, total: number): number {
  if (total <= 1) return PAD_LEFT + PLOT_WIDTH / 2;
  return PAD_LEFT + (index / (total - 1)) * PLOT_WIDTH;
}

function polyline(values: number[], total: number): string {
  return values.map((value, index) => `${xOf(index, total)},${yOf(value)}`).join(' ');
}

export default function TrendChart({ points }: { points: TrendPoint[] }) {
  const { t } = useTranslation();

  if (points.length === 0) {
    return <Typography.Text type="secondary">{t('diagnosis.trend.empty')}</Typography.Text>;
  }

  const coverage = points.map((point) => point.brand_coverage * 100);
  const scores = points.map((point) => point.total_score);
  const gridlines = [0, 25, 50, 75, 100];

  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
        height={VIEW_HEIGHT}
        role="img"
        aria-label={t('diagnosis.trend.title')}
      >
        {gridlines.map((value) => (
          <g key={value}>
            <line
              x1={PAD_LEFT}
              x2={VIEW_WIDTH - PAD_RIGHT}
              y1={yOf(value)}
              y2={yOf(value)}
              stroke={AXIS_COLOR}
              strokeWidth={1}
            />
            <text x={4} y={yOf(value) + 4} fontSize={10} fill="#8c8c8c">
              {value}
            </text>
          </g>
        ))}

        {points.length > 1 && (
          <>
            <polyline
              points={polyline(coverage, points.length)}
              fill="none"
              stroke={COVERAGE_COLOR}
              strokeWidth={2}
            />
            <polyline
              points={polyline(scores, points.length)}
              fill="none"
              stroke={SCORE_COLOR}
              strokeWidth={2}
            />
          </>
        )}

        {points.map((point, index) => (
          <g key={point.round_id}>
            <circle cx={xOf(index, points.length)} cy={yOf(coverage[index])} r={4} fill={COVERAGE_COLOR}>
              <title>{`${t('diagnosis.trend.coverage')}: ${Math.round(coverage[index])}%`}</title>
            </circle>
            <circle cx={xOf(index, points.length)} cy={yOf(scores[index])} r={4} fill={SCORE_COLOR}>
              <title>{`${t('diagnosis.trend.totalScore')}: ${Math.round(scores[index])}`}</title>
            </circle>
            {/* 轮次名是数据（中文），en 界面下照旧显示中文——与表格里的数据列同口径。 */}
            <text
              x={xOf(index, points.length)}
              y={VIEW_HEIGHT - PAD_BOTTOM + 18}
              fontSize={10}
              fill="#595959"
              textAnchor="middle"
            >
              {point.round_label}
            </text>
            <text
              x={xOf(index, points.length)}
              y={VIEW_HEIGHT - PAD_BOTTOM + 34}
              fontSize={10}
              fill="#8c8c8c"
              textAnchor="middle"
            >
              {`±${Math.round(point.coverage_margin * 100)}%`}
            </text>
          </g>
        ))}
      </svg>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        <span style={{ color: COVERAGE_COLOR }}>■</span> {t('diagnosis.trend.coverage')}
        {'  '}
        <span style={{ color: SCORE_COLOR }}>■</span> {t('diagnosis.trend.totalScore')}
        {'  '}
        {t('diagnosis.trend.note')}
      </Typography.Paragraph>
    </div>
  );
}
