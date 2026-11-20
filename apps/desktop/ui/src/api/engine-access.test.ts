/**
 * 引擎接入映射的守卫（纯函数，不碰 IPC）。
 *
 * 这张表是「哪个引擎要配哪把 Key / 要不要扫码」的**唯一真值源**：采集页的接入弹窗、
 * 排一轮采集的预检、失败任务的「去接入」入口都查它。它必须与后端
 * `services/collection_service.rs` 的 `engine_provider` + `engine_bundle` 对齐——
 * 写错一个 provider，界面会显示「已接入」而真正采集仍然 `login_required`，
 * 正是这次报障的形态（豆包失败提示需要登录、界面却没有入口）。
 */
import { describe, expect, it } from 'vitest';

import {
  ENGINE_ACCESS,
  engineAccessState,
  enginesNeedingSetup,
  loginRequiredEngines,
  requiredProviders,
  type EngineAccessState,
} from './engine-access';
import { ENGINE_VALUES, type EngineId } from './types-collection';

/** 后端 `engine_provider()` / `engine_bundle()` 的镜像：引擎 → 必须配好的钥匙串 provider。 */
const BACKEND_REQUIREMENTS: Record<EngineId, readonly string[]> = {
  doubao: ['volcengine_ark'],
  deepseek: ['deep_seek'],
  kimi: ['moonshot'],
  qwen: ['ali_bailian'],
  baidu_ai: ['baidu_qianfan'],
  metaso: ['metaso'],
  yuanbao: [],
};

function statuses(rows: Record<string, boolean | undefined>) {
  return (provider: string): boolean | undefined => rows[provider];
}

describe('ENGINE_ACCESS · 与后端引擎装配对齐', () => {
  it('7 家引擎一个不多一个不少', () => {
    expect(Object.keys(ENGINE_ACCESS).sort()).toEqual([...ENGINE_VALUES].sort());
  });

  it.each(ENGINE_VALUES)('%s 需要的 Key 与后端装配一致', (engine) => {
    expect(ENGINE_ACCESS[engine].providers).toEqual(BACKEND_REQUIREMENTS[engine]);
  });

  it('只有元宝走浏览器扫码，其余走 API Key', () => {
    for (const engine of ENGINE_VALUES) {
      expect(ENGINE_ACCESS[engine].kind).toBe(engine === 'yuanbao' ? 'browser_login' : 'api_key');
    }
  });
});

describe('engineAccessState', () => {
  it('所需 Key 全部已配置 ⇒ ready', () => {
    expect(engineAccessState('doubao', statuses({ volcengine_ark: true }))).toBe<EngineAccessState>('ready');
  });

  it('任意一把 Key 未配置 ⇒ needs_setup（秘塔不止一把也一样）', () => {
    expect(engineAccessState('kimi', statuses({ moonshot: false }))).toBe<EngineAccessState>('needs_setup');
  });

  it('状态还没回来 ⇒ unknown，不冒充「已接入」也不冒充「未配置」', () => {
    expect(engineAccessState('qwen', statuses({}))).toBe<EngineAccessState>('unknown');
  });

  it('已确认缺一把时，另一把未知也仍然算 needs_setup', () => {
    expect(engineAccessState('metaso', statuses({ metaso: false }))).toBe<EngineAccessState>('needs_setup');
  });

  it('秘塔还要当前对话模型的 Key：只配了搜索 Key 仍算 needs_setup', () => {
    expect(
      engineAccessState('metaso', statuses({ metaso: true, deep_seek: false }), {
        currentModelProvider: 'deep_seek',
      }),
    ).toBe<EngineAccessState>('needs_setup');
    expect(
      engineAccessState('metaso', statuses({ metaso: true, deep_seek: true }), {
        currentModelProvider: 'deep_seek',
      }),
    ).toBe<EngineAccessState>('ready');
  });

  it('拿不到当前模型厂商时只按搜索 Key 判（不因一条查不到就冒充未配置）', () => {
    expect(engineAccessState('metaso', statuses({ metaso: true }))).toBe<EngineAccessState>('ready');
  });

  it('元宝与 Key 状态无关：永远回 browser_login', () => {
    expect(engineAccessState('yuanbao', statuses({ volcengine_ark: true }))).toBe<EngineAccessState>('browser_login');
  });
});

describe('requiredProviders / enginesNeedingSetup', () => {
  it('按引擎顺序去重列出需要的 Key（元宝不贡献 Key）', () => {
    expect(requiredProviders(['doubao', 'yuanbao', 'kimi', 'doubao', 'metaso'])).toEqual([
      'volcengine_ark',
      'moonshot',
      'metaso',
    ]);
  });

  it('秘塔把当前对话模型也计入要查的钥匙串位（已列过就不重复）', () => {
    expect(
      requiredProviders(['metaso', 'deepseek'], { currentModelProvider: 'deep_seek' }),
    ).toEqual(['metaso', 'deep_seek']);
  });

  it('只报确认缺 Key 的引擎；未知状态不误报', () => {
    const rows = { volcengine_ark: false, moonshot: true };
    expect(enginesNeedingSetup(['doubao', 'kimi', 'qwen', 'yuanbao'], statuses(rows))).toEqual(['doubao']);
  });
});

describe('loginRequiredEngines', () => {
  const task = (engine: EngineId, status: string, reason: string | null) => ({
    engine,
    status,
    failure_reason: reason,
  });

  it('只取「失败 + login_required」的引擎，按出现顺序去重', () => {
    expect(
      loginRequiredEngines([
        task('doubao', 'failed', 'login_required'),
        task('kimi', 'failed', 'timeout'),
        task('doubao', 'failed', 'login_required'),
        task('yuanbao', 'failed', 'login_required'),
        task('qwen', 'succeeded', null),
      ]),
    ).toEqual(['doubao', 'yuanbao']);
  });

  it('没有登录失败时回空数组', () => {
    expect(loginRequiredEngines([task('metaso', 'failed', 'rate_limited')])).toEqual([]);
  });
});
