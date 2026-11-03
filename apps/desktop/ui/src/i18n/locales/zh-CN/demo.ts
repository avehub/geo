/**
 * 演示模式（非 Tauri 运行时，即 `mise run web` 打开的浏览器）的界面文案。
 *
 * 原先这里的 `EmptyNamespace` 标注（= `Record<string, never>`，意为「一个键都不许有」）已按
 * R-J 换成真实对象，en-US 侧在**同一次编辑**里加了同一批键（`ResourceBundle = typeof zhCN`，
 * 只填一侧 `tsc -b` 就红）。`resources.ts` 的 `EmptyNamespace` 导出保留不删——它是 R-J 的
 * 机制文档，Plan B/C 还可能用到（Task 10 简报 §A-4）。
 *
 * `banner` 的口径与 Task 15 要写进 README 的 demo 说明一致（AGENTS 规则 9）：
 * **演示模式** / 数据是**静态种子、刷新即重置** / **不代表真实算法结果**。
 * 横幅要一行读完，所以长文留给 README，不提前塞进来。
 */
const demo = {
  /** 32px 细条左侧的短标签（合规句 `banner` 仍常驻，不替代它）。 */
  badge: '演示模式',
  /** 细条左侧的短徽标（2026-10-30 二稿）：灰底小标签，不抢注意力。 */
  shortBadge: 'DEMO',
  about: '什么是演示模式？',
  aboutBody:
    '这是纯前端演示：数据是静态种子，刷新即重置；采集、发布与生成都不会触达真实引擎或线上站点。',
  banner: '演示模式：静态种子数据，刷新即重置，不代表真实算法结果。',
  /**
   * 密钥区的那句提示（计划正文 Task 14 的 Produces **逐字**要求：「演示模式不会写入系统钥匙串」）。
   *
   * 它是**如实描述**，不是免责声明：demo 的 `secret_set` 连内存都不存 Key——只把 `configured`
   * 翻成 `true`、值当场丢弃（`demo/handlers/secret.ts:53-62`，异常表 E-21，AGENTS 规则 3 的更强落法）。
   * 少了这句，用户在浏览器里粘一把真 Key 点保存，会以为它进了钥匙串。
   * 渲染点 `components/SecretStatus.tsx`，按 `api/runtime.ts` 的 `runtime` 条件出现：
   * 真桌面端确实写钥匙串，在那儿渲染它就是假话。
   */
  secretNoKeychain: '演示模式不会写入系统钥匙串',
};

export default demo;
