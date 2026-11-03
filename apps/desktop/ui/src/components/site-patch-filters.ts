import type { SiteChannelKind, SitePatch, SitePatchKind, SitePatchStatus } from '../api/types';

/**
 * 补丁台账的四个筛选（**展示层**，不进后端契约）。
 *
 * 🔴 为什么不给 `site_board` 加四个入参：一个项目的补丁是几十条量级，一次拿全再筛
 * 比把展示偏好写进 IPC 契约省一整圈往返（照 `KeywordLibraryPage` / `PromptSetPage` 的既有裁定）。
 * `'all'` 是稳定 ASCII 记号而不是展示文案：它同时充当 `Select` 的 `value`，
 * 拿中文当 value 的话 en 界面下筛选状态里仍是一个中文串（`FaqLibraryPage` 的 `UNCATEGORIZED` 同一条理由）。
 */
export interface SitePatchFilters {
  status: SitePatchStatus | 'all';
  kind: SitePatchKind | 'all';
  channel: SiteChannelKind | 'all';
  /** 落点或标题的子串（大小写不敏感）。 */
  search: string;
}

export const ALL_SITE_PATCH_FILTERS: SitePatchFilters = {
  status: 'all',
  kind: 'all',
  channel: 'all',
  search: '',
};

/** 按四个筛选过滤台账；顺序原样保留（`db.ts` 的 `position ASC` 已经排好了）。 */
export function filterSitePatches(
  rows: readonly SitePatch[],
  filters: SitePatchFilters,
): SitePatch[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.kind !== 'all' && row.kind !== filters.kind) return false;
    if (filters.channel !== 'all' && row.channel_kind !== filters.channel) return false;
    if (needle === '') return true;
    return (
      row.title.toLowerCase().includes(needle) || row.target_url.toLowerCase().includes(needle)
    );
  });
}
