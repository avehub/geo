# 项目概览首页（Project Overview）设计与 M9 组合汇总口径

> 状态：demo 侧已落地（2026-10-29）
> 范围：项目级概览首页（P0 + P1）；M9 多项目组合的数据层与组合页见
> `2026-10-29-portfolio-overview-design.md`
> 关联：产品定义 §3.1（可交付物导向 / 证据优先）、§4（统计纪律）、附录 C（头号 KPI 与五维）；
> AGENTS 规则 6 / 7 / 8 / 9；差异台账 E-73

## 1. 定位

首页不是"仪表盘截图"，而是**每天打开客户端后 5 秒内能回答三个问题**的入口：

1. **我现在怎么样**：最近一轮有结论的 GEO 结果；
2. **哪里最差**：未读告警、事实错误、低置信度复核；
3. **下一步做什么**：未完成处方与可下钻的交付物。

因此首页只放**结论、风险、动作**，不放原始证据表、不放十列矩阵、不放机会规则明细。
完整数据留在各模块页，首页每个区块都有"查看详情"入口。

## 2. 一屏的信息顺序

```
口径锚（这是哪一轮 / 样本多大 / 口径哪一版）
头号 KPI 四宫格（值 + 环比 + 区间 + 一句口径）
趋势折线（3 轮）           竞品对照（本品牌 + 覆盖最高的两家，横向条形）
风险与待办（按来源汇总 + 优先 3 条）   下一步行动（进度环 + 未完成 Top 4）
站外数据对账（传统搜索 / AI 回答分面）   交付进度（文章 / 官网补丁）
引擎差异（最认可 / 最易说错）
口径说明（区间 / 环比 / 演示静态值）
```

顺序即决策顺序：**我在哪 → 差多少 → 在变好还是变坏 → 哪里出问题 → 今天做什么 → 凭什么信**。

## 3. 不同模块的展示形式（为什么不是一张大表）

| 模块 | 数据特性 | 展示形式 | 理由 |
|---|---|---|---|
| 头号 KPI | 单点 + 环比 + 区间 | 四张数字卡 | 数字是结论；环比给方向；区间防把波动当变化 |
| 趋势 | 有序时间序列（按轮次，不是按天） | 折线 + 区间标注 | demo 没有真调度，**不做日粒度**；进行中的轮次不进线 |
| 竞品 | 同轮、同分母的横向比较 | 横向条形 + 差距句 | 首页只要"差多少"；十列矩阵留在诊断页 |
| 风险 | 三类异构待办（告警 / 核查 / 复核） | 按来源汇总 + 优先 3 条 | 三类可操作性不同：看归因 / 结办 / 复核；混排长表读不完 |
| 行动 | 有阶段状态的清单 | 进度环 + 未完成 Top | 状态清单不适合折线；名次照后端 `rank`，前端不重排 |

## 4. 轮次锚定 vs 项目累计（最容易做错的一条）

- **结果区按轮次锚定**：KPI / 趋势 / 竞品只跟右上角选中的**有结论轮次**走。
  - 有结论 = `status ∈ {succeeded, partial}`；`queued` / `running` / `failed` 一律不进。
  - 默认取 `round_index` 最大的一轮有结论轮次，**不是**"最新一轮"（最新一轮可能在跑）。
  - 环比只与上一有结论轮次比较；`metric_spec_version` 变化 ⇒ 环比为 `null`。
- **待办区按项目累计**：风险与处方是"今天要处理的活"，上一轮没结办的事实问题今天仍然存在。
  风险队列跨所有有结论轮次累计，每条带轮次名；进行中轮次的预置问题**不进入**。
- 没有任何结论轮次是正常形态：给空态 + 去采集，行动区照常显示。

## 5. 数据来源与命令面

**本轮零新增 IPC 命令**（`IPC_COMMANDS` 保持 105）：

| 区块 | 既有命令 |
|---|---|
| 项目 / 官网 | `project_get` |
| 轮次清单 | `collection_board` |
| KPI / 趋势 / 告警 | `diagnosis_overview`（当前轮 + 上一轮各一次） |
| 竞品 | `diagnosis_competitors` |
| 核查待办 | `fact_check_list`（每个有结论轮次一次） |
| 复核待办 | `insight_list({ needs_review: true })`（每个有结论轮次一次） |
| 处方进度 | `action_board` |
| 引擎差异 | `diagnosis_engines` |
| 站外对账（P1） | `search_board` + `search-compose.summarizeMetrics` |
| 交付进度（P1） | `article_list` + `site_board` |

跨模块的**选择 / 相减 / 排序 / 计数 / 分位数**全部在
`apps/desktop/ui/src/api/overview-compose.ts`（单项目：选轮 / 环比 / 风险 / 行动）与
`apps/desktop/ui/src/api/portfolio-compose.ts`（M9：快照 / 分布 / 逐项目行）（纯函数，demo 与桌面端共用），
与 `search-compose.ts` 同族；真后端将来若加聚合命令，必须复用同一份口径。

## 6. M9 多项目组合汇总（数据层；组合页见另一份 spec）

### 6.1 形状

单项目快照 `ProjectOverviewSnapshot`（项目页与组合页共用）：

```
project   { id, name, brand_name, status, website }
round     { id, label, round_index, collected_at, sample_size, sample_size_grade, metric_spec_version } | null
metrics   OverviewMetric[]            // 四个头号指标，含 delta / margin
risks     OverviewRisk[]              // 项目累计待办
actions   ActionProgress              // 计数 + 未完成 Top
```

组合汇总 `summarizePortfolio(snapshots, { includeArchived })`：

```
project_count / projects_with_round / projects_insufficient
total_sample_size                     // 计数可以求和
projects_with_risks / risks_total / risks_by_source
distribution[key] = { count, min, median, max }
latest_collected_at / oldest_collected_at
rows                                  // 按「风险多 → 覆盖低 → 名称」排
```

### 6.2 口径（硬约束）

1. **比率不平均、不求和**：不同项目的分母（题量 / 引擎覆盖 / 同框题数）不同，
   "组合覆盖率"没有解释。组合层只给**分布**（min / median / max）与逐项目行。
2. **`total_sample_size` 可以求和**：它是计数，不是比率。
3. **没有结论的项目计入项目数，但不进指标分布**；样本分级不是 `sufficient` 的计入
   `projects_insufficient`。
4. **默认排除归档项目**（与左侧栏、项目列表默认口径一致）；`includeArchived` 显式打开。
5. **不做跨项目环比**：不同项目的轮次时间不同，相减没有意义。
6. 组合页的推荐布局：四张计数卡（项目数 / 有风险项目 / 样本不足项目 / 总样本量）
   + 指标分布条（min–median–max）+ 一张逐项目表（最近的轮次、覆盖率、总分、风险数、数据新鲜度）。

### 6.3 为什么先定数据层

M9 落地时若各页各写一套"项目摘要"，组合页与项目页必然出现两个覆盖率口径。
本轮先把 `ProjectOverviewSnapshot` 与 `summarizePortfolio` 用单测钉住（20 条），
组合页落地时只做渲染，不再改数据面。

## 7. 桌面端与 demo 边界

- 首页依赖的 6 个命令里，只有 `project_get` 在 Rust 侧存在；其余（采集 / 诊断 / 核查 / 行动）
  本轮仍只有 demo 侧实现（差异 E-33 起）。
- **不屏蔽** `ipc/unknown_command`（规则 8）：轮次清单取不到时页面不整页红屏，结果区显示错误码；
  竞品 / 风险 / 行动各自显示自己的错误。首页仍保留导航与项目级待办入口。
- demo 数字全部是预置静态值（规则 9）：`overview.staticNote` 与底部「口径说明」常驻。
- 一句话结论/差距句是**词典模板 + 数据插值**，不调 LLM、不做排名承诺（规则 6）。

## 8. P1 已落地（2026-10-29 追加）

- **站外数据对账**：`search_board` + `summarizeMetrics`，传统搜索 / AI 回答**分面**展示；
  常驻汇总区间（demo 传统搜索面收敛到 8/1–8/20，受头条截至日限制）、参与源、完整性旗标；
  不做跨面相加，不把百度统计并进曝光。
- **交付进度**：`article_list` + `site_board`，文章评审队列与官网补丁台账的计数与完成比例。
- **引擎差异 + 漏斗摘要**：`diagnosis_engines` 给"最认可 / 最易说错"两条；`diagnosis_funnel` 给
  认知 / 推荐 / 决策三层的提及率标签。完整表与漏斗图留在诊断页。

仍未做：站外数据的完整筛选器（时间 / 平台 / 面）、交付物的一键导出。

## 9. 验收与走查

1. 默认落第 3 轮（行动后复测），不是第 4 轮（进行中）。
2. 四个 KPI：55% / 55 / 38% / 91%，环比 +13pp / +11 / +6pp / +7pp，区间 ±5pp / ±4 分。
3. 竞品差距句：覆盖落后清源环保 1 个百分点；同框题目 9 道。
4. 风险汇总：未读告警 2；事实核查待处理 6；待复核解析按种子计；优先项第一条是「说错了」。
5. 行动：已完成 5 / 10；未完成 Top 从 rank 3 起。
6. 站外对账：传统搜索 20,090 曝光 / 650 点击；AI 回答 898 引用；区间 8/1–8/20；参与源 6；
   旗标含"站内分析已排除 / 含采样数据"。
7. 交付进度：文章待审 2 / 已通过 2 / 已打回 1；补丁已发布 6 / 草案 1 / 已撤回 1。
8. 引擎差异与漏斗：最认可 Kimi 63%，最易说错腾讯元宝 18%；认知层 78% → 推荐层 67% → 决策层 50%。
9. 切第 1 轮：覆盖率 20%，样本不足提示出现，环比消失。
10. 清空轮次：空态 + 去采集，行动区仍可见。
11. 英文界面：除项目名 / 处方标题 / 告警 detail 等数据外，整页无中文。

## 10. 文件地图

| 层 | 文件 |
|---|---|
| 页面 | `apps/desktop/ui/src/pages/OverviewPage.tsx` |
| 区块 | `components/OverviewAnchorCard.tsx` / `OverviewKpiCards.tsx` / `OverviewCompetitorsCard.tsx` / `OverviewRisksCard.tsx` / `OverviewActionsCard.tsx` / `OverviewStationCard.tsx` / `OverviewDeliveryCard.tsx` |
| 单项目纯函数 | `apps/desktop/ui/src/api/overview-compose.ts` |
| M9 纯函数 | `apps/desktop/ui/src/api/portfolio-compose.ts` |
| 词典 | `i18n/locales/{zh-CN,en-US}/overview.ts`；`nav.overview` |
| 路由 / 导航 | `App.tsx`（`/projects/:id/overview` + `/projects/:id` 重定向）；`components/SideNav.tsx`（第一项） |
| 判据 | `pages/OverviewPage.test.tsx` / `api/overview-compose.test.ts` / `api/portfolio-compose.test.ts` / `pages/PortfolioPage.test.tsx` / `pages/en-us-page-residual.test.tsx` |
