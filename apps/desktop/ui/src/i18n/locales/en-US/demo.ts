import type { ResourceBundle } from '../../resources';

/**
 * 演示模式（非 Tauri 运行时）的界面文案：`demo.banner`（横幅）+ `demo.aboutBody`（完整边界说明）。
 * 键集必须与 zh-CN 侧完全一致（R-G / R-J）：标注留着，缺键/多键在 `tsc -b` 就红。
 */
const demo: ResourceBundle['demo'] = {
  badge: 'Demo mode',
  shortBadge: 'DEMO',
  about: 'What does demo mode mean?',
  aboutBody:
    'This is a front-end-only demo: data is a static seed that resets on reload; collection, generation and publishing never reach real engines or a live site. Generated content comes from a preset corpus without a compliance scan, keys are not written to the system keychain, and schedules do not fire on their own.',
  banner: 'Demo mode: static seed data, resets on reload, and does not reflect real algorithm results.',
};

export default demo;
