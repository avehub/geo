import { useCallback, useState } from 'react';
import { Alert, App, Button, Form, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import { describeIpcError } from '../api/errors';
import {
  toProjectDraft,
  useWizardDraft,
  type WizardDraftData,
} from '../store/wizard-draft';
import { MIN_COMPETITORS } from '../components/CompetitorEditor';
import { WizardStepContent, WizardStepIndicator } from '../components/WizardSteps';
import PageHeader from '../components/ui/PageHeader';
import { WIZARD_STEP_FIELDS, WIZARD_STEPS } from '../components/wizard-steps';

function hasContent(draft: WizardDraftData | null): draft is WizardDraftData {
  return Boolean(draft && (draft.brand_name.trim() !== '' || draft.competitors.length > 0));
}

/**
 * M1 五步建项向导：品牌 → 官网 → 产品 → 地域 → 竞品。
 *
 * 只渲染当前步；antd Form 默认 preserve，未挂载步骤的值仍在 form store 里。
 * 每次改动即写 `localStorage` 草稿（key 见 `WIZARD_DRAFT_KEY`），刷新可恢复。
 */
export default function ProjectWizardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm<WizardDraftData>();

  const { step, setStep, patch, saveDraft, loadDraft, clearDraft } = useWizardDraft();
  // 挂载时探测一次本地草稿。`loadDraft` 只读 localStorage（不改 store），
  // 因此可以放在惰性初始值里，不必用 effect 再多渲染一次。
  const [restorable, setRestorable] = useState<WizardDraftData | null>(() => {
    const stored = loadDraft();
    return hasContent(stored) ? stored : null;
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const syncDraft = useCallback(() => {
    patch(form.getFieldsValue(true) as Partial<WizardDraftData>);
    saveDraft();
  }, [form, patch, saveDraft]);

  const createMutation = useMutation({
    mutationFn: (draft: ReturnType<typeof toProjectDraft>) => client.projectCreate(draft),
    onSuccess: (project) => {
      clearDraft();
      // 左侧栏与项目列表共用 ['projects'] 前缀；建项后必须失效，否则导航栏里看不到新项目。
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      message.success(t('project.wizard.created', { name: project.name }));
      navigate(`/projects/${project.id}/entity-card`);
    },
    onError: (error) => {
      // 裁定 B-5：`IpcRequestError` 走词典渲染；**另一支不许降级成 `common.unknownError`**——
      // 「请检查填写内容」是这一支唯一能给出的可操作提示。`describeIpcError` 内部对
      // 非 `IpcRequestError` 会回落通用文案，所以这里必须保留显式分支。
      const text =
        error instanceof IpcRequestError
          ? describeIpcError(error, t)
          : t('project.wizard.createFailed');
      setSubmitError(text);
      message.error(text);
    },
  });

  async function onNext() {
    try {
      await form.validateFields([...WIZARD_STEP_FIELDS[step]]);
    } catch {
      return; // 校验错误已由 antd 就地展示，停在当前步
    }
    syncDraft();
    setStep(step + 1);
  }

  function onPrev() {
    syncDraft();
    setStep(step - 1);
  }

  async function onSubmit() {
    setSubmitError(null);
    try {
      await form.validateFields();
    } catch {
      setSubmitError(t('project.wizard.incomplete'));
      return;
    }

    const draft = toProjectDraft(form.getFieldsValue(true) as Partial<WizardDraftData>);
    if (draft.competitors.length < MIN_COMPETITORS) {
      setSubmitError(t('project.wizard.tooFewCompetitors', { min: MIN_COMPETITORS }));
      return;
    }
    createMutation.mutate(draft);
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader title={t('project.wizard.title')} />

      {restorable && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('project.wizard.draftFound')}
          description={t('project.wizard.draftBrand', {
            brand: restorable.brand_name || t('project.wizard.draftBrandEmpty'),
          })}
          action={
            <Space>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  form.setFieldsValue(restorable);
                  patch(restorable);
                  setRestorable(null);
                  message.success(t('project.wizard.draftRestored'));
                }}
              >
                {t('project.wizard.restoreDraft')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  clearDraft();
                  setRestorable(null);
                }}
              >
                {t('project.wizard.discardDraft')}
              </Button>
            </Space>
          }
        />
      )}

      <WizardStepIndicator step={step} />

      <Form<WizardDraftData>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ language: 'zh_cn', industry: 'b2b_manufacturing' }}
        onValuesChange={syncDraft}
      >
        <WizardStepContent step={step} />

        {submitError && (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message={submitError} />
        )}

        <Space style={{ marginTop: 24 }}>
          <Button disabled={step === 0} onClick={onPrev}>
            {t('project.wizard.prev')}
          </Button>
          {step < WIZARD_STEPS.length - 1 ? (
            <Button type="primary" onClick={() => void onNext()}>
              {t('project.wizard.next')}
            </Button>
          ) : (
            <Button type="primary" loading={createMutation.isPending} onClick={() => void onSubmit()}>
              {t('project.wizard.submit')}
            </Button>
          )}
          <Button
            type="text"
            onClick={() => {
              clearDraft();
              navigate('/projects');
            }}
          >
            {t('common.cancel')}
          </Button>
        </Space>
      </Form>
    </div>
  );
}
