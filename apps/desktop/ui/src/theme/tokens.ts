/**
 * 视觉 token 的单一出口（2026-10-30 视觉重做 · 墨青驾驶舱）。
 *
 * # 为什么单独一层
 * `appearance.ts` 管「偏好 → 主题」的翻译，本轮之前它只写了两项（圆角 6 / 字号）。
 * 视觉重做要一次改动品牌色、语义色、控件高度、表格与菜单的组件 token，把这些值摊在
 * `themeConfigFor` 里会让「取值」和「算法选择」混成一团。这里只放**数据与纯函数**，
 * 且不碰 DOM——DOM 那一条（`colorScheme`）仍留在 `appearance.ts`，理由见那里的 DR-30 注释。
 *
 * # 🔴 不新增 CSS
 * 仓库有常驻守卫 `src/tailwind-sources.test.ts`：Tailwind 的扫描面与产物选择器集不许漂移。
 * 所以本轮所有视觉调整只能走 antd token / 组件 props / 内联样式，**不得**往 `index.css`
 * 里加类或选择器。数字等宽也一样：由 `components/ui/MetricText.tsx` 用内联
 * `fontVariantNumeric` 输出，而不是全局 `.ant-statistic-content { … }`。
 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

/** 品牌与语义色（亮色口径）。暗色只覆盖底色与文字，语义色沿用同一组色相。 */
export const BRAND = {
  // 2026-10-30 三稿：按产品负责人定的参照系（飞书）取色。
  primary: '#3370FF',
  primaryHover: '#4E83FD',
  primaryActive: '#245BDB',
  primaryBg: '#E1EAFF',
  ink: '#1F2329',
  // teal 仍只出现在图表分类色里，不参与界面。
  teal: '#0E7490',
  success: '#2EA121',
  warning: '#FF8800',
  danger: '#F54A45',
  info: '#3370FF',
} as const;

/** 亮色中性阶。图表与色板样张都从这里取，避免第二个「灰」。 */
export const NEUTRAL_LIGHT = {
  text: '#1F2329',
  textSecondary: '#646A73',
  // 飞书的占位灰是 #8F959E，但 12px 在白底只有 3.3:1；这里取同一色阶里能过 4.5:1 的灰。
  textTertiary: '#6B7280',
  border: '#DEE0E3',
  borderSecondary: '#EFF0F1',
  bgLayout: '#F5F6F7',
  bgContainer: '#FFFFFF',
  bgElevated: '#FFFFFF',
  tableHeader: '#F5F6F7',
  rowHover: '#F2F3F5',
} as const;

/** 暗色只换「表面」：底色压到墨蓝而不是纯黑，语义色保持同一色相以免状态含义漂移。 */
export const NEUTRAL_DARK = {
  text: '#E8EAED',
  textSecondary: '#A6ADB8',
  textTertiary: '#8A919C',
  border: '#2A3038',
  borderSecondary: '#22272E',
  bgLayout: '#0F1115',
  bgContainer: '#171A1F',
  bgElevated: '#1D2127',
  tableHeader: '#15181D',
  rowHover: '#1D2127',
} as const;

/** 图表分类色：与状态色分开，避免「红色既表示失败又表示某个引擎」。 */
export const CHART_PALETTE = [
  '#2A5BD7',
  '#0E7490',
  '#B45309',
  '#6D28D9',
  '#BE123C',
  '#64748B',
] as const;

/** 系统字体栈（与 `index.css` 的 body 一致；antd 用它保证组件内不回落成 Times）。 */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

/**
 * 偏好 → antd `ThemeConfig`。`fontSize` 由 `appearance.ts` 按字号档算好后传入，
 * 这里不重复维护 13/14/16 那张表（真值源只允许一处）。
 */
export function buildThemeConfig(dark: boolean, fontSize: number): ThemeConfig {
  const neutral = dark ? NEUTRAL_DARK : NEUTRAL_LIGHT;
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // 品牌
      colorPrimary: BRAND.primary,
      colorPrimaryHover: BRAND.primaryHover,
      colorPrimaryActive: BRAND.primaryActive,
      colorPrimaryBg: BRAND.primaryBg,
      colorLink: BRAND.primary,
      colorInfo: BRAND.info,
      colorSuccess: BRAND.success,
      colorWarning: BRAND.warning,
      colorError: BRAND.danger,
      // 表面与文字
      colorTextBase: neutral.text,
      colorText: neutral.text,
      colorTextSecondary: neutral.textSecondary,
      colorTextTertiary: neutral.textTertiary,
      colorBgBase: dark ? neutral.bgLayout : '#FFFFFF',
      colorBgLayout: neutral.bgLayout,
      colorBgContainer: neutral.bgContainer,
      colorBgElevated: neutral.bgElevated,
      colorBorder: neutral.border,
      colorBorderSecondary: neutral.borderSecondary,
      // 形状与节奏
      borderRadius: 6,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      fontSize,
      fontFamily: FONT_STACK,
      // 「舒适」密度的基线：36 的控件高 + 44 的表格行（表格行高由页面 size 控制）。
      // 2026-10-30 二稿：密度改为 48 —— 表格行 48、导航项 44、控件 40。
      // 按钮/输入不跟着上 48：48 的控件在桌面端会显得笨重，48 留给「行」。
      controlHeight: 40,
      controlHeightLG: 48,
      // 表格内的行内控件（标签选择 / 小按钮）用 24：48 − 24（上下各 12 的内边距）= 24。
      controlHeightSM: 24,
      motionDurationFast: '0.12s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.28s',
    },
    components: {
      Layout: {
        headerHeight: 48,
        headerPadding: '0 16px',
        siderBg: neutral.bgContainer,
        bodyBg: neutral.bgLayout,
      },
      Menu: {
        // 飞书的侧栏项是 40：与控件同高；48 留给表格行。
        itemHeight: 40,
        itemMarginBlock: 2,
        itemBorderRadius: 6,
        itemSelectedBg: BRAND.primaryBg,
        itemSelectedColor: BRAND.primary,
        itemHoverBg: neutral.rowHover,
        // 项目清单上方的「项目」是分组标签，不是菜单项：压低到 12px，和阶段组标题同级。
        groupTitleFontSize: 12,
        groupTitleLineHeight: '20px',
        groupTitleColor: neutral.textTertiary,
      },
      Table: {
        headerBg: neutral.tableHeader,
        rowHoverBg: neutral.rowHover,
        headerColor: neutral.textSecondary,
        headerSplitColor: 'transparent',
        // 14 + 20 行高 = 48，就是这一稿说的「密度 48」。
        cellPaddingBlock: 14,
      },
      Card: {
        paddingLG: 20,
      },
    },
  };
}
