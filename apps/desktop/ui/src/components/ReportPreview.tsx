import { Alert, Card, Descriptions, Divider, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ReportBlock, ReportDocument, ReportMetricBlock } from '../api/types';
import { dateTimeText, metricDeltaText, metricValueText } from './format';
import { enumLabel } from '../i18n/enum-label';
import { methodologyRows, reportTitle, sectionTitle, tableCellText } from '../api/report-compose';

/** 一个指标行：`Brand Coverage 42% (+13 个百分点)`。与导出文本用的是同一份格式化函数。 */
function MetricLine({ metric }: { metric: ReportMetricBlock }) {
  const { t } = useTranslation();
  return (
    <Typography.Text>
      {`${enumLabel(t, 'report.metrics', metric.metric)}: ${metricValueText(metric.unit, metric.value)}`}
      {metric.delta === null ? '' : ` (${metricDeltaText(t, metric.unit, metric.delta)})`}
    </Typography.Text>
  );
}

/**
 * 一张表格块（单独一个组件：块渲染要按 `kind` 分派，而每种块都可能有自己的 hook 边界）。
 *
 * 列是**稳定记号**（`report.columns.<key>`），标题查词典；单元格是后端已排版好的数据串，
 * 前端只按列序摆进 `dataIndex`，不改写、不重算。
 */
function TableBlock({ block }: { block: Extract<ReportBlock, { kind: 'table' }> }) {
  const { t } = useTranslation();
  return (
    <Table
      size="small"
      pagination={false}
      scroll={{ x: true }}
      columns={block.column_keys.map((key, index) => ({
        title: enumLabel(t, 'report.columns', key),
        dataIndex: String(index),
        key: `${key}-${index}`,
      }))}
      dataSource={block.rows.map((row, rowIndex) => ({
        key: rowIndex,
        ...Object.fromEntries(
          row.map((cell, cellIndex) => [
            String(cellIndex),
            tableCellText(t, block.column_keys[cellIndex] ?? '', cell),
          ]),
        ),
      }))}
    />
  );
}

function BlockView({ block }: { block: ReportBlock }) {
  if (block.kind === 'paragraph') {
    // 叙述段是数据级中文（种子给的结论句），en 界面下照旧显示中文。
    return <Typography.Paragraph style={{ fontSize: 13 }}>{block.text}</Typography.Paragraph>;
  }
  if (block.kind === 'metric') return <MetricLine metric={block} />;
  if (block.kind === 'list') {
    return (
      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
        {block.items.map((item) => (
          <li key={item}>
            <Typography.Text style={{ fontSize: 13 }}>{item}</Typography.Text>
          </li>
        ))}
      </ul>
    );
  }
  return <TableBlock block={block} />;
}

/**
 * M7 报告预览：把 `ReportDocument`（稳定记号 + 数据）渲染成 React 节点。
 *
 * # 为什么不用 `dangerouslySetInnerHTML`
 * `src/i18n/index.ts` 的 R-I 安全约束：报告里的叙述段、表格单元格、回答片段全是**数据**，
 * 一旦当标记塞进去就有了注入口。块结构由这里渲染成节点，天然没有这个问题。
 *
 * # 预览与导出必须同源
 * 标题走 `api/report-compose.ts` 的 `reportTitle`，指标与变化量走 `components/format.ts`——
 * 与 Markdown / HTML / CSV 导出用的是同一批函数，所以"预览里看到的数字"与"导出文件里的数字"
 * 不可能对不上（这正是本产品最不能出现的失败形态）。
 *
 * # 🔴 三处口径说明不能省
 * `report.disclaimer`（不承诺排名结果）、`methodology.repeatNote`（比率是区间）、
 * `methodology.insufficientNote`（样本不足只给方向性参考）。
 */
export default function ReportPreview({ doc }: { doc: ReportDocument }) {
  const { t } = useTranslation();
  const methodology = doc.methodology;

  return (
    <Card size="small" title={reportTitle(t, doc)} style={{ marginBottom: 12 }}>
      {doc.white_label !== null && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {doc.white_label.logo_url !== null && (
            <>
              <img
                src={doc.white_label.logo_url}
                alt={doc.white_label.agency_name}
                style={{ display: 'block', maxHeight: 64, maxWidth: 240, marginBottom: 6 }}
                referrerPolicy="no-referrer"
                // Logo 是用户填的外部地址：不可达时只隐藏这张图，不能让整份预览崩掉。
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </>
          )}
          {`${t('report.whiteLabel.preparedBy', { agency: doc.white_label.agency_name })} · ${
            doc.white_label.contact
          }`}
        </Typography.Paragraph>
      )}

      <Typography.Text strong>{t('report.headline')}</Typography.Text>
      <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 8 }}>
        {doc.headline.map((metric) => (
          <MetricLine key={metric.metric} metric={metric} />
        ))}
      </Space>

      {doc.sections.map((section) => (
        <div key={section.id} style={{ marginBottom: 12 }}>
          <Divider orientation="left" style={{ margin: '8px 0' }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {sectionTitle(t, section)}
            </Typography.Text>
          </Divider>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {section.blocks.map((block, index) => (
              // 块没有稳定 id，索引就是它在节内的位置（节的顺序由后端决定，前端不重排）。
              <BlockView key={`${section.id}-${index}`} block={block} />
            ))}
          </Space>
        </div>
      ))}

      <Divider orientation="left" style={{ margin: '8px 0' }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t('report.nextSteps')}
        </Typography.Text>
      </Divider>
      <ol style={{ margin: 0, paddingInlineStart: 20 }}>
        {doc.next_steps.map((step) => (
          <li key={step}>
            <Typography.Text style={{ fontSize: 13 }}>{step}</Typography.Text>
          </li>
        ))}
      </ol>

      <Divider orientation="left" style={{ margin: '8px 0' }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t('report.methodology.title')}
        </Typography.Text>
      </Divider>
      {/*
        口径说明的标签与值都来自 `methodologyRows`——预览与 Markdown / HTML / CSV 导出
        共用同一份「记号 → 词条、值 → 串」，不在两边各写一遍。
      */}
      <Descriptions size="small" column={2}>
        {methodologyRows(t, doc).map((row) => (
          <Descriptions.Item key={row.key} label={row.label}>
            {row.value}
          </Descriptions.Item>
        ))}
      </Descriptions>
      {methodology.repeat_count > 1 && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
          {t('report.methodology.repeatNote', { times: methodology.repeat_count })}
        </Typography.Paragraph>
      )}
      {methodology.sample_size_grade === 'insufficient' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('report.methodology.insufficientNote')}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
        {t('report.disclaimer')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {`${t('report.export.generatedAt')}: ${dateTimeText(doc.generated_at)}`}
      </Typography.Paragraph>
    </Card>
  );
}
