import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { FileDoneOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as collection from '../api/collection';
import { describeIpcError } from '../api/errors';
import * as report from '../api/report';
import type { ReportDocument, ReportVariant, RoundStatus, WhiteLabelProfile } from '../api/types';
import { REPORT_VARIANT_VALUES } from '../api/types';
import ReportExportBar from '../components/ReportExportBar';
import ReportPreview from '../components/ReportPreview';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { enumLabel } from '../i18n/enum-label';

/**
 * 出不了报告的轮次状态：排队中 / 采集中 / 失败。
 *
 * `partial`（部分完成）**可以**出：小样本通道验证那一轮就是 `partial`，产品口径是
 * "照样给数字，但界面必须把样本量分级与区间摆出来"（`SampleSizeAlert` 与
 * `report.methodology.insufficientNote` 就是干这个的）。
 */
const UNRENDERABLE_STATUSES: readonly RoundStatus[] = ['queued', 'running', 'failed'];

/**
 * M7 报告与分享：同一份数据，三种讲法（老板版 / 执行版 / 白标版）。
 *
 * # 版本差异由**后端给哪些节**决定
 * 前端不按版本裁剪 `doc.sections`（`demo/handlers/report.ts` 已经按 `SEED_VARIANT_SECTIONS` 挑好了）。
 * 这样"老板版只有结论"这件事只有一个真值源，界面不会和导出文件各说一套。
 *
 * # 🔴 白标信息要显式点「生成报告」才生效
 * `whiteLabel` 不进 query key（否则每敲一个字就重渲一次报告，还带着 demo 的假延迟）；
 * `queryFn` 每次渲染都重建，refetch 时读到的就是表单当前值 ⇒ 改完点按钮即可。
 * 三个字段全空时传 `null`，由后端回落到默认署名（界面上写明了这条口径）。
 */
export default function ReportPage() {
  const { id: projectId = '' } = useParams();
  const { t } = useTranslation();

  const [roundId, setRoundId] = useState<string | null>(null);
  const [variant, setVariant] = useState<ReportVariant>('executive');
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [agencyName, setAgencyName] = useState('');
  const [contact, setContact] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [rendered, setRendered] = useState(false);

  const boardQuery = useQuery({
    queryKey: ['collection-board', projectId],
    queryFn: () => collection.collectionBoard(projectId),
    enabled: projectId !== '',
  });
  const boardRounds = boardQuery.data?.rounds;
  // 单独 memo：理由同 `pages/ActionPage.tsx` 的 `allActions`。
  const rounds = useMemo(() => boardRounds ?? [], [boardRounds]);

  const renderable = useMemo(
    () => rounds.filter((round) => !UNRENDERABLE_STATUSES.includes(round.status)),
    [rounds],
  );
  const hasUnrenderable = renderable.length !== rounds.length;
  // 默认选中最近一轮**能出报告**的（`roundsOf` 按 round_index 升序 ⇒ 末尾即最新）。
  const selectedRoundId = roundId ?? renderable[renderable.length - 1]?.id ?? null;

  const whiteLabel: WhiteLabelProfile | null =
    agencyName.trim() === '' && contact.trim() === '' && logoUrl.trim() === ''
      ? null
      : {
          agency_name: agencyName.trim(),
          contact: contact.trim(),
          logo_url: logoUrl.trim() === '' ? null : logoUrl.trim(),
        };

  const docQuery = useQuery({
    queryKey: ['report', projectId, selectedRoundId, variant, includeEvidence],
    queryFn: () =>
      report.reportRender(projectId, selectedRoundId ?? '', {
        variant,
        white_label: whiteLabel,
        include_evidence: includeEvidence,
      }),
    enabled: selectedRoundId !== null && rendered,
  });

  const doc: ReportDocument | null = docQuery.data ?? null;

  return (
    <div>
      <PageHeader title={t('report.title')} description={t('report.subtitle')} />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('report.staticNote')}
      </Typography.Paragraph>

      <SectionCard
        title={t('report.settingsTitle')}
        extra={
          <Button
            type="primary"
            icon={<FileDoneOutlined />}
            disabled={selectedRoundId === null}
            loading={docQuery.isFetching}
            onClick={() => {
              setRendered(true);
              // 已经生成过时，同一个 key 不会自动重取 ⇒ 显式 refetch，让白标改动生效。
              if (rendered) void docQuery.refetch();
            }}
          >
            {t('report.render')}
          </Button>
        }
      >
        <Row gutter={16}>
          <Col span={10}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('report.round')}
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={selectedRoundId ?? undefined}
              placeholder={t('report.round')}
              onChange={setRoundId}
              options={rounds.map((round) => ({
                value: round.id,
                disabled: UNRENDERABLE_STATUSES.includes(round.status),
                // 轮次名是数据（中文），状态是枚举 ⇒ 状态查词典后拼在数据后面。
                label: `${round.label} · ${enumLabel(t, 'collection.statuses', round.status)}`,
              }))}
            />
            {hasUnrenderable && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {t('report.roundUnavailable')}
              </Typography.Paragraph>
            )}
          </Col>
          <Col span={14}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('report.variants.executive')} / {t('report.variants.detailed')} /{' '}
              {t('report.variants.white_label')}
            </Typography.Text>
            <Radio.Group
              value={variant}
              onChange={(event) => setVariant(event.target.value as ReportVariant)}
              options={[...REPORT_VARIANT_VALUES].map((value) => ({
                value,
                label: enumLabel(t, 'report.variants', value),
              }))}
              optionType="button"
              buttonStyle="solid"
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              {enumLabel(t, 'report.variantHints', variant)}
            </Typography.Paragraph>
          </Col>
        </Row>

        <Space size={8} style={{ marginTop: 12 }} align="center">
          <Switch checked={includeEvidence} onChange={setIncludeEvidence} size="small" />
          <Typography.Text>{t('report.includeEvidence')}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('report.evidenceHint')}
          </Typography.Text>
        </Space>

        {variant === 'white_label' && (
          <Form layout="vertical" size="small" style={{ marginTop: 12, maxWidth: 520 }}>
            <Typography.Text strong>{t('report.whiteLabel.title')}</Typography.Text>
            <Form.Item label={t('report.whiteLabel.agencyName')} style={{ marginBottom: 8 }}>
              <Input value={agencyName} onChange={(event) => setAgencyName(event.target.value)} />
            </Form.Item>
            <Form.Item label={t('report.whiteLabel.contact')} style={{ marginBottom: 8 }}>
              <Input value={contact} onChange={(event) => setContact(event.target.value)} />
            </Form.Item>
            <Form.Item
              label={t('report.whiteLabel.logoUrl')}
              style={{ marginBottom: 8 }}
              extra={t('report.whiteLabel.logoOptional')}
            >
              <Input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} />
            </Form.Item>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              {`${t('report.whiteLabel.defaultHint')} ${t('report.whiteLabel.applyHint')}`}
            </Typography.Paragraph>
          </Form>
        )}

      </SectionCard>

      {docQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={describeIpcError(docQuery.error, t)} />
      )}

      {doc === null && !docQuery.isError ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('report.empty')} />
      ) : null}

      {doc !== null && (
        <>
          <ReportExportBar doc={doc} />
          <ReportPreview doc={doc} />
        </>
      )}
    </div>
  );
}
