/// <reference types="node" />
/**
 * `app_environment` 的契约测试（Plan B Task 3 · spec §8 / §10）。
 *
 * 三条靶心：
 * ① 返回形状**逐键**对上 `AppEnvironment`（多一个键少一个键都红）；
 * ② 权限三项在 demo 里**恒为 `unsupported`**——浏览器没有这些系统权限，回 `granted` 是假声明；
 * ③ 版本号与迁移数不是随手编的：分别钉在 `tauri.conf.json` 与 `crates/geo-store/migrations/`
 *    这两个真值源上（手法同 `test/truth-source.ts`）。
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appEnvironment, DEMO_APP_VERSION, DEMO_BUILD_NUMBER } from './app-environment';
import { resetDemoDb, getDemoDb } from '../db';
import { readRepoFile } from '../../test/repo-file';
import type { AppEnvironment } from '../../api/types';

/**
 * 从 `process.cwd()` 往上找**含 `crates/geo-store/migrations` 的那一层**（= 仓库根）。
 * 门禁的 cwd 是 `apps/desktop/ui`，在仓库根直接跑 vitest 时是根，两种都要能过
 * （与 `test/repo-file.ts` 的向上查找同一口径：不能写死 `../../..`）。
 */
function migrationsDir(): string {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'crates', 'geo-store', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('crates/geo-store/migrations not found walking up from cwd');
}

afterEach(() => resetDemoDb());

describe('demo/handlers · app_environment', () => {
  it('返回形状逐键对上 AppEnvironment（顶层 4 键 / permissions 3 键 / storage 7 键）', () => {
    const environment = appEnvironment({}) as AppEnvironment;

    expect(Object.keys(environment).sort()).toEqual([
      'app_version',
      'build_number',
      'permissions',
      'storage',
    ]);
    expect(Object.keys(environment.permissions).sort()).toEqual([
      'files_and_folders',
      'notification',
      'screen_recording',
    ]);
    expect(Object.keys(environment.storage).sort()).toEqual([
      'data_dir',
      'db_path',
      'db_size_bytes',
      'export_dir',
      'log_dir',
      'migrations_applied',
      'screenshots_dir',
    ]);
    expect(environment.app_version).toBe(DEMO_APP_VERSION);
    expect(environment.build_number).toBe(DEMO_BUILD_NUMBER);
  });

  it('🔴 权限三项恒为 unsupported（demo 不许假声明系统授权）', () => {
    const { permissions } = appEnvironment({}) as AppEnvironment;
    expect(permissions).toEqual({
      notification: 'unsupported',
      files_and_folders: 'unsupported',
      screen_recording: 'unsupported',
    });
  });

  it('路径是 ASCII 且都挂在同一个数据目录下（不踩门禁 7 的非注释 CJK）', () => {
    const { storage } = appEnvironment({}) as AppEnvironment;
    const paths = [storage.data_dir, storage.db_path, storage.screenshots_dir, storage.log_dir];

    for (const path of paths) {
      expect(path).toMatch(/^[\x20-\x7e]+$/);
      expect(path.startsWith(storage.data_dir), `${path} 不在数据目录下`).toBe(true);
    }
    expect(storage.db_path).toMatch(/\.sqlite3$/);
    expect(storage.db_size_bytes).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(storage.migrations_applied)).toBe(true);
  });

  it('export_dir 跟着设置里的 last_export_dir 走（两个字段不许各说各话）', () => {
    expect((appEnvironment({}) as AppEnvironment).storage.export_dir).toBeNull();

    getDemoDb().settings.app.storage.last_export_dir = '/Users/demo/Desktop/exports';
    expect((appEnvironment({}) as AppEnvironment).storage.export_dir).toBe(
      '/Users/demo/Desktop/exports',
    );
  });

  it('真值源核对：版本号 == tauri.conf.json 的 version，迁移数 == migrations 目录里的 .sql 数', () => {
    const manifest = JSON.parse(
      readRepoFile('apps', 'desktop', 'src-tauri', 'tauri.conf.json'),
    ) as { version: string };
    expect(DEMO_APP_VERSION).toBe(manifest.version);

    const migrations = readdirSync(migrationsDir()).filter((name) => name.endsWith('.sql'));
    // 防空跑：目录读空了的话「1 == 0」会红，但红得莫名其妙 ⇒ 先把"真的读到了"钉住。
    expect(migrations.length).toBeGreaterThan(0);
    expect((appEnvironment({}) as AppEnvironment).storage.migrations_applied).toBe(
      migrations.length,
    );
  });
});
