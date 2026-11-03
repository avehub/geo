/**
 * 填网址自动采集屏（Plan B Task 7 · spec §7 / DR-36）。
 *
 * # 链路：先建后抽，两条**既有**命令，不加新契约
 * ```
 * 填网址 → project_create → entity_card_autobuild → project_update（回填项目名）→ /projects/:id/entity-card
 * ```
 * DR-36 的裁定就是"不改命令签名"：真后端没有"只给一个网址就建项"的命令，这一屏是
 * demo 侧把两条既有命令**组合**出来的（差异登记见台账 E-49）。
 *
 * # 🔴 三段进度是**演出**，不是状态机的副产品
 * `抓取中` → `抽取中` → `完成 N% 字段`。真后端抓一个站要几十秒，所以"等待形态"本身就是
 * 这轮要验收的东西；demo 里两条命令几十毫秒就回来了，一步跳完等于把要验收的东西跳掉了。
 * 于是每段给一个**最短停留**（`STAGE_MIN_MS`），与命令的真实耗时取较晚者。
 *
 * # 🔴 演示提示全程常驻
 * demo 不联网、不真抓网页、抽取结果是种子里的预置数据（AGENTS 规则 2 / 9）。这句话在
 * 开跑前、跑动中、失败后都在——只在结束时冒出来的话，走查的人会以为刚才真抓了站点。
 * 与 M3「不采集」、M4「不跑模型」同一口径。
 *
 * # 🔴 抽取失败要**回滚**刚建的项目
 * 先建后抽的代价：域名非法时项目已经落库了。不删掉，每试一次错网址就在清单里留一个空壳
 * （`project_delete` 是既有命令，回滚失败也不许盖住原始错误）。
 *
 * # 项目名先用 host 占位，抽取成功后回填
 * `project_create` 的草稿必须有品牌名，而这一刻我们只有网址 ⇒ 先用 host（ASCII 数据，
 * 不是文案）。抽到的 `standard_name` 回来后用它回填，否则左侧清单里躺着一条叫
 * `demo-brand.example.com` 的项目。真后端由抓取结果命名，这一步在 demo 里显式做。
 */
import { useState } from 'react';
import { Alert, App, Button, Card, Input, Space, Steps, Typography } from 'antd';
import { ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import PageHeader from '../components/ui/PageHeader';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import { describeIpcError } from '../api/errors';
import { toProjectDraft } from '../store/wizard-draft';

/** 进度阶段。`idle` 是没有开跑（也是失败后回落的态），不是一个可见的段。 */
type Stage = 'idle' | 'crawling' | 'extracting' | 'done';

/** 每段最短停留：真后端抓取要几十秒，demo 里也不能一闪而过（见头注释）。 */
const STAGE_MIN_MS = 240;
/** 「完成 N% 字段」的停留：不留这一下，第三段就只是个来不及读的闪屏。 */
const DONE_LINGER_MS = 360;

function dwell(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 从网址里取出 host 当临时品牌名。
 *
 * 🔴 刻意**不做**任何合法性判断：域名校验是后端的职责（`assertDemoDomain` 镜像
 * `crates/geo-domain/src/asset.rs:102-118`），前端再实现一份就是第二套真相——
 * 两套判断不一致时，用户看到的是"前端放行了、后端拒了"。这里只负责给个不难看的占位名，
 * 解析不出来就原样用输入串。
 */
function brandNameFromUrl(raw: string): string {
  const normalized = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const host = new URL(normalized).hostname;
    return host === '' ? raw : host;
  } catch {
    return raw;
  }
}

export default function AutoBuildProjectPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [percent, setPercent] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = stage !== 'idle';

  async function start() {
    const value = url.trim();
    // 空网址就地拦下：不发任何 IPC（判据在 `AutoBuildProjectPage.test.tsx` ①）。
    if (value === '') {
      setLocalError(t('project.autobuild.emptyUrl'));
      return;
    }

    setLocalError(null);
    setStage('crawling');
    let createdId: string | null = null;

    try {
      const [project] = await Promise.all([
        client.projectCreate(
          toProjectDraft({ brand_name: brandNameFromUrl(value), website: value }),
        ),
        dwell(STAGE_MIN_MS),
      ]);
      createdId = project.id;

      setStage('extracting');
      const [card] = await Promise.all([
        client.entityCardAutobuild(project.id, value),
        dwell(STAGE_MIN_MS),
      ]);

      const standardName = card.fields.standard_name.trim();
      if (standardName !== '') {
        await client.projectUpdate({
          ...project,
          name: standardName,
          brand_name: standardName,
        });
      }
      // 左侧栏的项目清单与「全部项目」那张表共用 `['projects', …]` 前缀 ⇒ 一次失效两处都刷新。
      void queryClient.invalidateQueries({ queryKey: ['projects'] });

      setPercent(Math.round(card.completeness * 100));
      setStage('done');
      await dwell(DONE_LINGER_MS);
      navigate(`/projects/${project.id}/entity-card`);
    } catch (error) {
      if (createdId !== null) {
        // 回滚：抽取失败时项目已经建出来了，留着就是一个空壳（见头注释）。
        // 回滚自己再失败也不许盖住原始错误——用户要看到的是"网址不对"，不是"删不掉"。
        try {
          await client.projectDelete(createdId);
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
        } catch {
          /* 留在这一步的错误就是用户要看到的那一条 */
        }
      }
      setStage('idle');
      // 与 `ProjectWizardPage` 同一口径（裁定 B-5）：`IpcRequestError` 走词典渲染，
      // 另一支不许降级成 `common.unknownError`——「请检查网址后重试」才是可操作提示。
      const text =
        error instanceof IpcRequestError
          ? describeIpcError(error, t)
          : t('project.autobuild.failed');
      setLocalError(text);
      message.error(text);
    }
  }

  const stepIndex = stage === 'crawling' ? 0 : stage === 'extracting' ? 1 : 2;
  const stepStatus = stage === 'done' ? 'finish' : busy ? 'process' : 'wait';
  const stageText =
    stage === 'crawling'
      ? t('project.autobuild.stageCrawling')
      : stage === 'extracting'
        ? t('project.autobuild.stageExtracting')
        : stage === 'done'
          ? t('project.autobuild.stageDone', { percent })
          : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title={t('project.autobuild.title')} />

      {/* 🔴 常驻：不是"跑完之后才告诉你这是演示"。 */}
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('project.autobuild.demoNotice')} />

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text strong>{t('project.autobuild.urlLabel')}</Typography.Text>
            <Space.Compact style={{ width: '100%', maxWidth: 520, marginTop: 4 }}>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onPressEnter={() => void start()}
                placeholder={t('project.autobuild.urlPlaceholder')}
                disabled={busy}
                allowClear
              />
              <Button
                type="primary"
                // 🔴 `aria-hidden`：装饰性图标默认带 `role="img" aria-label="thunderbolt"`，
                // 会把可访问名变成「thunderbolt 开始采集」——读屏念出来是噪音，测试也点不中。
                icon={<ThunderboltOutlined aria-hidden />}
                loading={busy}
                onClick={() => void start()}
              >
                {t('project.autobuild.start')}
              </Button>
            </Space.Compact>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
              {t('project.autobuild.urlExtra')}
            </Typography.Paragraph>
          </div>

          <Steps
            size="small"
            current={stepIndex}
            status={stepStatus}
            items={[
              { title: t('project.autobuild.stepCrawl') },
              { title: t('project.autobuild.stepExtract') },
              { title: t('project.autobuild.stepConfirm') },
            ]}
          />

          {stageText !== null && <Alert type="info" showIcon message={stageText} />}
          {localError !== null && <Alert type="error" showIcon message={localError} />}

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('project.autobuild.confirmHint')}
          </Typography.Text>

          <Space size={8}>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              disabled={busy}
              onClick={() => navigate('/projects/new')}
            >
              {t('project.autobuild.backToModes')}
            </Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
