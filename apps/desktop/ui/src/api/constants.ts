/**
 * 与后端共享的常量。改这里必须同步改 `crates/geo-domain/src/csv_io.rs`，
 * 否则导入会因表头校验失败而整批被拒。
 */

/** 对应 Rust `PROMPT_CSV_HEADER`。 */
export const PROMPT_CSV_HEADER = [
  'text',
  'intent',
  'weight',
  'group_name',
  'tags',
  'source',
  'repeat_count',
] as const;

/** 对应 Rust `COMPETITOR_CSV_HEADER`。 */
export const COMPETITOR_CSV_HEADER = ['name', 'aliases', 'website', 'note', 'position'] as const;

/** 对应 Rust `ASSET_CSV_HEADER`。 */
export const ASSET_CSV_HEADER = ['kind', 'url', 'title', 'note'] as const;

/** 对应 Rust `SUFFICIENT_SAMPLE_SIZE`。 */
export const SUFFICIENT_SAMPLE_SIZE = 60;
/** 对应 Rust `MINIMUM_SAMPLE_SIZE`。 */
export const MINIMUM_SAMPLE_SIZE = 30;
