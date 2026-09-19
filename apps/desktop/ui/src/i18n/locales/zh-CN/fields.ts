import type { EmptyNamespace } from '../../resources';

/**
 * 占位 namespace：本轮（Task 6）只建基座，文案由 Task 7（实体卡字段名，`fields.<field>`） 填入。
 *
 * 标注 `EmptyNamespace`（= `Record<string, never>`）意为「现在一个键都不许有」，
 * 因此**只填一侧**在 `tsc -b` 就会红（R-J）。填的时候把这个标注换成真实对象，
 * 并在 en-US 侧同步加同一批键。
 */
const fields: EmptyNamespace = {};

export default fields;
