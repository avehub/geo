/**
 * `export_write_file` 的浏览器实现（Task 14 · 简报 §A-1）。
 * 真值源 `apps/desktop/src-tauri/src/ipc/export.rs`（下称 export.rs）。
 *
 * # 🔴 这是一处**有意的运行时分叉**（计划正文逐字要求在本文件顶部写明原因）
 * 两侧约束**相反**：
 * - **桌面端**（`api/client.ts:330-341` 的注释逐字）：「导出**不能**用 `<a download href="blob:">`：
 *   macOS 的 WKWebView **不实现** blob 下载，点击后**静默失败**（spec FR-B2 因此要求走 dialog 插件）。
 *   CSV 传 `withBom = true`，Excel 打开中文才不乱码」⇒ 真后端弹「另存为」对话框、
 *   `tokio::fs::write` 落盘，返回**最终路径**（用户取消返回 `null`）。
 * - **浏览器端**（`mise run web` 的 demo 模式）：**恰恰只有 blob 可用**——没有 dialog 插件、
 *   没有文件系统，`URL.createObjectURL` + `<a download>` 是唯一能把内容交到用户手上的路。
 *
 * # 因此返回**文件名**而不是路径，且**永不返回 null**
 * 契约里 `null` 的语义是「用户在另存为对话框里点了取消」；浏览器下载**没有取消按钮**
 * ⇒ 那一支在 demo 里不存在。它仍由存量用例 `pages/ProjectListPage.test.tsx:208` 的
 * `stubAlways('export_write_file', () => null)` 在 invoke 层钉住（本轮禁改）。
 * ⚠ 三个调用点（`pages/ProjectListPage.tsx:73,90`、`components/CsvToolbar.tsx:83`）把返回值当
 * **路径**展示（词典 `prompt.csv.exported` = 「CSV 已导出：{{path}}」）⇒ demo 下会显示成
 * 「CSV 已导出：xxx-prompts.csv」这类样子，这是计划**接受**的（`i18n/**` 与 `pages/**` 本轮禁改）。
 *
 * # 🔴 BOM 由**这一层**补，且幂等（分工见下）
 * demo 的 `export_write_file` 是**写盘层**的替身 ⇒ 逐字镜像 export.rs:16-22 的 `export_body()`：
 * `if !with_bom || content.starts_with('\u{FEFF}') { return content; }`，否则前插一个 BOM
 * （export.rs 的测试 :95 `csv_export_prepends_bom_and_json_does_not()`、:101 `bom_is_never_doubled()`）。
 * ⚠ 与 `prompt-csv.ts` 的 `prompt_set_export_csv` **不加** BOM 并不矛盾：那一层是 **service 层**的替身，
 * 而 `prompt_service.rs:668-673` 专门把 `csv_io.rs:127` 加的 BOM **剥掉**（测试 :1217
 * `csv_export_has_no_bom_because_the_frontend_adds_one`）⇒ BOM 只在写盘层出现**一次**。
 *
 * # `revokeObjectURL` 的时机（裁定与理由见报告 §F-2）
 * `click()` 只是把下载请求交给浏览器，blob 的实际读取发生在**当前任务之后**的事件循环里；
 * 同步 revoke 会在部分浏览器把刚发起的下载掐断。⇒ 排到下一个宏任务（`REVOKE_DELAY_MS = 0`）：
 * 既保证请求已经入队，又不给用户留一个长期占内存的 blob URL。锚点本身点完立刻从 DOM 摘掉。
 *
 * # 运行环境不支持 blob 下载时
 * 抛**普通 `Error` + 英文开发者信息**（不是 `IpcErrorPayload`）：它给开发者看、不进词典、
 * **不占错误码**（`contracts/error-codes.json` 冻结在 43 条），经 `api/client.ts` 的 `callVia`
 * 归一化成 `ipc/invoke_failed`——与退休前那个 `notImplemented()` 占位同一条路。
 * 真浏览器里走不到这一支；jsdom 默认没有 `URL.createObjectURL` ⇒ 测试正好覆盖它。
 */
import type { DemoHandler } from '../types';
import { asBoolean, asString } from './shared';

/** UTF-8 BOM（与 export.rs 的 `'\u{FEFF}'` 同一个码位）。 */
const BOM = '\uFEFF';
/**
 * revoke 的推迟量：**0 也是推迟**（排到下一个宏任务），这就是裁定的全部要点——
 * 不在 `click()` 的同一个任务里释放。见文件头。
 */
const REVOKE_DELAY_MS = 0;
/**
 * blob 的 MIME。真后端写的是裸字节、由扩展名决定打开方式；浏览器这里给一个带 charset 的
 * 文本类型，直接在标签页里打开也不会乱码（BOM + charset 两道都对上）。
 */
const DOWNLOAD_MIME = 'text/plain;charset=utf-8';
/** 环境不支持时的开发者诊断串（英文、含命令名，便于在控制台一眼定位）。 */
const BLOB_UNSUPPORTED = 'export_write_file needs URL.createObjectURL, which this runtime lacks';

/** 逐字镜像 export.rs:16-22 的 `export_body()`：CSV 补 BOM，已带就**不双写**。 */
function exportBody(content: string, withBom: boolean): string {
  if (!withBom || content.startsWith(BOM)) {
    return content;
  }
  return `${BOM}${content}`;
}

/**
 * `export_write_file`：把已经算好的内容交给浏览器下载，回**文件名**。
 *
 * ⚠ 这一层不做任何序列化（AGENTS 规则 9）：`content` 是调用方（`prompt_set_export_csv` /
 * `project_export*`）已经拼好的成品，这里只管「补 BOM + 落地」。
 */
export const exportWriteFile: DemoHandler = (args) => {
  const defaultName = asString(args.default_name);
  const body = exportBody(asString(args.content), asBoolean(args.with_bom));

  // jsdom 与老 WebView 都没有这两个静态方法 ⇒ 宁可抛开发者诊断，也不发一个假的「已导出」。
  if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') {
    throw new Error(BLOB_UNSUPPORTED);
  }

  const objectUrl = URL.createObjectURL(new Blob([body], { type: DOWNLOAD_MIME }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  // 文件名整份来自调用方（词典渲染好的）：demo 不替用户编名字，空串就原样交给浏览器。
  anchor.download = defaultName;
  // 挂进 DOM 再点：Firefox 对游离锚点的 `download` 不生效。点完立刻摘掉，不在文档里留垃圾。
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_DELAY_MS);

  // 🔴 返回**文件名**（不是路径）、**永不为 null**：理由见文件头。
  return defaultName;
};
