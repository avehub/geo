import { useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useTranslation } from 'react-i18next';

import type {
  ArticleDirection,
  ArticleSlot,
  ArticleTemplate,
  ArticleTemplateDraft,
  Competitor,
  KbModule,
  Project,
} from '../api/types';
import { ARTICLE_LENGTH_MAX, ARTICLE_LENGTH_MIN, ARTICLE_SLOT_VALUES, KB_MODULE_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import {
  insertSlotAtCursor,
  parseSlots,
  previewWordCount,
  renderPromptPreview,
  slotSampleValues,
} from './article-slots';

/** 表单值形状：提交时页面层（本组件的 `onSubmit`）转成 `ArticleTemplateDraft`。 */
export interface ArticleTemplateFormValues {
  template_name: string;
  direction_id: string;
  prompt_template: string;
  product_names: string[];
  keyword_texts: string[];
  audience: string;
  kb_modules: KbModule[];
  style: string;
  length: number;
}

export interface ArticleTemplateDrawerProps {
  /** 传行即「编辑」，传 null 即「新建」（照 `KeywordEditorModal` 的口径）。 */
  template: ArticleTemplate | null;
  directions: ArticleDirection[];
  /** 项目与竞品：实时预览要用它们的**真实值**替换槽位（DR-86②）。 */
  project: Project | null;
  competitors: Competitor[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: ArticleTemplateDraft) => void;
}

/**
 * `Form.useWatch` 在首帧回 `undefined`（值在挂载后的 effect 里才落位）⇒ 这几处回落一律用
 * **模块级常量**而不是字面量：字面量每次渲染都是新引用，会把下面 `preview` 那个 `useMemo`
 * 的依赖每帧换掉（白算一遍替换，也让"依赖稳定"这件事失去意义）。
 */
const NO_TEXTS: string[] = [];

/**
 * ② 提示词模板的**侧滑编辑器**（spec 2026-10-10 · DR-86②，形态照 DR-77 的知识库抽屉）。
 *
 * # 三块：表单 / 槽位 chips / 实时预览
 * - **槽位 chips 点击插入光标处**（Jasper / Copy.ai 的模式，survey §3.2）：不是无脑追加到末尾——
 *   提示词是有语序的，插在哪儿由用户的光标决定。插入后把光标放回记号之后，接着打字才顺；
 * - **实时预览**用项目真实值替换槽位（`components/article-slots.ts` 是唯一裁定点），
 *   取不到值的槽位**保留记号**，让人看见"这一槽还没绑东西"；
 * - **预览字数**是展示层计数（去掉空白后的字符数），不是后端指标（规则 9），
 *   所以它不与模板的「目标字数」做达标比较。
 *
 * # 🔴 `slots` 由正文**现算**，不给用户手填
 * DR-84 的定义就是"正文里出现过的槽位"：手填一份就会与正文漂移（正文删了记号、清单还留着）。
 * 提交时用 `parseSlots(prompt)` 算，与 handler 的收敛口径逐字相同（同一个清单序）。
 *
 * # 🔴 `kb_modules` 只**记录**不拼接（DR-89）
 * 抽屉里那句 `kbModulesHint` 常驻：勾了模块不会把知识条目塞进提示词，demo 不做真拼接注入。
 */
export default function ArticleTemplateDrawer({
  template,
  directions,
  project,
  competitors,
  saving,
  onClose,
  onSubmit,
}: ArticleTemplateDrawerProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ArticleTemplateFormValues>();
  const promptRef = useRef<TextAreaRef>(null);
  /**
   * 插入槽位后要把光标放回记号之后。
   *
   * 🔴 走 **ref + effect**，不走 state：`form.setFieldValue()` 之后 textarea 的 `value`
   * 要等下一次提交才落到 DOM 上，所以设光标这件事必须排在那次渲染之后（effect）；
   * 而"待办的光标位"本身不是界面状态——它不驱动任何渲染，只是一个跨一帧的 DOM 待办事项，
   * 用 state 存它就会在 effect 里再 `setState` 一次（多一轮渲染，`react-hooks/set-state-in-effect`
   * 点名的正是这个形状）。ref 在事件里写、在 effect 里读并清空，正好是它的用途。
   */
  const pendingCaret = useRef<number | null>(null);

  const prompt = Form.useWatch('prompt_template', form) ?? '';
  const directionId = Form.useWatch('direction_id', form) ?? '';
  const productNames = Form.useWatch('product_names', form) ?? NO_TEXTS;
  const keywordTexts = Form.useWatch('keyword_texts', form) ?? NO_TEXTS;
  const audience = Form.useWatch('audience', form) ?? '';

  const direction = useMemo(
    () => directions.find((row) => row.id === directionId) ?? null,
    [directions, directionId],
  );

  const preview = useMemo(
    () =>
      renderPromptPreview(
        prompt,
        slotSampleValues({
          project,
          bindings: { product_names: productNames, keyword_texts: keywordTexts, audience: audience === '' ? null : audience },
          direction,
          competitors,
        }),
      ),
    [prompt, productNames, keywordTexts, audience, project, direction, competitors],
  );

  useEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const area = promptRef.current?.resizableTextArea?.textArea;
    area?.focus();
    area?.setSelectionRange(caret, caret);
  }, [prompt]);

  function insertSlot(slot: ArticleSlot) {
    const area = promptRef.current?.resizableTextArea?.textArea;
    const next = insertSlotAtCursor(prompt, area?.selectionStart ?? null, slot);
    pendingCaret.current = next.caret;
    form.setFieldValue('prompt_template', next.value);
  }

  return (
    <Drawer
      open
      width={760}
      title={
        template === null
          ? t('article.templates.editor.createTitle')
          : t('article.templates.editor.editTitle')
      }
      onClose={onClose}
      footer={
        <Space>
          <Button
            type="primary"
            loading={saving}
            onClick={() => {
              void form
                .validateFields()
                .then((values) =>
                  onSubmit({
                    id: template?.id ?? null,
                    direction_id: values.direction_id,
                    name: values.template_name.trim(),
                    prompt_template: values.prompt_template,
                    slots: parseSlots(values.prompt_template),
                    bindings: {
                      product_names: values.product_names,
                      keyword_texts: values.keyword_texts,
                      audience: values.audience.trim() === '' ? null : values.audience.trim(),
                    },
                    kb_modules: values.kb_modules,
                    style: values.style ?? '',
                    length: values.length,
                  }),
                )
                .catch(() => undefined);
            }}
          >
            {t('article.templates.editor.ok')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </Space>
      }
    >
      <Form<ArticleTemplateFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          template_name: template?.name ?? '',
          direction_id: template?.direction_id ?? (directions[0]?.id ?? ''),
          prompt_template: template?.prompt_template ?? '',
          product_names: template?.bindings.product_names ?? [],
          keyword_texts: template?.bindings.keyword_texts ?? [],
          audience: template?.bindings.audience ?? '',
          kb_modules: template?.kb_modules ?? [],
          style: template?.style ?? '',
          length: template?.length ?? 1000,
        }}
      >
        <Row gutter={16}>
          <Col span={14}>
            <Form.Item
              name="template_name"
              label={t('article.templates.editor.nameLabel')}
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t('article.templates.editor.nameRequired'),
                },
              ]}
            >
              <Input maxLength={60} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item
              name="direction_id"
              label={t('article.templates.editor.directionLabel')}
              rules={[{ required: true, message: t('article.templates.editor.directionRequired') }]}
            >
              <Select
                options={directions.map((row) => ({ value: row.id, label: row.title }))}
                placeholder={t('article.templates.editor.directionLabel')}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label={t('article.templates.editor.slotsLabel')}
          extra={t('article.templates.editor.slotsHint')}
        >
          <Space size={4} wrap>
            {ARTICLE_SLOT_VALUES.map((slot) => (
              <Button key={slot} size="small" onClick={() => insertSlot(slot)}>
                {enumLabel(t, 'article.slots', slot)}
              </Button>
            ))}
          </Space>
        </Form.Item>

        <Form.Item
          name="prompt_template"
          label={t('article.templates.editor.promptLabel')}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t('article.templates.editor.promptRequired'),
            },
          ]}
        >
          <Input.TextArea
            ref={promptRef}
            rows={9}
            aria-label={t('article.templates.editor.promptAria')}
          />
        </Form.Item>

        <Form.Item
          label={t('article.templates.editor.previewLabel')}
          extra={t('article.templates.editor.previewHint')}
        >
          <Input.TextArea
            rows={9}
            readOnly
            aria-label={t('article.templates.editor.previewAria')}
            value={preview}
          />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('article.templates.editor.wordCount', { total: previewWordCount(preview) })}
        </Typography.Paragraph>

        <Form.Item
          name="kb_modules"
          label={t('article.templates.editor.kbModules')}
          extra={t('article.templates.editor.kbModulesHint')}
        >
          <Select
            mode="multiple"
            allowClear
            options={KB_MODULE_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'kb.modules', value),
            }))}
          />
        </Form.Item>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {t('article.templates.editor.bindingsLabel')}
        </Typography.Paragraph>
        <Form.Item
          name="product_names"
          label={t('article.templates.editor.productNamesLabel')}
        >
          <Select mode="tags" open={false} suffixIcon={null} placeholder={t('article.templates.editor.productNamesPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="keyword_texts"
          label={t('article.templates.editor.keywordTextsLabel')}
        >
          <Select mode="tags" open={false} suffixIcon={null} placeholder={t('article.templates.editor.keywordTextsPlaceholder')} />
        </Form.Item>
        <Form.Item name="audience" label={t('article.templates.editor.audienceLabel')}>
          <Input placeholder={t('article.templates.editor.audiencePlaceholder')} maxLength={60} />
        </Form.Item>

        <Row gutter={16}>
          <Col span={14}>
            <Form.Item name="style" label={t('article.templates.editor.styleLabel')}>
              <Input placeholder={t('article.templates.editor.stylePlaceholder')} maxLength={40} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item name="length" label={t('article.templates.editor.lengthLabel')}>
              <InputNumber
                min={ARTICLE_LENGTH_MIN}
                max={ARTICLE_LENGTH_MAX}
                step={100}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>
  );
}
