import { useState } from 'react';
import { Form, Input, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

export interface ArticleDirectionFormValues {
  direction_title: string;
  direction_summary: string;
}

export interface ArticleDirectionModalProps {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: ArticleDirectionFormValues) => void;
}

/**
 * 手动新增内容方向（spec 2026-10-10 · DR-86①「手动新增」那一半）。
 *
 * 🔴 **只有新增，没有编辑**：DR-87 把命令面冻在 10 条，`article_direction_add` 带 `id`
 * 才是就地改，而界面上唯一需要的就地改就是**归档 / 恢复**（卡片上一个按钮即可，不值得为它
 * 开一个弹窗）。真后端补上 `article_direction_update` 之后再把这个弹窗改成"新增 / 编辑"两态
 * （差异台账 §4g E-64）。
 *
 * 🔴 **不给"来源"与"状态"选项**：两者都由后端定（手动新增恒 `manual` + `active`），
 * 让前端自选就等于允许"把 AI 生成的方向洗成人工录入"（口径照 `KeywordEditorModal`）。
 *
 * # 🔴 提交那一刻的必填提示走 `extra`，不走 antd 的 explain 区
 * explain 区（`.ant-form-item-explain-error`）在 `FormItemInput` 里是包着 `CSSMotion` 的：
 * `visible` 翻真之后要等**下一帧**才把节点挂上去。于是"点保存"与"看见红字"隔了一帧
 * （jsdom 上 `requestAnimationFrame` 是宏任务 ⇒ 隔一整个 tick，页面测试的同步断言钉不住它），
 * 用户则会以为按钮没反应、再点一次。`extra` 是 `FormItemInput` 里唯一**不过 motion** 的插槽，
 * 所以提交校验的错误落在那里。
 *
 * `rules` 原样保留：它负责打字时的即时校验与标签上那个星号（`required`）。两者不会同时出现
 * ——一有输入就把提交那次的错误清掉，此后由声明式规则接管。文案是同一条词典键，不是两份文案。
 *
 * 只在需要时挂载（父组件条件渲染）⇒ `initialValues` 每次都是干净的，不用手动 reset。
 * 表单字段名刻意用 `direction_title` / `direction_summary`（与 handler 的 `validation/failed`
 * 的 `field` 记号同名）：错误渲染与表单校验因此指的是同一个字段。
 */
export default function ArticleDirectionModal({
  saving,
  onCancel,
  onSubmit,
}: ArticleDirectionModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ArticleDirectionFormValues>();
  /** 提交时同步算出来的那句必填提示（理由见文件头）。 */
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <Modal
      open
      title={t('article.directions.addTitle')}
      width={560}
      okText={t('article.directions.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => {
        const values = form.getFieldsValue();
        const title = (values.direction_title ?? '').trim();
        if (title === '') {
          setSubmitError(t('article.directions.titleRequired'));
          return;
        }
        setSubmitError(null);
        onSubmit({
          direction_title: title,
          direction_summary: (values.direction_summary ?? '').trim(),
        });
      }}
    >
      <Form<ArticleDirectionFormValues>
        form={form}
        layout="vertical"
        initialValues={{ direction_title: '', direction_summary: '' }}
      >
        <Form.Item
          name="direction_title"
          label={t('article.directions.titleLabel')}
          validateStatus={submitError === null ? undefined : 'error'}
          extra={
            submitError === null ? undefined : (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {submitError}
              </Typography.Text>
            )
          }
          rules={[
            {
              required: true,
              whitespace: true,
              message: t('article.directions.titleRequired'),
            },
          ]}
        >
          <Input
            placeholder={t('article.directions.titlePlaceholder')}
            maxLength={80}
            onChange={() => setSubmitError(null)}
          />
        </Form.Item>
        <Form.Item
          name="direction_summary"
          label={t('article.directions.summaryLabel')}
        >
          <Input.TextArea
            rows={3}
            maxLength={400}
            showCount
            placeholder={t('article.directions.summaryPlaceholder')}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
