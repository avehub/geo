/**
 * 新建项目的**模式选择屏**（Plan B Task 7 · spec §7 / DR-36）。
 *
 * 左侧栏「项目」行最右端的「＋」落到这里（`components/SideNav.tsx` 的 DR-26）。
 * 这一屏只做一件事：让用户在**两条录入路径**里挑一条。
 *
 * ```
 * ┌─ 🌐 填网址自动采集 ────────┐  ┌─ ✍️ 手动录入 ──────────────┐
 * │ 走一遍抓取 → 抽取的流程      │  │ 5 步向导，字段与自动采集    │
 * │ 抽出来的字段你逐个确认       │  │ 的产出落在同一张实体卡上    │
 * │ [用网址建项]                │  │ [打开 5 步向导]            │
 * └────────────────────────────┘  └────────────────────────────┘
 * ```
 *
 * # 🔴 为什么要有这一屏，而不是让「＋」直接进向导
 * 产品负责人的原话是「新建项目页面可以选择输入网址自动采集，也可以手动录入」。
 * 直接把「＋」接到旧的 5 步向导上，等于把自动采集那条路藏进二级入口——而它恰恰是
 * 这个产品最省事的建档方式。所以「＋」先落到岔路口，两条路并列、同等显眼。
 *
 * # 🔴 底部那句「字段口径一致」不是装饰
 * 它是裁定 3（录入信息数据和页面可以根据自动采集流程）的上屏表达。**判据不在这句话上**：
 * 向导字段集与实体卡字段的对齐由 `components/wizard-steps.test.ts` 的四条断言钉住
 * （映射表镜像 Rust `fields_from_draft`，真值源 `crates/geo-domain/src/entity_card.rs:508-540`）。
 * 文案承诺与可执行判据分开，才不会出现"界面说一致、代码里两套字段"的情况。
 *
 * # 不发任何 IPC
 * 岔路口不碰数据面（判据在 `NewProjectPage.test.tsx` ③）：项目清单由左侧栏自己拉，
 * 这一屏渲染即所见，没有 loading 态可言。
 */
import { Alert, Button, Card, Col, Row, Space, Typography } from 'antd';
import { FormOutlined, GlobalOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import PageHeader from '../components/ui/PageHeader';

export default function NewProjectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader title={t('project.new.title')} description={t('project.new.subtitle')} />

      <Row gutter={16}>
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space size={8}>
                <GlobalOutlined />
                {t('project.new.autoTitle')}
              </Space>
            }
            style={{ height: '100%' }}
          >
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('project.new.autoDesc')}
            </Typography.Paragraph>
            {/* 按钮不带图标：图标已经卡在卡片标题上，重复一个只会让可访问名变成「global 用网址建项」。 */}
            <Button type="primary" onClick={() => navigate('/projects/new/auto')}>
              {t('project.new.autoAction')}
            </Button>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            title={
              <Space size={8}>
                <FormOutlined />
                {t('project.new.manualTitle')}
              </Space>
            }
            style={{ height: '100%' }}
          >
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('project.new.manualDesc')}
            </Typography.Paragraph>
            <Button onClick={() => navigate('/projects/new/wizard')}>
              {t('project.new.manualAction')}
            </Button>
          </Card>
        </Col>
      </Row>

      <Alert type="info" showIcon style={{ marginTop: 16 }} message={t('project.new.sameFields')} />
    </div>
  );
}
