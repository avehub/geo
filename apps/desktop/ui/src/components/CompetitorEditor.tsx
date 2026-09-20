import { Alert, Button, Form, Input, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

export const MIN_COMPETITORS = 3;
export const MAX_COMPETITORS = 5;

/**
 * 竞品名称的字符上限。抽出来是因为校验规则的 `max` 与提示文案里的数字必须同源——
 * 文案走词典之后，两处各写一个 50 就成了"改一处忘另一处"。
 */
const MAX_NAME_CHARS = 50;

/**
 * 第 5 步：竞品 3–5 家。
 *
 * 竞品数量下限是产品口径（M2 要求「竞品同框 prompt」才能算 SOV），
 * 因此这里既给持续可见的提示，也在提交时二次拦截。
 *
 * 数量一律经插值传进词典（`{{min}}` / `{{max}}` / `{{current}}`），不在组件里拼接句子——
 * 拼接在 en 下语序就是错的。插值变量刻意不叫 `count`：i18next 见到 `count` 会走复数分支。
 */
export default function CompetitorEditor() {
  const { t } = useTranslation();
  const competitors = Form.useWatch<unknown[]>('competitors') ?? [];
  const validCount = competitors.filter(
    (item) => typeof item === 'object' && item !== null && String((item as { name?: string }).name ?? '').trim() !== '',
  ).length;
  const tooFew = validCount < MIN_COMPETITORS;
  const tooMany = competitors.length > MAX_COMPETITORS;

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t('prompt.competitors.intro', { min: MIN_COMPETITORS, max: MAX_COMPETITORS })}
      </Typography.Paragraph>

      {tooFew && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('prompt.competitors.tooFew', { min: MIN_COMPETITORS, current: validCount })}
          description={t('prompt.competitors.tooFewDetail')}
        />
      )}
      {tooMany && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('prompt.competitors.tooMany', { max: MAX_COMPETITORS })}
        />
      )}

      <Form.List name="competitors">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" wrap>
                <Form.Item
                  name={[field.name, 'name']}
                  rules={[{ max: MAX_NAME_CHARS, message: t('prompt.competitors.nameTooLong', { max: MAX_NAME_CHARS }) }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder={t('prompt.competitors.namePlaceholder')} style={{ width: 180 }} />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'website']}
                  rules={[{ type: 'url', message: t('common.invalidUrl') }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder={t('prompt.competitors.websitePlaceholder')} style={{ width: 240 }} />
                </Form.Item>
                <Form.Item name={[field.name, 'note']} style={{ marginBottom: 0 }}>
                  <Input placeholder={t('common.noteOptional')} style={{ width: 200 }} />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  aria-label={t('prompt.competitors.removeAria')}
                />
              </Space>
            ))}
            <Button
              icon={<PlusOutlined />}
              onClick={() => add({ name: '', aliases: [], website: null, note: null })}
              disabled={fields.length >= MAX_COMPETITORS}
            >
              {t('prompt.competitors.add')}
            </Button>
          </Space>
        )}
      </Form.List>
    </div>
  );
}
