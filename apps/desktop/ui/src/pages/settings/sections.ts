/**
 * 设置页的分段清单、分段标签键与共享 props 类型（Plan B Task 2 · spec DR-27 / DR-28 / §6）。
 *
 * # 为什么单独一个数据模块
 * 与 `components/wizard-steps.ts` 同一个手法：**数据与组件分离**。分段清单要被三处消费
 * （`SettingsLayout` 的菜单、`SettingsPage` 的路由参数校验、守卫测试的"恰好 5 段"断言），
 * 抄三份就会漂；而模块级常量拿不到 `useTranslation()`，所以这里装的是**词典 key**（`SECTION_LABEL_KEYS`）
 * 而不是译文，类型标注 `TranslationKey` ⇒ 拼错的 key 在 `tsc -b` 就红。
 *
 * # 🔴 slug 而不是 index（DR-27）
 * 路由是 `/settings/:section`，取值是稳定 slug（`general` / `models` / …）。用 index
 * （`/settings/0`）的话，重排一次顺序就**静默错位**：`/settings/2` 仍然打得开，只是内容变成了
 * 另一段——界面不报错、门禁不红。与 `wizard-steps.ts` 头注释里那条既有教训同一个缺陷类。
 *
 * # 🔴 没有「扩展」这一段（产品负责人 2026-09-29 裁定 4）
 * skill 安装与导入、客服机器人整体推到二期。这里**不留**占位 slug：留一个点不动的入口
 * 比不出现更容易被走查的人当成缺陷（spec §2）。
 */
import type { AppSettings, ProviderInfo } from '../../api/types';
import type { TranslationKey } from '../../i18n/resources';

/** 左侧二级菜单的分段，数组顺序即界面顺序。 */
export const SETTINGS_SECTIONS = [
  'general',
  'models',
  'collection',
  'storage',
  'about',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `/settings` 与不认识的 `:section` 都回落到这一段（不白屏、不 404）。 */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general';

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** 分段名 → 词典键（zh：通用 / 模型服务商 / 采集与频控 / 数据与存储 / 关于）。 */
export const SECTION_LABEL_KEYS: Record<SettingsSection, TranslationKey> = {
  general: 'settings.sections.general',
  models: 'settings.sections.models',
  collection: 'settings.sections.collection',
  storage: 'settings.sections.storage',
  about: 'settings.sections.about',
};

/**
 * 自动保存的防抖窗口（DR-28）。
 *
 * 500ms 是"改完就看得见"与"每个字符都写一次库"之间的折中：`settings_update` 是**整包**写，
 * 连打三个字符就是三次整包往返。
 */
export const AUTO_SAVE_DEBOUNCE_MS = 500;

/**
 * 这一段是不是即时自动保存（DR-28）。
 *
 * - `general` / `collection` / `storage`：外观、语言、并发这类偏好要"点了就看得到"，
 *   多一个保存按钮只会被读成"没生效"；
 * - `models`：**显式保存**。接口地址与 Key 半包提交会冲掉别的段落（`settings_update` 整包写），
 *   而且"填一半就落库"会让连通性测试测到一个跑不通的配置。
 */
export function isAutoSaveSection(section: SettingsSection): boolean {
  return section === 'general' || section === 'collection' || section === 'storage';
}

/** 分段的保存态。`models` 用它渲染保存条；自动保存的三段用它渲染"正在保存"提示。 */
export interface SaveState {
  /** 有未落库的本地修改。 */
  dirty: boolean;
  saving: boolean;
  save: () => void;
  discard: () => void;
}

/** 五个分段组件的统一入参：数据、厂商预设、改草稿的入口、保存态。 */
export interface SectionProps {
  settings: AppSettings;
  providers: ProviderInfo[];
  /** 用**整包**覆盖草稿（不是 partial）：与 `settings_update` 的整包语义一致，避免半包提交。 */
  patch: (next: AppSettings) => void;
  saveState: SaveState;
}
