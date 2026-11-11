# 文档分级索引

按「**改这块代码前必须读什么**」组织。层级越低越权威；下层与上层冲突时以上层为准，
并应回头修订下层文档。

## L0 真值源（冲突时以这两份为准）

| 文档 | 作用 |
|---|---|
| [`GEO客户端-MVP产品定义-v1.md`](GEO客户端-MVP产品定义-v1.md) | **唯一需求真值源**。产品范围、指标口径、合规红线 |
| [`../AGENTS.md`](../AGENTS.md) | **硬性规则 1–11**、crate 分层、工具链命令、共享接缝 owner、提交规范 |

## L1 当前状态与差异台账（动手前必读）

| 文档 | 什么时候必须读 |
|---|---|
| [`superpowers/current-state.md`](superpowers/current-state.md) | 改 demo、命令面、站长数据、项目概览、文章管理、站点接入前。含命令面现状（2026-11-06 核对：**108 条 = 108 条 Rust + 0 条 demo-only**）、demo-only 族、当前边界与各轮细节 |
| [`superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`](superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md) | **改 demo 前必读**。发现新差异按该文件 §1 的判据登记，编号从文件末尾续号，不重号、不跳号 |

## L2 模块设计与裁定

| 文档 | 覆盖范围 |
|---|---|
| [`superpowers/specs/2026-09-16-geo-desktop-p0-design.md`](superpowers/specs/2026-09-16-geo-desktop-p0-design.md) | P0 总体设计与工程基座 |
| [`superpowers/specs/2026-09-18-geo-desktop-demo-i18n-settings-design.md`](superpowers/specs/2026-09-18-geo-desktop-demo-i18n-settings-design.md) | i18n 词典契约（§4.2 错误码 → 文案渲染）、demo 后端、设置 |
| [`superpowers/specs/2026-09-28-demo-m3-m7-closed-loop-design.md`](superpowers/specs/2026-09-28-demo-m3-m7-closed-loop-design.md) | **改采集 / 解析 / 诊断 / 行动 / 报告前必读**（M3–M7 demo 闭环） |
| [`superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md`](superpowers/specs/2026-09-29-plan-b-navigation-settings-newproject-design.md) | **改 `/settings/:section` 五段、新建项目双入口前必读** |
| [`superpowers/specs/2026-09-30-keyword-faq-library-design.md`](superpowers/specs/2026-09-30-keyword-faq-library-design.md) | **改素材层（关键词库 / FAQ）、导出或引用进 Prompt 题库前必读** |
| [`superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`](superpowers/specs/2026-09-30-site-connect-patch-bench-design.md) | **改站点通道、补丁下发 / 撤回 / 回滚前必读**；先看 §2 调研与 §3 裁定 |
| [`superpowers/specs/2026-10-01-entity-card-slim-and-knowledge-base-design.md`](superpowers/specs/2026-10-01-entity-card-slim-and-knowledge-base-design.md) | 实体卡瘦身与知识库前身设计 |
| [`superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`](superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md) | **改知识库卡片、修订留痕、文章管理前必读** |
| [`superpowers/specs/2026-10-12-webmaster-data-integration-design.md`](superpowers/specs/2026-10-12-webmaster-data-integration-design.md) | **改站长数据导入 / 归一 / 机会 / 凭据前必读**；先看 §3.4c 的**禁止模拟登录**裁定（DR-114 / DR-115） |
| [`superpowers/specs/2026-10-29-project-overview-home-design.md`](superpowers/specs/2026-10-29-project-overview-home-design.md) | **改首页轮次锚定、待办、M9 组合口径前必读** |
| [`superpowers/specs/2026-10-29-portfolio-overview-design.md`](superpowers/specs/2026-10-29-portfolio-overview-design.md) | **改 `/portfolio` 组合总览前必读**（命令面零新增；比率不平均、不求和、不跨项目环比） |
| [`superpowers/specs/2026-10-30-visual-refresh-and-nav-grouping.md`](superpowers/specs/2026-10-30-visual-refresh-and-nav-grouping.md) | 视觉刷新与导航分组 |
| [`superpowers/specs/2026-11-03-plan-c-preflight-contract-checklist.md`](superpowers/specs/2026-11-03-plan-c-preflight-contract-checklist.md) | Plan C 前置契约检查清单 |
| [`superpowers/specs/2026-11-06-webmaster-data-acquisition-options.md`](superpowers/specs/2026-11-06-webmaster-data-acquisition-options.md) | 站长数据获取通道选型（GSC OAuth / 百度站长 Chrome 取数） |
| [`superpowers/specs/2026-11-10-release-signing-distribution-design.md`](superpowers/specs/2026-11-10-release-signing-distribution-design.md) | **发布工程裁定源**：许可证 / macOS 签名公证 / Windows 签名 / CI 打包 / 版本号真值源 / Secrets 清单。改 `release.yml`、`scripts/version.sh`、`scripts/setup-signing.sh`、`tauri.conf.json` 的 `bundle` 段前必读 |

## L3 实施计划

[`superpowers/plans/`](superpowers/plans/) —— 计划文件里的 task/step 顺序是**硬依赖**。
只并行明确无依赖的 task；同一 task 内有先后依赖的 step 必须串行。

## L4 调研与测试报告（参考，不作为裁定依据）

| 文档 | 说明 |
|---|---|
| [`superpowers/specs/2026-10-10-kb-and-article-studio-ux-survey.md`](superpowers/specs/2026-10-10-kb-and-article-studio-ux-survey.md) | 知识库 / Article Studio 市场调研 |
| [`superpowers/test-reports/`](superpowers/test-reports/) | 真人走查与本地全量测试记录 |

## 机器可读契约（改代码时同步改这里）

[`../contracts/`](../contracts/)：

| 文件 | 内容 |
|---|---|
| `ipc-command-surface.json` | 命令面对照表（前端清单 ↔ demo 后端 ↔ Rust 注册） |
| `error-codes.json` | 稳定错误码契约（后端只返回码 + 语言中立 params） |
| `search-import-reasons.json` | 导入归一的原因码 |

## 对外文档（随产品分发 / 公开仓库门面）

| 文档 | 说明 |
|---|---|
| [`../LICENSE`](../LICENSE) | 专有软件许可协议（All Rights Reserved） |
| [`../SECURITY.md`](../SECURITY.md) | 漏洞报告渠道 + 安全不变量 + 已知风险面 |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 环境、命令、开发纪律、提交规范、验收要求 |
| [`legal/`](legal/) | 隐私政策与用户协议**草稿**（发布前须法务复核 + 补齐 `【待填：…】` 占位符） |

## 维护方式

- **命令增删**：先改 `apps/desktop/ui/src/api/client.ts` 的 `IPC_COMMANDS` 与 demo 后端，
  再更新 `current-state.md` 的「当前命令面」表和差异台账；Rust 侧是否落地以规格 / 台账为准，
  **不**按 demo-only 命令机械补注册。
- **新增里程碑**：先写 spec / plan，落地后再回填 `current-state.md`。
- **新增 spec**：文件名用 `YYYY-MM-DD-<主题>-design.md`，加进上面的 L2 表格，
  并在 `AGENTS.md`「必读上下文」里登记「改 X 前必读」。
- **文档与代码冲突**：以代码的实际行为为准记录现状，再决定是改代码还是改文档；
  **不要**在文档里写「计划中」当成「已实现」。
