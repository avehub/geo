/**
 * 设置页的**数据与保存态**持有者（Plan B Task 2 起只剩这一层壳，布局在 `pages/settings/`）。
 *
 * # 草稿与保存语义（spec DR-28）
 * 所有编辑先落在本地草稿上；`general` / `collection` / `storage` 三段 500ms 防抖后**自动**整包写库，
 * `models` 段由分段自己的保存条**显式**提交。两条路都走同一个 mutation：
 * `settings_update` 是整包写，半包提交会把没改的段落冲掉。
 *
 * # 不认识的 `:section` 回落 `general`
 * 手打一个 `/settings/nope` 不该白屏也不该 404（slug 清单在 `pages/settings/sections.ts`）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Card, Alert } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { AppSettings, StorageConfig } from '../api/types';
import SettingsLayout from './settings/SettingsLayout';
import {
  AUTO_SAVE_DEBOUNCE_MS,
  DEFAULT_SETTINGS_SECTION,
  isAutoSaveSection,
  isSettingsSection,
  type SaveState,
  type SettingsSection,
} from './settings/sections';

/** Rust 侧 E-48 之前只有六段设置；缺的两段用界面默认值补齐，绝不让渲染期崩。 */
const DEFAULT_STORAGE: StorageConfig = { last_export_dir: null };

function normalizeSettings(raw: AppSettings): AppSettings {
  return {
    ...raw,
    model: {
      ...raw.model,
      // `protocol` 也是 Plan B 新增字段；Rust 旧版缺省时回落到中立档。
      protocol: raw.model?.protocol ?? 'openai_compat',
    },
    storage: {
      last_export_dir: raw.storage?.last_export_dir ?? DEFAULT_STORAGE.last_export_dir,
    },
  };
}

export default function SettingsPage() {
  const { section: sectionParam } = useParams();
  const section = isSettingsSection(sectionParam) ? sectionParam : DEFAULT_SETTINGS_SECTION;
  const { message } = App.useApp();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  /**
   * 草稿属于**哪一段**。自动保存只看它，不看当前 `section`：
   * - 在 models 改完切到 general 时，草稿仍属于 models ⇒ 不会被 general 的自动保存顺带提交；
   * - 在 general 改完切到 models 时，草稿仍属于 general ⇒ 防抖到期仍会保存，不会因切段丢改动。
   */
  const [dirtySection, setDirtySection] = useState<SettingsSection | null>(null);
  /** models 段只要有一次未显式保存的编辑，整包自动保存就必须暂停（否则半填的模型配置会被写库）。 */
  const [hasExplicitDirty, setHasExplicitDirty] = useState(false);
  const draftRef = useRef<AppSettings | null>(null);
  const dirtySectionRef = useRef<SettingsSection | null>(null);
  const hasExplicitDirtyRef = useRef(false);
  const versionRef = useRef(0);
  const mountedRef = useRef(true);

  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => client.llmProviders(),
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => client.settingsGet(),
  });

  function clearDraft() {
    draftRef.current = null;
    dirtySectionRef.current = null;
    hasExplicitDirtyRef.current = false;
    versionRef.current += 1;
    setDraft(null);
    setDirtySection(null);
    setHasExplicitDirty(false);
  }

  function markDraft(next: AppSettings) {
    // 从自动保存段切到 models 时，先把旧 draft（只含自动段改动）flush 掉，再接收 models 编辑；
    // 否则新 dirtySection 变成 models，旧改动会随着取消定时器一起丢失。
    if (
      dirtySectionRef.current !== null &&
      dirtySectionRef.current !== section &&
      isAutoSaveSection(dirtySectionRef.current) &&
      !hasExplicitDirtyRef.current &&
      draftRef.current !== null
    ) {
      void client.settingsUpdate(draftRef.current).catch(() => {
        // 离开自动保存段的 flush 失败不阻塞用户继续编辑；下次进入仍以库里值为准。
      });
    }
    if (section === 'models') hasExplicitDirtyRef.current = true;
    versionRef.current += 1;
    draftRef.current = next;
    dirtySectionRef.current = section;
    setDraft(next);
    setDirtySection(section);
    if (section === 'models') setHasExplicitDirty(true);
  }

  const saveVersions = useRef(
    new WeakMap<object, { version: number; section: SettingsSection | null }>(),
  );

  const saveMutation = useMutation({
    mutationFn: (variables: { settings: AppSettings }) => client.settingsUpdate(variables.settings),
    onSuccess: (saved, variables) => {
      if (!mountedRef.current) return;
      queryClient.setQueryData(['settings'], saved);
      // 只有一个原因可以清空草稿：这次保存的正是**当前**草稿，且保存期间没有新的编辑。
      // 否则（例如第一次自动保存 pending 时用户又改了一次）清空会把新编辑静默冲掉。
      const savedVersion = saveVersions.current.get(variables);
      if (
        savedVersion !== undefined &&
        dirtySectionRef.current === savedVersion.section &&
        versionRef.current === savedVersion.version
      ) {
        clearDraft();
      }
      message.success(t('settings.page.saved'));
    },
    onError: (error) => {
      if (mountedRef.current) message.error(describeIpcError(error, t));
    },
  });

  // `mutate` 在 TanStack Query v5 里是稳定引用 ⇒ 可以直接进依赖数组，
  // 否则每次渲染都会重置防抖计时器，自动保存永远不会触发。
  const { mutate: saveSettings } = saveMutation;

  function saveNow() {
    if (draftRef.current === null || dirtySectionRef.current === null) return;
    const variables = { settings: draftRef.current };
    saveVersions.current.set(variables, {
      version: versionRef.current,
      section: dirtySectionRef.current,
    });
    saveSettings(variables);
  }

  const autoSaveNow = useCallback(() => {
    if (
      draftRef.current === null ||
      dirtySectionRef.current === null ||
      !isAutoSaveSection(dirtySectionRef.current)
    ) {
      return;
    }
    const variables = { settings: draftRef.current };
    saveVersions.current.set(variables, {
      version: versionRef.current,
      section: dirtySectionRef.current,
    });
    saveSettings(variables);
  }, [saveSettings]);

  const autoSave =
    dirtySection !== null && isAutoSaveSection(dirtySection) && !hasExplicitDirty;

  useEffect(() => {
    if (!autoSave || draft === null) return undefined;
    const timer = setTimeout(autoSaveNow, AUTO_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [autoSave, draft, autoSaveNow]);

  // 离开设置页时，自动保存段的防抖可能还没到期。effect cleanup 里直接 fire-and-forget
  // 提交一次，避免用户“改完马上点侧栏”时最后 500ms 的修改静默丢失。models 段不在此列。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (
        !hasExplicitDirtyRef.current &&
        draftRef.current !== null &&
        dirtySectionRef.current !== null &&
        isAutoSaveSection(dirtySectionRef.current)
      ) {
        void client.settingsUpdate(draftRef.current).catch(() => {
          // 卸载路径没有 UI 可提示；失败时不阻塞离开，下一次进入仍以库里值为准。
        });
      }
    };
  }, []);

  if (settingsQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('settings.page.loadFailed')}
        description={describeIpcError(settingsQuery.error, t)}
      />
    );
  }

  const settings =
    draft ?? (settingsQuery.data === undefined ? null : normalizeSettings(settingsQuery.data));
  const providers = providersQuery.data ?? [];

  if (settings === null) {
    return <Card loading />;
  }

  const saveState: SaveState = {
    dirty: draft !== null,
    saving: saveMutation.isPending,
    save: saveNow,
    discard: clearDraft,
  };

  return (
    <SettingsLayout
      section={section}
      settings={settings}
      providers={providers}
      patch={markDraft}
      saveState={saveState}
    />
  );
}
