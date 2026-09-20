/**
 * 跨页面复用的通用动作与兜底文案。
 *
 * `unknownError` 是 Task 7 的 `describeIpcError` 在"拿到的不是 IpcRequestError"时的兜底；
 * 文案只描述现象与下一步，不承诺结果（AGENTS.md 规则 6）。
 *
 * Task 8 追加的键分两类：
 * - **跨 surface 复用**的（`edit` / `close` / `actions` / `invalidUrl` / `noteOptional` /
 *   `listSeparator`）：同一条指令在建项向导、竞品编辑器、两张表格里的措辞必须一致，
 *   分开放只会让"改一处忘三处"。
 * - **品牌名与副标题**（`appName` / `tagline`，裁定 B-3）：`appName` 的 **en 值就是同一个
 *   中文串**——专有名词不译。这样做的理由不是好看：Task 15 的残留扫描要求非测试、非
 *   locales 的源码里只剩注释含中文，把品牌名留在 `AppLayout.tsx` 里就得给扫描开白名单，
 *   而白名单是下一个静默洞。两侧值相同完全合法（键集相等断言只看键不看值）。
 */
const common = {
  save: '保存',
  cancel: '取消',
  delete: '删除',
  confirm: '确认',
  search: '搜索',
  loading: '加载中…',
  unknownError: '操作未成功，请稍后重试',

  appName: '稿得快 GEO',
  tagline: '生成式引擎优化 · 本地优先',

  edit: '编辑',
  close: '关闭',
  actions: '操作',
  invalidUrl: '请输入合法的 URL（含 http/https）',
  noteOptional: '备注（可选）',
  /** 列表连接符。zh 用顿号，en 用逗号——所以它必须是词条而不是代码里的字面量。 */
  listSeparator: '、',
};

export default common;
