import { useCallback, useState } from 'react';
import { Alert, App, Button, Form, Space, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import {
  toProjectDraft,
  useWizardDraft,
  type WizardDraftData,
} from '../store/wizard-draft';
import { MIN_COMPETITORS } from '../components/CompetitorEditor';
import { WizardStepContent, WizardStepIndicator } from '../components/WizardSteps';
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
  const { message } = App.useApp();
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
      message.success(`项目「${project.name}」已创建`);
      navigate(`/projects/${project.id}/entity-card`);
    },
    onError: (error) => {
      const text =
        error instanceof IpcRequestError ? error.userMessage : '创建失败，请检查填写内容';
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
      setSubmitError('请先补全必填项（品牌名必填，竞品官网需为合法 URL）');
      return;
    }

    const draft = toProjectDraft(form.getFieldsValue(true) as Partial<WizardDraftData>);
    if (draft.competitors.length < MIN_COMPETITORS) {
      setSubmitError(`竞品不足：请补齐到 ${MIN_COMPETITORS} 家后再创建，否则无法生成「品牌对比」类同框 prompt`);
      return;
    }
    createMutation.mutate(draft);
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        新建项目
      </Typography.Title>

      {restorable && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="检测到上次未完成的建档草稿"
          description={`品牌：${restorable.brand_name || '（未填写）'}`}
          action={
            <Space>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  form.setFieldsValue(restorable);
                  patch(restorable);
                  setRestorable(null);
                  message.success('草稿已恢复');
                }}
              >
                恢复草稿
              </Button>
              <Button
                size="small"
                onClick={() => {
                  clearDraft();
                  setRestorable(null);
                }}
              >
                丢弃
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
            上一步
          </Button>
          {step < WIZARD_STEPS.length - 1 ? (
            <Button type="primary" onClick={() => void onNext()}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={createMutation.isPending} onClick={() => void onSubmit()}>
              创建项目
            </Button>
          )}
          <Button
            type="text"
            onClick={() => {
              clearDraft();
              navigate('/projects');
            }}
          >
            取消
          </Button>
        </Space>
      </Form>
    </div>
  );
}
