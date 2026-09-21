/**
 * `secret_set` / `secret_status` / `secret_delete` 三条的内存实现（Task 14 · 简报 §A-5）。
 * 真值源 `apps/desktop/src-tauri/src/services/settings_service.rs:151-190`（下称 service）。
 *
 * # 🔴 AGENTS 规则 3 在 demo 里的落法：**比真后端更强**
 * 真后端把 Key 写进系统钥匙串，库里只存 `secret_ref` 引用串；demo 的库形状就是
 * `SecretStatus[]`（`{provider, configured, secret_ref}`，**没有值字段**）⇒
 * `secret_set` 校验完 provider 与非空之后**把值丢掉**，只把那条的 `configured` 翻成 `true`。
 * 于是「密钥泄漏」这条路在 demo 里是**结构性不存在**的：连内存都不存
 * （真后端至少存进钥匙串）。错误 params 与日志里更是一个字符都不许出现用户填的 Key——
 * `demoError` 会把 params 拼进 `message`，所以 `value` 那个键只装 provider，绝不装 Key。
 *
 * ⚠ 计划正文还要求 UI 提示「演示模式不会写入系统钥匙串」：那句文案属 `i18n/**` 与 `pages/**`，
 * 本轮**禁改** ⇒ 归 Task 15（控制器台账已记）。
 *
 * # 三条语义照抄
 * - `set_secret`(:151-164)：先 `parse_provider`，再 `value.trim()`，**空则拒**
 *   `validation/failed` + `{field:'api_key', reason:'required'}`（两键）。
 *   🔴 `field` 逐字是 `api_key`：:155-157 注释「裁定 R-F 的**唯一例外**：`field` 从含糊的
 *   `value` 改成 `api_key`」⇒ 不要写成 `field:'value'`。
 * - `secret_status`(:167-180)：`configured` = 存在**且** `!value.trim().is_empty()`
 *   （**空白串算未配**）；返回体**永不回值**。
 * - `delete_secret`(:183-190)：**幂等**（删不存在的也返回 Ok）。
 *
 * # provider 认不出 ⇒ `llm/config`，不是 `validation/failed`
 * 判据复用 `./settings.ts` 的 `requireKnownProvider`（`parse_provider` 的替身）：
 * 与表单体检是同一份数据、只是 code 不同 ⇒ 不另写一份（依赖单向：secret → settings，
 * 对应 Rust 侧三者本来就是同一个 `SettingsService` 的方法）。
 *
 * # `secret_ref` 复用 `db.ts` 的 `demoSecretRef()`（Task 11 落地）
 * 与后端 `secret_ref(SECRET_KIND = "llm", provider)` 同形 ⇒ `keyring://llm/<provider>`，
 * 且**无论 configured 真假都返回这个 ref**（它只表示钥匙串里有没有值）。
 */
import type { SecretStatus } from '../../api/types';
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { demoSecretRef, getDemoDb } from '../db';
import { requireKnownProvider } from './settings';
import { asString } from './shared';

/**
 * `secret_set`：把「已配 Key」这个**事实**记下来，值本身丢掉（理由见文件头）。
 * 返回 `void`（真值源 `Result<(), IpcError>`）。
 */
export const secretSet: DemoHandler = (args) => {
  const db = getDemoDb();
  const provider = requireKnownProvider(db, asString(args.provider));

  // service:153-158：先 trim，空白就拒。🔴 这个 `value` 到这一行为止，往下不留一个字符。
  if (asString(args.value).trim() === '') {
    throw demoError('validation/failed', { field: 'api_key', reason: 'required' });
  }

  const existing = db.secrets.find((row) => row.provider === provider);
  if (existing === undefined) {
    // 种子里 7 条与预设表一一对应 ⇒ 正常走不到这一支；补一条只是不让写操作炸在 undefined 上
    // （§B-2③ 的收窄口径：demo 不自造「表里没有这一行」这种校验）。
    db.secrets.push({ provider, configured: true, secret_ref: demoSecretRef(provider) });
  } else {
    existing.configured = true;
  }
  return undefined;
};

/** `secret_status`：只回答「配没配」与「引用串是什么」，永不回值。 */
export const secretStatus: DemoHandler = (args) => {
  const db = getDemoDb();
  const provider = requireKnownProvider(db, asString(args.provider));
  const row = db.secrets.find((item) => item.provider === provider);

  // 交出去的是**新造的对象**（真值源也是现构造 `SecretStatus`），不是库里那一行。
  const status: SecretStatus = {
    provider,
    // service:170-174：存在且非空白才算已配；demo 不存值 ⇒ 「非空白」由 set 那一侧的 trim 保证。
    configured: row?.configured === true,
    secret_ref: demoSecretRef(provider),
  };
  return status;
};

/** `secret_delete`：幂等（service:183-190 是裸 delete，行不存在也 Ok）。返回 `void`。 */
export const secretDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const provider = requireKnownProvider(db, asString(args.provider));
  const row = db.secrets.find((item) => item.provider === provider);

  if (row !== undefined) {
    row.configured = false;
  }
  return undefined;
};
