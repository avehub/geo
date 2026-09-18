import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tauri 固定 devUrl=http://localhost:1420，端口不可改。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 向导类测试要跑完 5 步表单交互；antd 表格在 jsdom 下一次渲染 20 行 ×
    // 每行两个 InputNumber 也很慢。实测单个用例空机 2~5s、机器有负载时能到 27s，
    // 25s 会在门禁里偶发超时，因此给到 60s（不是掩盖卡死：空机跑远低于此）。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: [r('./src/test/setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    alias: {
      // 测试环境把 Tauri 的 invoke 换成可编程 mock，组件与 api 层无感知。
      '@tauri-apps/api/core': r('./src/test/invoke-mock.ts'),
    },
  },
});
