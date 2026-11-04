# Plan C 前置契约清单（真后端 / 桌面端落地前）

> 状态：**操作清单**（不是设计裁定）。用途：在写第一行业务 Rust 代码之前，把 demo 已冻结的契约、错误码、纯函数归属与已知架构债逐项确认，避免「照着 demo 重写一遍」时把 demo 的临时形状固化成后端契约。
> 关联：`2026-09-23-demo-vs-backend-known-divergences.md`（E-33 / E-67 … E-75）、AGENTS 规则 8 / 9 / 11。
> 原则：**先冻结、再实现；一个命令族纵向打通，不按页面横向铺开。**

## 1. 每个命令族开工前的六项冻结

对每一个要从 demo-only 转正的命令族（`search_*`、`collection_*`、`diagnosis_*`、`article_*`、`site_*`、`kb_*`、`prompt_*`、`keyword_*`、`faq_*`、`report_*` …）先填完这张表，再写 handler：

| 项 | 要确认什么 | 产物 / 判据 |
|---|---|---|
| DTO 形状 | 字段名、必填/可空、`Option` 与 `null` 的语义、单位（百分点 vs 比率 vs 条数） | `crates/geo-domain` 或 `src-tauri` 的 DTO + serde 测试 |
| 枚举集合 | 每个取值的前端词典键与后端 serde 名逐字一致 | Rust 常量数组 + `enumLabel` 词典 + parity 测试 |
| 错误码 | 新错误先登记 `contracts/error-codes.json`，再写 `errors.ts` 与 zh/en 词典 | 契约三件套同一次提交 |
| 命令面 | `IPC_COMMANDS`、`demo/backend.ts`、`generate_handler![]` 三者关系 | 见 §4 的集合断言 |
| 纯函数归属 | 哪些算法必须进 `geo-domain`（阈值、去重、归一、选轮、机会判定） | 前端不再保留第二份实现，或保留但由同一 fixture 对拍 |
| demo 数据 | 种子里哪些值只是「预置展示」，哪些会成为真值源 | E-台账对应条目 + 界面上常驻说明 |

> 🔴 不允许「先把 handler 写出来，契约以后再对齐」。demo 已经把前端调用面冻结；Rust 形状一旦与前端不一致，界面会在联调期出现「字段 undefined / 日期 Invalid Date / 数字小 100 倍」这类只能靠肉眼发现的错误。

## 2. 本轮 P3 未决项的处理方式

| 未决项 | 对真后端的影响 | 开工前的处理 |
|---|---|---|
| `SEARCH_INGEST_ERROR_KEYS` 未与后端 reason 目录自动对齐 | **直接相关**：Rust 导入服务新增一个 `reason`，前端若未登记就露出机器记号 | 建 `contracts/search-import-reasons.json`（`reason` + `params` 列表）。Rust 侧用测试断言枚举 serde 值集合与该 JSON 相等；TS 侧用测试断言 `SEARCH_INGEST_ERROR_KEYS` 键集合相等。前端已补未知 reason 的本地化兜底（机器记号只作附加信息） |
| `countText` 不夹负数 | 低：只影响显示 | Rust DTO / DB 层保证计数非负；导入与汇总路径各一条「负数被拒」测试。**不要在显示层夹成 0**——那会把后端 bug 藏起来 |
| `ArticleTemplateTable` 无独立渲染测试 | 低：组件由 demo 与桌面端共用 | 文章族转正时补一条渲染断言即可；现在不必为覆盖率单独扩测试 |
| `WebmasterDataPage` 的 `asOf` 仍保留系统日期兜底 | 中：桌面端 `search_board` 慢或失败时，若入口被重新放开，导入默认区间会落到系统今天 | 后端契约把 `search_board.as_of` 定为**必填非空**；前端在 `openIngest` / `openPaste` / `openConfig` 入口再加一道 `board === undefined` 守卫（按钮禁用之外的第二道），并把 `asOf` 改成 `string \| null` 由弹窗显式处理 |

## 3. 已知架构债的落地顺序（不要边写边改）

1. **E-73 `portfolio_overview`**：先定 DTO（每项目「最近结论轮次 + 四个指标 + 未读告警计数」），再实现；组合页改为一次取数。否则项目一多就是 N+1。
2. **E-75 组合三态**：`portfolio_overview` 必须返回「无轮次 / 有轮次待诊断 / 有结论」，不要沿用 `diagnosis_overview === null` 就压成 `round = null` 的临时映射。
3. **E-74 项目归档格式**：`ProjectExport` v1 保持 M1/M2 且 `deny_unknown_fields`；知识库 / 采集 / 站点 / 站长数据备份另立 `geo-project-archive-v2`，不要往 v1 塞字段。
4. **E-67 ③ / E-72 双解析器**：导入解析（CSV / xlsx）与映射表在 TS 与 Rust 各有一份时，先用**同一组 fixture** 钉「两边逐格相同」，再允许上线；未知表头 / 未知 sheet 必须报错，不许猜。
5. **文章排期时区**：DB 存 UTC，命令入参显式带 IANA timezone（或固定 `Asia/Shanghai` 并在 DTO 注释写死）；不要沿用前端本地时区构造的临时口径。
6. **E-36 截图**：DTO 的 `screenshot_path` 非空分支在 demo 不可达，Plan C 落地时补图片加载失败与本地路径解析测试。
7. **外部数据（规则 11）**：Rust 侧只做官方 OAuth / 客户导出 / 粘贴 / 填报；任何「模拟登录」实现一律拒绝。

## 4. 建议新增的三道契约门禁

1. **命令面集合**：`IPC_COMMANDS` ↔ `generate_handler![]` 的差集必须等于台账里的「待落地清单」。今天直接做全等会红，所以先做**allowlist 版**：新命令默认必须两边都有，历史 demo-only 命令逐条列出并附 E 编号；每转正一条就从 allowlist 删一条。
2. **错误码三件套**：`contracts/error-codes.json` ↔ `errors.ts` ↔ zh/en 词典，三者键集合相等；Rust 只回稳定码 + 语言中立 `params`。
3. **fixture 对拍**：`fixtures/` 下每个导入样例，TS 与 Rust 各自解析一次，输出逐格比较（CSV / xlsx / 粘贴文本三类各至少一份）。

## 5. 明确不要做的事

- 不为了「桌面端不报错」而注册假 Rust handler，或在前端按 runtime 屏蔽 demo-only 命令（规则 8 的反面）。
- 不把中文写进 Rust 的错误信息或 `check_detail`；文案只在前端词典。
- 不把 demo 的「预置值 / 静态清单」当成算法结果搬进 Rust；先决定算法归属 `geo-domain`，再用 fixture 对拍。
- 不在一次提交里同时改命令面、DTO、迁移与界面；一个命令族纵向打通后再开下一个。

## 6. 第一个试点族冻结表：关键词库 CRUD（2026-11-03）

**范围**：`keyword_list` / `keyword_add` / `keyword_update` / `keyword_delete` 四条。
`keyword_generate` **不在本轮**：它依赖模型 + 第三方关键词接口（spec §7），继续留在 `ipc-command-surface.json` 的 `pending`，桌面端仍报 `ipc/unknown_command`，不伪造。

| 项 | 冻结值 |
|---|---|
| DTO | `KeywordItem { id, project_id, text, kind, intent, monthly_volume: Option<i64>, difficulty: Option<u8>, priority: u8, status: ContentStatus, note: Option<String>, source: LibrarySource, position: i32, created_at, updated_at }`；`KeywordDraft { text, kind, intent, monthly_volume, difficulty, priority, note }`（`source` 固定 `manual`，`status` 固定 `approved`） |
| 枚举 | `KeywordKind`: `core / long_tail / competitor / brand / scenario`；`LibrarySource`: `manual / generated / imported`（与前端 `api/types-library.ts` 逐字一致） |
| 校验 | `text` 必填、≤300 字；`priority` 1..=5；`difficulty` ≤100；`monthly_volume` 非负；`kind` / `intent` 必须是枚举值。失败统一 `validation/failed { field, reason }`，不新增错误码 |
| 命令面 | 注册 4 条，`generate_handler![]` 40 → 44；`pending` 65 → 61；前端 `IPC_COMMANDS` 不变（105） |
| 纯函数归属 | 校验放 `geo-domain::keyword`（`KeywordItem::validate` / `KeywordDraft::validate`）；仓储与服务不做业务判断 |
| demo 数据 | `demo/seed/keywords.ts` 继续作为 demo 数据；真后端从空表开始，不迁移种子 |

**验收判据**：domain 单测覆盖每条校验；repo 单测覆盖排序（`position ASC, id ASC`）、批量新增、整行更新、幂等删除；service 单测覆盖项目不存在、条目 id 认不出、空 drafts；契约测试确认 Rust 注册 44 条且 pending 61 条。

**状态（2026-11-03）**：✅ 已落地——`geo-domain::keyword`、迁移 `20261103000002_keywords.sql`、`KeywordRepo`、`KeywordService`、`ipc/keyword.rs`；domain 6 + repo 7 + service 7 条测试通过。`keyword_generate` 仍 pending。

## 7. 第二个试点族：FAQ CRUD（2026-11-03）

**范围**：`faq_list` / `faq_add` / `faq_update` / `faq_delete`。`faq_generate` 依赖模型成文 + 合规扫描，继续留在 `pending`。

| 项 | 冻结值 |
|---|---|
| DTO | `FaqItem { id, project_id, question, answer_markdown, category: Option<String>, intent, status: ContentStatus, source: LibrarySource, position, created_at, updated_at }`；`FaqDraft { question, answer_markdown, category?, intent }` |
| 校验 | 问题与答案去首尾空白后都必须非空；长度上限尚未由产品裁定，本轮不发明阈值 |
| 命令面 | 注册 4 条，`generate_handler![]` 44 → 48；`pending` 61 → 57；前端 `IPC_COMMANDS` 不变 |
| 纯函数归属 | 校验放 `geo-domain::faq`；人工录入固定 `source = manual` / `status = approved` |
| 更新 | 保留 `source` / `position` / `created_at`；跨项目 id 报 `validation/failed { field: faq_id, reason: invalid_id }` |

**状态（2026-11-03）**：✅ 已落地——domain 5 + repo 7 + service 7 条测试通过；`faq_generate` 仍 pending。

## 8. 生成命令：keyword_generate / faq_generate（2026-11-04）

| 项 | 冻结值 |
|---|---|
| 入参 | `keyword_generate { project_id, options: { kinds[], target_count } }`；`faq_generate { project_id, options: { intents[], target_count } }` |
| 条数 | `target_count` 夹在 **1..=20**（与前端 `LIBRARY_GENERATE_MIN..MAX` 同档） |
| 模型契约 | 只接受 JSON：关键词 `{ items: [{ text, kind, intent }] }`；FAQ `{ items: [{ question, answer_markdown, category?, intent }] }`。`kind` / `intent` 必须属于请求集合，空文本视为坏响应并触发 `chat_json` 追问 |
| 合规 | 关键词文本、FAQ 问题与答案都跑 `compliance::is_clean`；命中任一红线词**整批拒绝**并返回 `compliance/violation { terms }`，不静默改写 |
| 产物 | `source = generated`、`status = pending_review`；关键词 `monthly_volume` / `difficulty = null`（第三方关键词接口未接入） |
| 去重 | 只跳过与库内已有条目**文本完全相同**的（关键词比 `text`、FAQ 比 `question`），不做相似度 |
| 失败 | 未配 Key → `llm/missing_secret`；传输 / 结构化输出失败 → `llm/transport` / `llm/bad_response`；**不降级成假数据** |

**状态（2026-11-04）**：✅ 已落地——`KeywordService::generate` / `FaqService::generate`，各 4 条生成测试；Rust 命令面 48 → 50，pending 57 → 55。

## 9. 第三个试点族：知识库 CRUD + board + verify（2026-11-04）

**范围**：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` / `kb_entry_verify`。`kb_generate` 需要模型成文 + 合规扫描，继续留在 `pending`。

| 项 | 冻结值 |
|---|---|
| 表 | `kb_entries`（条目）+ `kb_entry_revisions`（字段级留痕）；删除条目**不删**留痕 |
| DTO | `KbEntry` / `KbEntryDraft` / `KbStats` / `KbEntryRevision`；board 一次返回条目 + 统计 + 修订（新的在前） |
| 校验 | 标题必填（`kb_title`）；`scenario` 只在 `sales_script` / `support_script` 保留，其余模块强制 `null` |
| 来源 / 状态 | 人工恒 `manual + approved`；`source: imported` 是唯一覆盖值，其 `status` 只认 `approved` / `pending_review`；`generated` 不算数 |
| 更新 | 保留 `source` / `position` / `created_at` / `verified_at`；逐字段 diff 每个变化记一条；`body_markdown` 留痕副本截断 120 字符 |
| 删除 | 幂等、只删本项目、重排 `position` 为 `0..n-1` |
| 核实 | `status → approved` + `verified_at → now` + 一条 `verified_at` 留痕；未知 id 忽略 |
| 命令面 | 注册 5 条，50 → 55；`pending` 55 → 50 |

**状态（2026-11-04）**：✅ 已落地——domain 6 + repo 7 + service 9 条测试通过；`kb_generate` 仍 pending。
