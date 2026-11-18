/**
 * 远程内容 12 条命令的 demo 实现（Task 9）。
 *
 * # 语义与真后端一致的三条
 * 1. **不联网**：demo 没有数据面，一律把种子数据当"内置快照"返回；
 * 2. **降级可见**：`source: 'builtin'` + `degraded: true`，界面据此展示"当前是内置版本"；
 * 3. **legal / notices 没有内置兜底**：返回 `source: 'none'` + `value: null`
 *    （真后端也是这个行为 —— 把可能过期的隐私政策编进客户端比"取不到"更危险）。
 *
 * # 与真后端的唯一差异（已登记）
 * `remote_sync` 在 demo 里恒回 `unavailable` + `error_code: 'demo'`：浏览器里没有数据面，
 * 假装同步成功会让"网络恢复后自动升级"这条路径在演示中不可见。
 *
 * # 语言约束
 * 本文件非注释 CJK 必须为 0 ⇒ 所有面向人的文案都在 `demo/seed/remote.ts`。
 */
import type { RemoteJsonItem, RemoteTextItem } from '../../api/types-remote';
import { demoError } from '../types';
import {
  REMOTE_BUILTIN_VERSIONS,
  REMOTE_COMPLIANCE,
  REMOTE_ENGINES,
  REMOTE_PRIVACY,
  REMOTE_PROVIDERS,
  REMOTE_RATE_LIMITS,
  REMOTE_RELEASE,
  REMOTE_RULEPACKS,
  REMOTE_RULEPACK_BAIDU,
  REMOTE_SEED_GENERATED_AT,
  REMOTE_TEMPLATES,
} from '../seed/remote';

const ACCEPTED_AT = REMOTE_SEED_GENERATED_AT;
const BUILTIN = 'builtin' as const;

function item(key: string, version: number, value: unknown): RemoteJsonItem {
  return {
    key,
    version,
    sha256: '',
    source: BUILTIN,
    accepted_at: ACCEPTED_AT,
    degraded: true,
    value,
  };
}

function versionOf(key: string): number {
  return REMOTE_BUILTIN_VERSIONS.find((entry) => entry.key === key)?.version ?? 1;
}

function noneItem(key: string): RemoteJsonItem {
  return {
    key,
    version: 0,
    sha256: '',
    source: 'none',
    accepted_at: null,
    degraded: true,
    value: null,
  };
}

export const remoteStatus = () => ({
  base_url: 'https://geo_api.gaodekuai.com/client/v1',
  public_key_configured: false,
  last_sync: null,
  items: [],
  builtin_versions: REMOTE_BUILTIN_VERSIONS.map((entry) => ({
    key: entry.key,
    version: entry.version,
    sha256: '',
    source: BUILTIN,
    accepted_at: ACCEPTED_AT,
  })),
  degraded: true,
});

export const remoteSync = () => ({
  status: 'unavailable',
  changed: [],
  failed: [],
  degraded: true,
  started_at: ACCEPTED_AT,
  finished_at: ACCEPTED_AT,
  error_code: 'demo',
});

export const remoteManifestGet = () => ({
  schema_version: 1,
  generated_at: ACCEPTED_AT,
  items: Object.fromEntries(
    REMOTE_BUILTIN_VERSIONS.map((entry) => [
      entry.key,
      { version: entry.version, sha256: '', source: BUILTIN, accepted_at: ACCEPTED_AT },
    ]),
  ),
});

export const remoteRulepackList = () => item('rulepacks', versionOf('rulepacks'), REMOTE_RULEPACKS);

export const remoteProviderPresets = () =>
  item('providers', versionOf('providers'), REMOTE_PROVIDERS);

export const remoteComplianceTerms = () =>
  item('compliance', versionOf('compliance'), REMOTE_COMPLIANCE);

export const remotePrivacyFacts = () => item('privacy', versionOf('privacy'), REMOTE_PRIVACY);

export const remoteLegalIndex = () => noneItem('legal');

export const remoteNoticeList = () => noneItem('notices');

export const remoteEndpointConfig = () => ({
  base_url: 'https://geo_api.gaodekuai.com/client/v1',
  default_base_url: 'https://geo_api.gaodekuai.com/client/v1',
  public_key_configured: false,
  timeout_secs: 10,
});

export const remoteRulepackGet = (args: Record<string, unknown>) => {
  const engineCode = typeof args.engine_code === 'string' ? args.engine_code : '';
  if (engineCode !== 'baidu_ziyan') {
    throw demoError('remote/not_found', { item: 'rulepack' });
  }
  return {
    ...item('rulepack:baidu_ziyan', 1, REMOTE_RULEPACK_BAIDU),
  };
};

export const remoteLegalGet = (args: Record<string, unknown>): RemoteTextItem => {
  const docId = typeof args.doc_id === 'string' ? args.doc_id : '';
  const locale = typeof args.locale === 'string' ? args.locale : 'zh-CN';
  if (!docId) {
    throw demoError('remote/not_found', { item: 'legal' });
  }
  return {
    key: `legal:${docId}:${locale}`,
    version: 0,
    sha256: '',
    source: 'none',
    accepted_at: null,
    degraded: true,
    title: null,
    text: null,
  };
};

// 供将来参考页使用的只读快照（未接线也保留，避免"数据在种子文件里但没人用"）。
export const REMOTE_HANDLER_SEED = {
  engines: REMOTE_ENGINES,
  rateLimits: REMOTE_RATE_LIMITS,
  templates: REMOTE_TEMPLATES,
  release: REMOTE_RELEASE,
};
