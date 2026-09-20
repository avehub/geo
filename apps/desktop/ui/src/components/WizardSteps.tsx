import { Button, Form, Input, Radio, Select, Space, Steps, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { Industry, Language } from '../api/types';
import { INDUSTRY_LABELS } from '../api/types';
import CompetitorEditor from './CompetitorEditor';
import { WIZARD_STEPS } from './wizard-steps';

const industryOptions = (Object.keys(INDUSTRY_LABELS) as Industry[]).map((value) => ({
  value,
  label: INDUSTRY_LABELS[value],
}));

/** 各步表单的字符上限：规则的 `max` 与提示文案里的数字必须同源，故抽成常量。 */
const MAX_BRAND_NAME_CHARS = 50;
const MAX_PROJECT_NAME_CHARS = 80;
const MAX_PRODUCT_NAME_CHARS = 100;
const MAX_REGION_CHARS = 50;

/**
 * 步骤条 + 当前步序号。序号单独成 span，便于无障碍朗读与测试定位。
 *
 * 序号与其后的摘要**分成两条词条**（`stepOf` / `stepSummary`）而不是拼成一句：
 * ① 拼接在 en 下语序是错的；② `stepOf` 独占一个 `<span>`，`ProjectWizardPage.test.tsx`
 * 用 `/^第 \d+ 步$/` 定位当前步，拆开才钉得住。
 */
export function WizardStepIndicator({ step }: { step: number }) {
  const { t } = useTranslation();

  return (
    <div style={{ marginBottom: 20 }}>
      <Steps
        size="small"
        current={step}
        items={WIZARD_STEPS.map((item) => ({
          title: t(item.titleKey),
          description: t(item.descriptionKey),
        }))}
        style={{ marginBottom: 12 }}
      />
      <Typography.Text type="secondary">
        <span>{t('project.wizard.stepOf', { step: step + 1 })}</span>
        {t('project.wizard.stepSummary', {
          total: WIZARD_STEPS.length,
          title: t(WIZARD_STEPS[step].titleKey),
        })}
      </Typography.Text>
    </div>
  );
}

/**
 * 当前步的表单内容。只渲染当前步：antd Form 默认 `preserve`，
 * 未挂载步骤的值仍留在 form store 中，提交时统一取出。
 *
 * 行业选项的标签仍来自 `api/types.ts` 的 `INDUSTRY_LABELS`（后端产出自然语言的枚举映射），
 * 那个文件归 Task 9 的写集，本任务不越界。
 */
export function WizardStepContent({ step }: { step: number }) {
  const { t } = useTranslation();

  if (step === 0) {
    return (
      <>
        <Form.Item
          name="brand_name"
          label={t('project.wizard.brandName')}
          rules={[
            { required: true, message: t('project.wizard.brandNameRequired') },
            { max: MAX_BRAND_NAME_CHARS, message: t('project.wizard.brandNameTooLong', { max: MAX_BRAND_NAME_CHARS }) },
          ]}
          extra={t('project.wizard.brandNameExtra')}
        >
          <Input placeholder={t('project.wizard.brandNamePlaceholder')} allowClear />
        </Form.Item>
        <Form.Item
          name="aliases"
          label={t('project.wizard.aliases')}
          extra={t('project.wizard.aliasesExtra')}
        >
          <Select mode="tags" placeholder={t('project.wizard.aliasesPlaceholder')} tokenSeparators={[',', '，']} open={false} suffixIcon={null} />
        </Form.Item>
        <Form.Item
          name="name"
          label={t('project.wizard.projectName')}
          rules={[{ max: MAX_PROJECT_NAME_CHARS, message: t('project.wizard.projectNameTooLong', { max: MAX_PROJECT_NAME_CHARS }) }]}
          extra={t('project.wizard.projectNameExtra')}
        >
          <Input placeholder={t('project.wizard.projectNamePlaceholder')} allowClear />
        </Form.Item>
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        <Form.Item
          name="website"
          label={t('project.wizard.website')}
          rules={[{ type: 'url', message: t('common.invalidUrl') }]}
          extra={t('project.wizard.websiteExtra')}
        >
          <Input placeholder="https://www.example.com" allowClear />
        </Form.Item>
        <Form.Item name="core_pages" label={t('project.wizard.corePages')} extra={t('project.wizard.corePagesExtra')}>
          <Select mode="tags" placeholder="https://www.example.com/about" tokenSeparators={[',', '，']} open={false} suffixIcon={null} />
        </Form.Item>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <Form.List name="products">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Form.Item label={t('project.wizard.products')} style={{ marginBottom: 0 }} extra={t('project.wizard.productsExtra')}>
                <Typography.Text type="secondary">
                  {t('project.wizard.productCount', { total: fields.length })}
                </Typography.Text>
              </Form.Item>
              {fields.map((field) => (
                <Space key={field.key} align="baseline" wrap>
                  <Form.Item
                    name={[field.name, 'name']}
                    rules={[{ max: MAX_PRODUCT_NAME_CHARS, message: t('project.wizard.productNameTooLong', { max: MAX_PRODUCT_NAME_CHARS }) }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder={t('project.wizard.productNamePlaceholder')} style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'params']} style={{ marginBottom: 0 }}>
                    <Select
                      mode="tags"
                      placeholder={t('project.wizard.productParamsPlaceholder')}
                      style={{ width: 260 }}
                      tokenSeparators={[',', '，']}
                      open={false}
                      suffixIcon={null}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'note']} style={{ marginBottom: 0 }}>
                    <Input placeholder={t('common.noteOptional')} style={{ width: 180 }} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    aria-label={t('project.wizard.removeProductAria')}
                  />
                </Space>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => add({ name: '', params: [], note: null })}
              >
                {t('project.wizard.addProduct')}
              </Button>
            </Space>
          )}
        </Form.List>
        <Form.Item name="service_scope" label={t('project.wizard.serviceScope')} style={{ marginTop: 16 }}>
          <Input.TextArea rows={3} placeholder={t('project.wizard.serviceScopePlaceholder')} />
        </Form.Item>
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        <Form.Item
          name="region"
          label={t('project.wizard.region')}
          rules={[{ max: MAX_REGION_CHARS, message: t('project.wizard.regionTooLong', { max: MAX_REGION_CHARS }) }]}
          extra={t('project.wizard.regionExtra')}
        >
          <Input placeholder={t('project.wizard.regionPlaceholder')} allowClear />
        </Form.Item>
        <Form.Item name="language" label={t('project.wizard.language')}>
          <Radio.Group
            optionType="button"
            options={[
              { value: 'zh_cn' as Language, label: t('project.wizard.languageZhCn') },
              { value: 'en_us' as Language, label: t('project.wizard.languageEnUs') },
            ]}
          />
        </Form.Item>
        <Form.Item name="industry" label={t('project.wizard.industry')} extra={t('project.wizard.industryExtra')}>
          <Radio.Group optionType="button" options={industryOptions} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.industry !== next.industry}>
          {({ getFieldValue }) =>
            getFieldValue('industry') === 'other' ? (
              <Form.Item name="industry_label" label={t('project.wizard.industryLabel')}>
                <Input placeholder={t('project.wizard.industryLabelPlaceholder')} allowClear />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item name="tags" label={t('project.wizard.tags')} extra={t('project.wizard.tagsExtra')}>
          <Select mode="tags" placeholder={t('project.wizard.tagsPlaceholder')} tokenSeparators={[',', '，']} open={false} suffixIcon={null} />
        </Form.Item>
      </>
    );
  }

  return <CompetitorEditor />;
}
