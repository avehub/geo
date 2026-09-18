import { Button, Form, Input, Radio, Select, Space, Steps, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import type { Industry, Language } from '../api/types';
import { INDUSTRY_LABELS } from '../api/types';
import CompetitorEditor from './CompetitorEditor';
import { WIZARD_STEPS } from './wizard-steps';

const industryOptions = (Object.keys(INDUSTRY_LABELS) as Industry[]).map((value) => ({
  value,
  label: INDUSTRY_LABELS[value],
}));

/** 步骤条 + 当前步序号。序号单独成 span，便于无障碍朗读与测试定位。 */
export function WizardStepIndicator({ step }: { step: number }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Steps
        size="small"
        current={step}
        items={WIZARD_STEPS.map((item) => ({ title: item.title, description: item.description }))}
        style={{ marginBottom: 12 }}
      />
      <Typography.Text type="secondary">
        <span>{`第 ${step + 1} 步`}</span>
        {` / 共 ${WIZARD_STEPS.length} 步 · ${WIZARD_STEPS[step].title}`}
      </Typography.Text>
    </div>
  );
}

/**
 * 当前步的表单内容。只渲染当前步：antd Form 默认 `preserve`，
 * 未挂载步骤的值仍留在 form store 中，提交时统一取出。
 */
export function WizardStepContent({ step }: { step: number }) {
  if (step === 0) {
    return (
      <>
        <Form.Item
          name="brand_name"
          label="品牌名"
          rules={[
            { required: true, message: '请输入品牌名' },
            { max: 50, message: '品牌名不能超过 50 字' },
          ]}
          extra="用户搜索时最常提到的那个名字，例如「宏宇泵业」"
        >
          <Input placeholder="例如：宏宇泵业" allowClear />
        </Form.Item>
        <Form.Item name="aliases" label="品牌别名" extra="输入后回车，可添加多个">
          <Select mode="tags" placeholder="例如：宏宇、HongYu" tokenSeparators={[',', '，']} open={false} suffixIcon={null} />
        </Form.Item>
        <Form.Item name="name" label="项目名" rules={[{ max: 80, message: '项目名不能超过 80 字' }]} extra="留空则与品牌名相同">
          <Input placeholder="例如：宏宇泵业 GEO（2026 Q4）" allowClear />
        </Form.Item>
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        <Form.Item
          name="website"
          label="官网"
          rules={[{ type: 'url', message: '请输入合法的 URL（含 http/https）' }]}
          extra="自动建档会抓取官网首页与站内页面，仅抓自有域名"
        >
          <Input placeholder="https://www.example.com" allowClear />
        </Form.Item>
        <Form.Item name="core_pages" label="核心页面" extra="输入完整 URL 后回车，可添加多个">
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
              <Form.Item label="产品线" style={{ marginBottom: 0 }} extra="产品名必填，参数用于生成「专业长尾」prompt">
                <Typography.Text type="secondary">共 {fields.length} 个产品</Typography.Text>
              </Form.Item>
              {fields.map((field) => (
                <Space key={field.key} align="baseline" wrap>
                  <Form.Item
                    name={[field.name, 'name']}
                    rules={[{ max: 100, message: '产品名不能超过 100 字' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="例如：离心泵" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'params']} style={{ marginBottom: 0 }}>
                    <Select
                      mode="tags"
                      placeholder="关键参数，回车添加"
                      style={{ width: 260 }}
                      tokenSeparators={[',', '，']}
                      open={false}
                      suffixIcon={null}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'note']} style={{ marginBottom: 0 }}>
                    <Input placeholder="备注（可选）" style={{ width: 180 }} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    aria-label="删除该产品"
                  />
                </Space>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => add({ name: '', params: [], note: null })}
              >
                添加产品
              </Button>
            </Space>
          )}
        </Form.List>
        <Form.Item name="service_scope" label="服务范围" style={{ marginTop: 16 }}>
          <Input.TextArea rows={3} placeholder="例如：面向市政供水与工业循环水，提供选型、安装指导与售后维保" />
        </Form.Item>
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        <Form.Item name="region" label="服务地域" rules={[{ max: 50, message: '地域不能超过 50 字' }]} extra="留空默认「全国」，用于生成「本地服务」类 prompt">
          <Input placeholder="例如：浙江杭州" allowClear />
        </Form.Item>
        <Form.Item name="language" label="语言">
          <Radio.Group
            optionType="button"
            options={[
              { value: 'zh_cn' as Language, label: '简体中文' },
              { value: 'en_us' as Language, label: '英文' },
            ]}
          />
        </Form.Item>
        <Form.Item name="industry" label="行业" extra="决定 prompt 模板库">
          <Radio.Group optionType="button" options={industryOptions} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.industry !== next.industry}>
          {({ getFieldValue }) =>
            getFieldValue('industry') === 'other' ? (
              <Form.Item name="industry_label" label="行业名称">
                <Input placeholder="例如：宠物医疗" allowClear />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item name="tags" label="标签" extra="输入后回车，便于多项目检索">
          <Select mode="tags" placeholder="例如：水泵、市政" tokenSeparators={[',', '，']} open={false} suffixIcon={null} />
        </Form.Item>
      </>
    );
  }

  return <CompetitorEditor />;
}
