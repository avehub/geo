/**
 * `llm_models_list` 的内存实现（Plan B Task 4 · spec DR-34 / §8 / §10）。
 *
 * # 🔴 这条命令是 **demo 独有**的
 * Rust 侧本轮零改动（AGENTS 规则 8 的"两侧同时改"在这里表现为：命令进 `IPC_COMMANDS`
 * 与 `demoBackend`，桌面端的 `#[tauri::command]` 留给 Plan C）。点进桌面端会报
 * `ipc/unknown_command`，与 `app_environment` 及 M3–M7 那 20 条同一族（差异 E-46 起）。
 *
 * # 🔴 demo 不发请求（AGENTS 规则 2）
 * 真后端要做的是 `GET {base_url}/models`（OpenAI 兼容）或 `anthropic` 那套等价调用；
 * demo 端的是 `seed/model-catalogs.ts` 的预置清单，并把 `source` 标成 `'preset'`
 * ⇒ 界面据此上屏一句"演示模式不发请求，清单是预置数据"，走查的人不会把假数据当真结果。
 * 延迟照走 `withLatency`：浏览器里要看得见加载态（测试环境归零，见 `demo/latency.ts`）。
 *
 * # 🔴 错误口径复用**命令入参**那一支，一个错误码都不新增
 * `handlers/settings.ts` 的文件头写死了这条规矩：「前者走命令入参（`llm/config`），
 * 后者走表单字段校验（`validation/failed`），两个 code **绝不混用**」。
 * `llm_models_list` 收的是命令入参 ⇒ 认不出的 provider 与 `custom` 缺接口地址，
 * 都用 `llm/config`，且与 `llm_provider_test` **逐字同形**（同 code、同 reason、同 `value`）：
 * 同一个配置问题在两个按钮上必须给出同一句话，否则用户会以为是两回事。
 *
 * # 🔴 `api_key` 是**只进不出**的入参（AGENTS 规则 3）
 * 它可能被真后端拿去调上游（demo 忽略它），但绝不允许出现在：
 * ① 返回值；② 错误的 `params`；③ `demoError` 合成的 `message`（那个串逐字含全部 params）。
 * 三条都有显式断言（`.test.ts`），哨兵串一泄漏就红。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 这里只出现稳定记号与 ASCII。
 */
import type { ModelsListResult } from '../../api/types';
import { getDemoDb } from '../db';
import { withLatency } from '../latency';
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { SEED_MODEL_CATALOGS } from '../seed/model-catalogs';
import { asString, cleanOptional } from './shared';
import { CUSTOM_PROVIDER, requireKnownProvider } from './settings';

/** 浏览器里的假延迟（测试环境归零）：让「拉取模型列表」的加载态看得见。 */
const MODELS_LIST_LATENCY_MS = 420;

export const llmModelsList: DemoHandler = async (args) => {
  const db = getDemoDb();
  // ① 认不出的厂商 ⇒ `llm/config` + `unknown_provider`（与 `llm_provider_test` 同一支）。
  const provider = requireKnownProvider(db, asString(args.provider));

  // ② `custom` 没有预设地址可用（种子里它是空串），所以接口地址必填。
  //    reason 用 `missing_base_url` 而不是 `validation/failed`：见文件头那条规矩。
  if (provider === CUSTOM_PROVIDER && cleanOptional(args.base_url) === null) {
    throw demoError('llm/config', { reason: 'missing_base_url', value: provider });
  }

  await withLatency(MODELS_LIST_LATENCY_MS);

  // ③ `custom` 落到 `?? []`：用户填的是他自己的网关，demo 又不去访问它 ⇒ 回空清单，
  //    界面据此给一句"请直接手输模型名"，而不是一个静默的空下拉。
  const result: ModelsListResult = {
    models: structuredClone(SEED_MODEL_CATALOGS[provider] ?? []),
    source: 'preset',
  };
  return result;
};
