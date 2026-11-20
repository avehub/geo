/**
 * 引擎接入状态的取数 hook（与 `EngineAccessModal` 分文件：组件文件只导出组件，
 * 否则 `react-refresh/only-export-components` 会报）。
 *
 * 只在弹窗打开时启（`enabled`）——采集页本身不该为了一个提示去读六次钥匙串。
 * 查询键与 `SecretStatusPanel` 相同（`['secret-status', provider]`），
 * 展开某一项时命中同一份缓存，不会多打一次 IPC。
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import * as client from '../api/client';
import { requiredProviders } from '../api/engine-access';
import type { EngineId } from '../api/types';

/** 钥匙串状态的可渲染投影：`undefined` = 还没查回来或读取失败。 */
export interface EngineAccessStatus {
  byProvider: Record<string, boolean | undefined>;
  loading: boolean;
  error: boolean;
  /** 「模型服务商」里当前选的对话模型（秘塔的回答要用它的 Key）。 */
  currentModelProvider: string | null;
}

export function useEngineAccessStatus(
  engines: readonly EngineId[],
  enabled: boolean,
): EngineAccessStatus {
  // 秘塔的「接入」不止搜索 Key：回答还用当前对话模型。只读一条设置，失败就当未知。
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => client.settingsGet(),
    enabled,
    retry: false,
  });
  const currentModelProvider = settingsQuery.data?.model.provider ?? null;
  const context = useMemo(() => ({ currentModelProvider }), [currentModelProvider]);
  const providers = useMemo(() => requiredProviders(engines, context), [engines, context]);
  const queries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ['secret-status', provider],
      queryFn: () => client.secretStatus(provider),
      enabled,
      // 与 `SecretStatusPanel` 同口径：背后是系统钥匙串，失败交给用户显式重试。
      retry: false,
    })),
  });

  return useMemo(() => {
    const byProvider: Record<string, boolean | undefined> = {};
    providers.forEach((provider, index) => {
      byProvider[provider] = queries[index]?.data?.configured;
    });
    return {
      byProvider,
      loading: queries.some((query) => query.isLoading),
      error: queries.some((query) => query.isError),
      currentModelProvider,
    };
  }, [providers, queries, currentModelProvider]);
}
