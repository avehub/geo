# 知识库重构（M1.2b）与文章管理 Article Studio（M6）设计

> **状态**：demo 侧设计（AGENTS 规则 8）；**Rust 侧本轮零改动**。
> **缘起**：用户指示 2026-10-10，两条：① 知识库页再优化——不要与实体卡重复的内容模块卡片，
> 其余卡片模仿成熟产品的知识库体系与交互（品牌销售话术 / 客服话术 / 产品卖点 / 素材的存储与展现），
> 现状"展现过于单一、不易操作"；② 项目下新增「文章管理」二级菜单——方向/策略 → 提示词模板 →
> 定时任务生成文章。
> **市场调研**：`2026-10-10-kb-and-article-studio-ux-survey.md`（Guru / Notion / Confluence / Slite /
> Document360 / Highspot / Seismic / Klue / Intercom / Help Scout / Jasper / Copy.ai / HubSpot）。
> **编号续接**：DR 续 `2026-10-01-entity-card-slim-and-knowledge-base-design.md`（DR-72 止）；
> 差异台账续 `2026-09-23-demo-vs-backend-known-divergences.md` §4f（E-62 止）→ 本轮 §4g E-63…E-66。

## 1. 两条指示的裁定

1. **"不需要实体卡相同的内容模块卡片" ⇒ 同步块整体退役**（DR-66 / DR-67 / DR-68 作废，
   上轮"基于实体卡变动自动更新"的要求被本指示取代）。理由：同步块把实体卡 / 项目字段**再活现一遍**，
   用户看到的是重复卡片；而"结合项目录入的信息"这个价值用**一次性显式导入**保留（DR-73 / DR-81）——
   导入是用户点一下才发生的复制，来源标签写「导入」，之后源头再改**不**跟随（界面上写明）。
   代价：台账 E-61（投影自动更新）一并作废，本文 §5 登记。
2. **"模仿成熟产品的知识库体系与交互" ⇒ 模块taxonomy v2 + 四种展现/交互升级**（DR-74 … DR-79）：
   新增销售话术 / 客服话术两个模块与「场景」维度；视图切换（分组面板 / 密集表格）；编辑器改侧滑；
   按形式渲染卡片（话术引文体 + 一键复制、长文折叠、素材画廊格）。
3. **"文章管理" ⇒ M6 内容生产的落地页**（DR-83 … DR-89）：方向 → 模板 → 排期 → 文章评审队列。
   导航位裁定：行动中心（M5）之后、站点接入（M6.5）之前——内容生产在处方之后、官网补丁之前。

## 2. 从市场调研采纳的模式（出处见 survey 文件）

| 模式 | 出处 | 落到本轮 |
|---|---|---|
| 数据库多视图（gallery / table 切换 + 过滤条） | Notion | DR-76 |
| 卡片编辑器侧滑 peek，不挡上下文 | Notion / Guru / Slite | DR-77 |
| 核实工作流与信任标签 | Guru | 沿用 `contentStatuses` / `verified_at`，统计条保留待审核 / 未核实 |
| playbook 按销售阶段 / 场景分组 | Highspot / Seismic | DR-75 / DR-78 |
| battlecard：竞品一行一张对照表 | Klue | DR-78（table 视图即对照表） |
| saved reply 一键复制 | Intercom / Help Scout | DR-79 |
| 素材库画廊格 + 类型徽章 + 缩略占位 | Highspot / Seismic | DR-78（media） |
| 模板槽位 chips 点击插入 + 实时预览 | Jasper / Copy.ai | DR-86 |
| 周期生成的配置面（频率 + 时间 + 绑定对象） | Copy.ai workflows / HubSpot campaigns | DR-84 / DR-86 |
| 生成物一律进人工评审队列 | Jasper / HubSpot（human-in-the-loop） | DR-85（规则 6） |
| 分类树（Document360 / 语雀） | — | **不采纳**：11 个固定模块 + 视图切换已够，树是第三套导航（成本） |
| 搜索 facets（Bloomfire） | — | **不采纳**：保留既有 4 过滤 + 搜索，facets 在 28 条量级是过度设计 |

## 3. 知识库重构（DR-73 … DR-82）

### DR-73 · 同步块退役
- `kb_board` 返回删 `synced` / `stale_ids` / `entity_card_updated_at`；`KbStats` 删 `synced` / `stale`；
  `KbEntry` 删 `origin` / `origin_block_id` / `field_path`；`KbSyncedBlock` / `KbOrigin` 类型删除。
- 命令 **`kb_entry_detach` 删除**（它只为同步块存在）⇒ kb 族 7 → **6**；「重新同步」逻辑一并删除。
- `components/kb-view.ts` 删 `composeSyncedRow` / `findSyncedBlock`；`toKbRows` 只吃 entries。
- 绿色同步横幅换成**静态职责说明条**：实体卡装结构化事实、知识库存可复用表达与素材，
  并提供「从实体卡导入」入口（DR-81）。

### DR-74 · 模块 taxonomy v2（11 个，固定枚举，续 DR-63 的姿态）
`brand` 品牌概况 / `product` 产品知识 / `selling_point` 产品卖点（原 `differentiator` 改名）/
`sales_script` 销售话术（新）/ `support_script` 客服话术（新）/ `case` 客户案例 /
`competitor` 竞品对照 / `audience` 人群与场景 / `tone` 官方口径与合规 /
`qualification` 资质与认证 / `media` 素材库。
- **删 `service`**：联系方式 / 服务地域是实体卡字段，留第二活现面就是 DR-73 要消灭的东西。
- 种子迁移：`differentiator` → `selling_point`；原 service 模块只有同步块 ⇒ 无存量损失。

### DR-75 · 场景维度 `scenario`
- `KbEntry.scenario: KbScenario | null`；枚举 10 值：`sales_first_contact` / `sales_needs` /
  `sales_objection` / `sales_quote` / `sales_closing` / `sales_followup` /
  `support_presale` / `support_aftersale` / `support_complaint` / `support_return`。
- 仅 `sales_script` / `support_script` 有意义；handler 对非话术模块**强制置 null**（不报错，避免误伤）。
- 分组视图里话术模块按 scenario 出子标题；编辑器里 scenario 选择仅话术模块可见。

### DR-76 · 视图切换 `group | table`
- `group`（默认）：模块面板（现状骨架保留，卡片渲染升级 DR-78）；
- `table`：antd `Table`，列 = 模块 / 形式 / 标题(+标签) / 场景 / 状态 / 来源 / 核实时间 / 更新时间 / 操作；
  `rowSelection` 接既有批量核实 / 删除；competitor 模块在 table 视图即 Klue 式对照表。
- 视图态只存 `useState`（刷新即重置，与 demo 口径一致），**不**落 localStorage。

### DR-77 · 编辑器改侧滑 Drawer（`KbEntryModal` → `KbEntryDrawer`，宽 560）
字段：模块 / 形式 / 场景(仅话术) / 标题 / 正文 / 地址 / mime / 标签 / 状态(仅编辑时)。命令不变。

### DR-78 · 按形式渲染卡片
- `statement`：引文体（左竖线 + 稍大字号）+ 复制按钮；
- `text`：三行 clamp + 展开/收起；
- `link`：地址外链 chip；
- `image` / `video` / `file`：**画廊格**（类型图标 + mime 徽章 + 标题），不拉远端流（规则 2，说明常驻），
  点击开 Drawer 预览元数据；
- 话术卡：场景子标题下引文体 + 复制按钮 + 「适用场景」标签；
- `competitor`：group 视图卡片带官网链接与要点；table 视图一行一竞品。

### DR-79 · 一键复制
`navigator.clipboard.writeText`（测试里 stub）；成功 `message.success(t('kb.entry.copied'))`。

### DR-80 · 统计条 v2（6 个）
有内容的模块 / 知识条目 / 话术条目 / 待审核 / 未核实 / 多媒体。

### DR-81 · 从实体卡导入（一次性复制）
- 入口：工具条「从实体卡导入」→ Modal 分组勾选（实体卡 7 字段 + 项目：竞品 / 资产 / 行业地域标签）；
  每行显示预览标题、落入模块、映射状态（实体卡 `field_status`：`official` → `approved`，
  其余 → `pending_review`；项目来源一律 `pending_review`）。
- 组装在**前端** `components/kb-import.ts`（标签词语言相关，同 kb-view 的裁定）；
  落库走既有 `kb_entry_add`，draft 增可选 `source: 'imported'`（handler 白名单只认这一个覆盖值，
  默认仍 `manual`）⇒ **不新增命令**。
- 🔴 不 dedup、不跟随：Modal 里写明"导入是一次性复制，源头后续修改不会同步"。

### DR-82 · i18n
删 `kb.sync.*`；增 `kb.view.*` / `kb.scenarios.*` / `kb.import.*` / `kb.entry.copied` /
`kb.stats.scripts`；`kb.modules.*` 与 `modulesHint` 按 v2 重写（zh + en）。合规扫描命名空间不变（`kb` 已在）。

## 4. 文章管理 Article Studio（DR-83 … DR-89）

### DR-83 · 导航与路由
二级项 `articles`（文章管理），排在**行动中心之后、站点接入之前**；路由 `/projects/:id/articles`；
图标 `EditOutlined`。未选项目不出现（同其余二级项）。

### DR-84 · 对象模型（`api/types-article.ts`）
- `ArticleDirection`：id / project_id / title / summary / source(`manual|generated`) /
  status(`active|archived`) / created_at。
- `ArticleTemplate`：id / project_id / direction_id / name / prompt_template（含 `{{slot}}`）/
  slots / bindings `{ product_names: string[]; keyword_texts: string[]; audience: string | null }` /
  kb_modules: KbModule[]（**只记录不拼接**，DR-89）/ style / length / created_at / updated_at。
- 槽位枚举 `ARTICLE_SLOT_VALUES`：`brand` / `product` / `keyword` / `audience` / `scenario` / `competitor`。
- `ArticleSchedule`：id / project_id / template_id / freq(`daily|weekly`) / time(`HH:mm`) /
  weekday(1-7, weekly 必填) / enabled / next_run_at / last_run_at / run_count。
- `Article`：id / project_id / direction_id / template_id / schedule_id|null /
  source(`scheduled|manual`) / title / body_markdown / status(`pending_review|approved|rejected`) /
  word_count / generated_at。

### DR-85 · demo 的能力边界（规则 9 / 规则 2 / 规则 6）
- **没有真 cron**：刷新即重置回种子；`next_run_at` 是种子期按 freq+time 相对演示月份算的静态值；
  「立即运行一次」= `article_schedule_run` / 模板「立即生成」从**预置文章池**取（确定性、按标题去重），
  生成物一律 `pending_review` 并挂「演示模式未执行合规扫描」标签。
- 排期到点**不**自动跑（没有定时器）；界面上写明"演示模式不跑真实定时任务"。

### DR-86 · 三个工作区（单页三 Tab 或三段）
① **方向**：卡片列表 + 「AI 生成方向」（预置池）+ 手动新增 + 归档；
② **模板**：列表 + Drawer 编辑器（槽位 chips 点击插入光标、实时预览用项目真实值替换槽位、字数）；
③ **排期与文章**：排期表（开关 / 频率 / 时间 / 绑定 / 下次运行 / 立即运行）+ 文章评审队列
（状态筛选、预览 Drawer、批量通过、导出 Markdown 复用 `LibraryExportModal`）。

### DR-87 · 命令面（10 条，🔴 全 demo 独有）
`article_direction_list` / `article_direction_add` / `article_direction_generate` /
`article_template_list` / `article_template_save` / `article_template_delete` /
`article_schedule_list` / `article_schedule_save` / `article_schedule_run` / `article_list`。
⇒ `IPC_COMMANDS` 90 → **99**；demo 独有族 50 → **59**。
🔴 算术口径（本行原先写的 100 / 60 是错的，已改正）：同一轮里 kb 族**减了一条**
（`kb_entry_detach`，见 DR-73），所以 −1 + 10 = **+9**；差异台账 §4g E-64 用的是这个口径。

### DR-88 · i18n
新命名空间 `article`（zh + en），进 `COMPLIANCE_NAMESPACES`；枚举标签走 `enumLabel`
（`article.freqs` / `article.statuses` / `article.slots` / `article.sources`）。

### DR-89 · 复用与不新增
导出复用 `export_write_file` + `LibraryExportModal`；方向引用关键词库 / 知识库**只记录绑定**
（`bindings.keyword_texts` / `kb_modules`），demo 不做真拼接注入（规则 9），预览里以 chips 展示。

## 5. 差异台账登记（§4g · E-63 … E-66）
- **E-63**：kb 族 7 → 6（`kb_entry_detach` 删）且同步投影退役；Rust 侧本无 kb 命令（E-60 口径延续）；
  上轮 **E-61（投影自动更新）整条作废**，它对 Plan C 的四条义务里 ①④ 一并免除、② 搬进导入映射表、
  ③ 随 `stale_ids` 消失（E-61 原文按台账 §7 的纪律保留不改，由 §4g 抬头那条声明作废）。
- **E-64**：article 10 条命令只有 demo 侧实现（总数 90 → **99**、demo 独有族 50 → **59**：
  同轮 kb 族减一条）；并登记「没有 `article_update` / `direction_update`，评审与归档寄生在读命令上」
  这个**临时契约形状**（真后端不应照抄）。
- **E-65**：demo 无真实定时任务引擎（next_run 静态、run_now 模拟、刷新不保留）。
- **E-66**：文章生成走预置语料池、不做合规扫描（与 E-62 同族；规则 6 的 pending_review 仍真做）。

## 6. 测试与守卫（本轮增量）
| 文件 | 改动 |
|---|---|
| `demo/handlers/kb.test.ts` | 删同步块 / detach / resync 用例；增 scenario 强制置 null、`source:'imported'` 白名单、taxonomy v2 断言 |
| `components/kb-view.test.ts` | 删 synced 组装用例；增 table 行组装 / scenario 分组用例 |
| `pages/KnowledgeBasePage.test.tsx` | 视图切换、话术复制、画廊格、导入 Modal、Drawer 编辑；删同步块两动作用例 |
| `components/kb-import.test.ts`（新） | 导入草稿组装：字段 → 模块 / 状态映射、zh+en 标签 |
| `demo/handlers/article.test.ts`（新） | 10 条命令正/反例、排期 run_now 去重、生成物 pending_review |
| `pages/ArticleStudioPage.test.tsx`（新） | 三工作区、模板槽位插入与预览、排期开关、评审队列、en-US 无中文 |
| `demo/seed.test.ts` | 新种子确定性；kb 种子 taxonomy v2 |
| `demo/backend.test.ts` | 命令账本：kb −1、article +10（总 90 → 100） |
| `components/SideNav.test.tsx` | 二级项 +1（`articles` 位序） |
| `i18n/*` 守卫 | 计数与命名空间按落地位回填 |

## 7. 走查清单（`mise run web`）
1. 知识库：无同步块卡片、无绿色同步横幅；统计条 6 个数字；11 个模块面板。
2. 视图切到「表格」：密集表 + 行选择 + 批量核实；competitor 一行一竞品。
3. 话术模块：场景子标题；点复制 → toast；statement 引文体；text 三行折叠可展开。
4. 素材模块：画廊格；点开 Drawer 预览；不加载远端媒体且写明原因。
5. 「从实体卡导入」：勾选 → 落库为来源「导入」；源头状态 official 的进「已通过」，其余「待审核」。
6. 编辑改侧滑 Drawer；话术模块才见场景选择。
7. 文章管理：方向卡（含 AI 生成）→ 模板 Drawer（槽位 chips 插入 + 实时预览）→ 排期表开关 / 立即运行
   → 文章队列待审核 + 免责声明；批量通过；导出 Markdown。
8. 切 en-US：两页整页无中文（数据除外）；刷新即重置。

## 8. 执行回填（2026-10-10 落地，demo 侧；Rust 零改动）

### 8.1 门禁（`mise run check` 全绿，`CHECK_EXIT=0`）

- cargo：**22 targets / 515 passed / 0 failed**（与上六轮同一基线，Rust 一行未改）；
  `cargo fmt --check` 与 `clippy -D warnings` 干净。
- vitest：**83 files / 1234 tests**（上一轮台账 §4f 是 79 files / 1207 tests）。
- `tsc -b` 干净、`eslint --max-warnings 0` 干净、`pnpm run build` 通过。

### 8.2 命令面与守卫数字（真值，取代 §4 DR-87 的旧算术）

- `IPC_COMMANDS`：**99**（90 − `kb_entry_detach` + 10 条 `article_*`）；demo 独有族 **59**。
  `demo/backend.test.ts` 的十三份账本里 `KB_COMMANDS` = 6、`ARTICLE_COMMANDS` = 10、
  `IMPLEMENTED_COMMANDS` = 99（5 处钉死）。
- `demo/seed.test.ts` 固定时间戳 = **273**（M1.2b 的 255 + M6 的 18）。
- `i18n/no-hardcoded-strings.test.ts`：components 扫描面 **81**（72 个 `.tsx` + 9 个非组件模块）、
  pages **24**、抽取面 **107**、`src/demo/seed/` 语义类 **20**；tokenSeparators 例外的路径改指
  `KbEntryDrawer.tsx`（命中数仍是 8）；B-4「同步块投影标签键集」整段（3 例）随 DR-73 删除。
- `pages/en-us-page-residual.test.tsx`：`SHORT_DATA_PINNED` **99 条**（M1.2b 净 +15、M6 净 +0）、
  `DATA_STRINGS_UPPER_BOUND` 750 → **820**（真值 715）、新增可执行判据 `EN_DICT_SHORT_OVERLAP`
  （短尾清单与 en-US 词典叶子值的交集，实测恒空）与 `ArticleStudioPage` 整页 en-US 用例；
  `seed/articles.ts` 已进 `DATA_STRINGS` 的模块清单。
- `i18n/enum-label-prefixes.test.ts` 前缀清单 **67**（+`article.freqs` / `slots` / `sources` / `statuses`）；
  `i18n/dictionary.test.ts` 的 `COMPLIANCE_NAMESPACES` **18** 个（+`article`）。
- `components/SideNav.test.tsx` 二级项 **12** 个，`articles` 夹在 `action` 与 `site` 之间。

### 8.3 实际文件清单

**知识库半场（M1.2b）**：`api/types-kb.ts`（11 模块 + 10 场景 + `KbStats` 六格）、
`demo/handlers/kb.ts`（6 条命令）、`demo/seed/kb.ts`（25 条 + 6 行生成池）、
`components/kb-view.ts` / `kb-import.ts`、`KbEntryCard` / `KbModulePanels` / `KbBoardHeader` /
`KbToolbar` / `KbGenerateModal` 重写、新增 `KbTable` / `KbEntryDrawer` / `KbImportModal` /
`KbPreviewDrawer`、删除 `KbEntryModal`、`api/kb-compose.ts` 闸门改「只收 approved」、
`pages/KnowledgeBasePage.tsx` 重写、`i18n/{zh-CN,en-US}/kb.ts` 重写。

**文章管理半场（M6）**：`api/types-article.ts` / `api/article.ts` / `api/article-compose.ts`、
`demo/handlers/article.ts` + `article-schedule.ts`、`demo/seed/articles.ts`、
`components/article-slots.ts` / `article-studio-view.ts` + 11 个 `Article*.tsx`、
`pages/ArticleStudioPage.tsx`、`i18n/{zh-CN,en-US}/article.ts`。

**共享接缝**：`api/client.ts`（+10）、`api/types.ts`（re-export）、`demo/backend.ts` / `db.ts` /
`types.ts`、`components/SideNav.tsx` + 导航词典、`App.tsx` 路由。

### 8.4 与本文的偏差点

- **P-1（算术）**：§4 DR-87 与 §5 E-64 原先写「90 → 100 / 族 50 → 60」，漏算同轮 kb 族减的一条；
  真值 **99 / 59**，两处已改正，台账 §4g 用真值。
- **P-2（handler 拆分）**：10 条命令的 handler 拆成 `article.ts` + `article-schedule.ts` 两个文件
  （单文件 400 行的仓库纪律），本文 §5 E-64 的措辞已同步。
- **P-3（写路径寄生）**：归档寄生在 `article_direction_add`（带 id）、批量评审寄生在
  `article_list`（带 `review`）——DR-87 的 10 条命令面逼出来的临时形状，已登记为台账 E-64 ④，
  真后端**不应照抄**。
- **P-4（导入弹窗宽度）**：走查实拍发现产品行的正文是**一整行无空格的 JSON**，auto 表格布局会
  把弹窗撑出屏幕；`KbImportModal` 加 `scroll={{ y: 360 }}`（antd 随之把 `tableLayout` 收成 fixed）
  修掉，判据形态不变。
- **P-5（导入弹窗默认勾选）**：原实现用 `useEffect` 同步 `rows → selectedKeys`，被
  `react-hooks/set-state-in-effect` 点名；改成 React 官方的「渲染期比较 prop、连着两次 setState」
  写法，行为不变（首帧 `rows === []` 的坑仍然躲开）。
- **P-6（页面行数）**：`pages/ArticleStudioPage.tsx` 429 行，略超 400 的软线（与 `SitePage.tsx` 同量级）；
  三个 Tab 面板、三个评审组件与视图模型都已拆出，剩下的是 6 查询 + 7 mutation + 5 弹层的编排。
- **P-7（模板绑定输入）**：`bindings` 的两个多选**不用** `tokenSeparators`（产品名里的逗号不能被
  切成两个绑定），与知识条目标签输入框的裁定**刻意不同**，理由写在组件注释里。

