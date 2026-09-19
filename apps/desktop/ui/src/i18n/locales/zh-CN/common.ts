/**
 * 跨页面复用的通用动作与兜底文案。
 *
 * `unknownError` 是 Task 7 的 `describeIpcError` 在"拿到的不是 IpcRequestError"时的兜底；
 * 文案只描述现象与下一步，不承诺结果（AGENTS.md 规则 6）。
 */
const common = {
  save: '保存',
  cancel: '取消',
  delete: '删除',
  confirm: '确认',
  search: '搜索',
  loading: '加载中…',
  unknownError: '操作未成功，请稍后重试',
};

export default common;
