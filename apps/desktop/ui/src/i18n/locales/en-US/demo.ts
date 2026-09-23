import type { ResourceBundle } from '../../resources';

/**
 * 演示模式（非 Tauri 运行时）的界面文案：`demo.banner`（横幅）+ `demo.secretNoKeychain`（密钥区提示）。
 * 键集必须与 zh-CN 侧完全一致（R-G / R-J）：标注留着，缺键/多键在 `tsc -b` 就红。
 */
const demo: ResourceBundle['demo'] = {
  banner: 'Demo mode: static seed data, resets on reload, and does not reflect real algorithm results.',
  // 与 zh-CN 同批新增（#23）：demo 的 secret_set 连内存都不存 Key，这句是如实描述。
  secretNoKeychain: 'Demo mode does not write to the system keychain.',
};

export default demo;
