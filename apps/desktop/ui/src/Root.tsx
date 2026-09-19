import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';

import App from './App';
import { antdLocale, applyDayjsLocale } from './i18n/antd-locale';
import { usePreferences } from './store/preferences';

// 桌面端单人使用，无需激进重试；失败交给 UI 显式提示。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
    mutations: { retry: 0 },
  },
});

/**
 * Provider 树（裁定 R-C）。
 *
 * 从 `main.tsx` 抽出来，是为了让 `ConfigProvider locale` **订阅** `usePreferences()`：
 * 在设置页切语言要立刻全站生效，而不是要求用户重启应用。`main.tsx` 只负责在挂载前
 * 把 i18n 初始化到持久化的语言，避免首帧闪一次中文。
 */
export default function Root() {
  const locale = usePreferences((state) => state.locale);

  // dayjs 是全局单例、没有 Context，antd 的日期组件直接拿它格式化（R-B）。
  // 放在渲染体里而不是 useEffect：effect 在绘制之后才跑，英文界面的首帧会闪一次中文月份。
  // 幂等且极廉价（`dayjs.locale(name)`），StrictMode 下重复渲染无副作用。
  //
  // ⚠ 护栏（Task 6b-E）：渲染期写全局的**前提**是 `Root` 不得被 `startTransition` / `Suspense`
  // 包住。这两种情况下 React 有权**丢弃**一次渲染，而 dayjs 这个全局单例不会跟着回滚，
  // 于是它会停在**未提交**的语言上（界面已切回中文、日期仍按英文格式化）。真要包进
  // transition/Suspense，就先把这行挪出去，改成「`main.tsx` 启动时调一次 + `setLocale` 里调一次」
  // ——那样渲染体保持纯净，代价是两处调用点（本轮刻意避开：两处更容易漏掉一处，
  // 而漏掉的那一处是静默的）。`useEffect` 不是替代方案，理由同上（首帧错语言，用户可见）。
  applyDayjsLocale(locale);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={antdLocale(locale)} theme={{ token: { borderRadius: 6 } }}>
        <AntdApp>
          <App />
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
