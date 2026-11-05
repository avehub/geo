# demo 与真后端的已知差异（交底清单）

> **状态**：正式交底产出物（计划 `docs/superpowers/plans/2026-09-18-plan-a-i18n-foundation-and-demo-backend.md` §A-4 第 39 条）
> **基线 commit**：`08790a4`（分支 `feat/settings-redesign-demo-i18n`）· **行号核准日期**：2026-09-23
> **门禁**：cargo 22 targets / 515 passed / 0 failed；vitest 42 files / 635 tests；`CHECK_EXIT=0`
>
> **2026-09-28 增补（§4b · E-33 … E-45）**：M3–M7 demo 闭环那一轮新增 13 条，设计规格见
> `2026-09-28-demo-m3-m7-closed-loop-design.md`。该轮的 `mise run check` **全绿**（`CHECK_EXIT=0`）：
> cargo 22 targets / **515 passed** / 0 failed（与上表同一基线，因为**Rust 侧本轮一行未改**）、
> vitest **53 files / 798 tests**（上表是 42/635）、`tsc -p tsconfig.app.json --noEmit` 干净、
> `eslint --max-warnings 0` 干净、前端产物构建通过。
> 🔴 **§4b 刻意只给路径与符号名、不给行号**：那一轮的改动**尚未提交**（还在分支
> `feat/settings-redesign-demo-i18n` 的工作区里），钉行号等于钉在一个不存在的 commit 上——正是本文开头
> 警告的「11 处行号已随重构漂移」那个缺陷类。合并后若要给 §4b 补行号，按 G-5 的口径逐条回真值源核。
>
> **2026-09-30 增补（§4c · E-46 … E-51）**：Plan B（导航 / 设置 / 新建项目）那一轮新增 6 条，设计规格见
> `2026-09-29-plan-b-navigation-settings-newproject-design.md`（落地轮补写的裁定修订在该文 §13）。
> 该轮的 `mise run check` **全绿**（`CHECK_EXIT=0`）：cargo 22 targets / **515 passed** / 0 failed
> （与上两表**同一基线**，因为**Rust 侧本轮同样一行未改**）、vitest **66 files / 914 tests**（上表是 53/798）、
> `tsc -b` 干净、`eslint --max-warnings 0` 干净、前端产物构建通过。
> 🔴 **§4c 同样只给路径与符号名、不给行号**（理由与 §4b 完全相同：改动尚未提交，都在分支
> `feat/settings-redesign-demo-i18n` 的工作区里）；例外是 Rust 侧那些**本轮一行未动**的真值源
> （`geo-llm/src/provider.rs`、`geo-store/src/settings.rs`、`geo-domain/src/entity_card.rs` 等），
> 它们是已提交的稳定事实，按 G-5 给了行号。
>
> **2026-09-30 增补（§4d · E-52 … E-54）**：M1.5 素材层（关键词库 / FAQ 常见问题库）那一轮新增 3 条，
> 设计规格见 `2026-09-30-keyword-faq-library-design.md`（DR-37 … DR-44；落地回填在该文 §12）。
> 该轮的 `mise run check` **全绿**（`CHECK_EXIT=0`）：cargo 22 targets / **515 passed** / 0 failed
> （与上三表**同一基线**，因为**Rust 侧本轮同样一行未改**）、vitest **71 files / 995 tests**（上表是 66/914）、
> `tsc -b` 干净、`eslint --max-warnings 0` 干净、前端产物构建通过。
> 🔴 **§4d 同样只给路径与符号名、不给行号**（理由与 §4b / §4c 完全相同：改动尚未提交，都在分支
> `feat/settings-redesign-demo-i18n` 的工作区里）。
> ⚠ 本轮新增的 **10 条命令只有 demo 侧实现**（`keyword_*` 5 + `faq_*` 5），「demo 独有命令」这一族由
> 22 → **32**；但两个导出出口与「引用到 Prompt 题库」**一条新命令都没加**（分别复用既有的
> `export_write_file` 与 `prompt_item_add`，所以引用是**真的写路径**）——详见 §4d 开头那段与 E-52 … E-54。
>
> **2026-09-30 增补（§4e · E-55 … E-57）**：M6.5 站点接入与补丁工作台那一轮新增 3 条，
> 设计规格见 `2026-09-30-site-connect-patch-bench-design.md`（DR-45 … DR-58；全球市场调研在该文 §2，
> 裁定在 §3）。该轮自己的判据面**全绿**：cargo 22 targets / **515 passed** / 0 failed
> （与上四表**同一基线**，因为**Rust 侧本轮一行未改**）、`cargo fmt --check` 与
> `clippy -D warnings` 干净、`tsc -b` 干净、前端产物构建通过、本轮新增/改动的文件
> `eslint --max-warnings 0` 干净。
> ⚠ 但**整条 `mise run check` 此刻不是全绿**：红的两处（`api/kb-compose.ts` 的一条
> `consistent-type-imports`、`pages/KnowledgeBasePage.test.tsx` 的两例）都来自**并行的 M1.2 那一轮**，
> 与站点接入无关，由那一轮自己收口。
> ✅ **已收口（2026-10-01，M1.2 那一轮，本节原文保留不改）**：上面那两处红都由 M1.2 自己修掉了——
> `api/kb-compose.ts` 的 `KB_MODULE_VALUES` 改成 `import type { KbModule }`（`moduleLabel` 的形参类型
> 由 `(typeof KB_MODULE_VALUES)[number]` 换成同义的 `KbModule`，纯类型面改动、行为零变化）；
> `pages/KnowledgeBasePage.test.tsx` 的两例见该文头注那条 jsdom `getComputedStyle` 性能裁定。
> 整条 `mise run check` 现已**全绿**，绝对数字见 §4f 那条增补。
> 🔴 **本轮刻意不给 vitest 的文件数 / 用例数**：M6.5 站点接入与 M1.2 知识库两轮在**同一个工作区并行**
> 落地、都尚未提交，那个合计数每几小时就在动，钉在这里等于钉一个马上就假的数字（正是本文开头警告的
> 「行号已随重构漂移」那个缺陷类的同族）。本轮自己的判据面按两处核：
> 命令清单见 §4e 开头那段（11 条 `site_*`），守卫的钉死数字见设计规格 §11.2（落地回填后的真值）；
> 新增的四份测试是 `demo/handlers/site.test.ts` + `demo/handlers/site-patch.test.ts` +
> `api/site-compose.test.ts` + `pages/SitePage.test.tsx`。
> 🔴 **§4e 同样只给路径与符号名、不给行号**（理由与 §4b / §4c / §4d 完全相同）；例外是 Rust 侧那些
> **本轮一行未动**的凭据面真值源（`crates/geo-store/src/secret.rs`、
> `apps/desktop/src-tauri/src/ipc/secret.rs`、`…/services/settings_service.rs`），按 G-5 给了行号。
> ⚠ 本轮新增的 **11 条命令只有 demo 侧实现**（`site_*`），「demo 独有命令」这一族由 32 → **43**；
> 但**六个导出出口一条新命令都没加**（DR-53：文本在前端组装，落盘复用既有的 `export_write_file`）
> ——详见 §4e 开头那段与 E-55 … E-57。
>
> **2026-10-01 增补（§4f · E-58 … E-62）**：M1.2 品牌实体卡瘦身（11 → 7 个字段）与知识库那一轮新增 5 条，
> 设计规格见 `2026-10-01-entity-card-slim-and-knowledge-base-design.md`（DR-59 … DR-72）。
> **Rust 侧本轮同样一行未改**（与上五轮同一基线）；判据面是本轮新增的四份测试
> （`demo/handlers/kb.test.ts` + `components/kb-view.test.ts` + `api/kb-compose.test.ts` +
> `pages/KnowledgeBasePage.test.tsx`）与 §12 的守卫增量。
> ✅ **两轮并行都已落地，整条 `mise run check` 全绿（`CHECK_EXIT=0`）**：cargo 22 targets /
> **515 passed** / 0 failed（与上五轮**同一基线**，Rust 侧一行未改）、vitest **79 files /
> 1207 tests**（§4d 那表是 71/995）、`tsc -b` 干净、`eslint --max-warnings 0` 干净、
> 前端产物构建通过。
> 🔴 **那个 79/1207 是工作区合计数，不是"只属于本轮"的数**：它同时含并行的 M6.5 站点接入那一轮
> （`site_*` 那四份测试），两轮都尚未提交 ⇒ 分不开。§4e 当时**刻意留空**的那个数字，
> 到这里才第一次有意义可填——填的也是合计数，理由与它当初不填是同一条（别钉一个马上就假的数）。
> 🔴 **§4f 同样只给路径与符号名、不给行号**（理由与 §4b … §4e 完全相同）；例外是 Rust 侧那些
> **本轮一行未动**的实体卡真值源（`crates/geo-domain/src/entity_card.rs` 的 `ALL_FIELDS` /
> `REQUIRED_FIELDS` / `ProductSpec` / `EntityFields::completeness()`），按 G-5 给了行号。
> ⚠ 本轮新增的 **7 条命令只有 demo 侧实现**（`kb_*`），「demo 独有命令」这一族由 43 → **50**；
> 但**两个导出出口一条新命令都没加**（DR-72：Markdown 知识册与 JSON 知识包在前端组装，
> 落盘复用既有的 `export_write_file`，预览复用既有的 `LibraryExportModal`）——详见 §4f 开头那段。
> 🔴 **本轮最要紧的一条不是命令面**：实体卡字段面 11 → **7**（E-58）而 Rust 侧一行未改 ⇒
> 同一张卡在两端字段数与完整率都不同（0.86 vs 0.6），且"桌面端保存一次就清空 cases /
> differentiators / official_tone"是**静默数据丢失**（E-58 ②）——Plan C 必须**先迁移再收窄**。
>
> **2026-10-10 增补（§4g · E-63 … E-66）**：知识库重构（M1.2b）与文章管理 Article Studio（M6）
> 那一轮新增 4 条，设计规格见 `2026-10-10-kb-redesign-and-article-studio-design.md`（DR-73 … DR-89），
> 市场调研见 `2026-10-10-kb-and-article-studio-ux-survey.md`。
> **Rust 侧本轮同样一行未改**（与上六轮同一基线）：cargo 22 targets / **515 passed** / 0 failed、
> `cargo fmt --check` 与 `clippy -D warnings` 干净；前端 vitest **83 files / 1234 tests**
> （§4f 那表是 79/1207）、`tsc -b` 干净、`eslint --max-warnings 0` 干净、前端产物构建通过，
> 整条 `mise run check` **全绿**（`CHECK_EXIT=0`）。
> 🔴 **本轮命令面第一次"有增有减"**：kb 族减一条（`kb_entry_detach` 随同步块退役删除）+
> article 加十条 ⇒ `IPC_COMMANDS` 90 → **99**、demo 独有族 50 → **59**（设计规格原先写的
> 100 / 60 漏算了减的那一条，已按 §4g 改正）。
> 🔴 **E-61 整条作废**（同步块读时投影 / "基于实体卡变动自动更新"）：用户 2026-10-10 的指示
> （"知识库不需要与实体卡相同的内容模块卡片"）正是冲着投影来的；替代品是**一次性显式导入**
> （DR-81，不跟随源头）。E-61 原文按 §7 的纪律保留不改，由 §4g 抬头那条声明作废。
> 🔴 **§4g 同样只给路径与符号名、不给行号**（理由与 §4b … §4f 完全相同：改动尚未提交）。

> ⚠ 本文所有行号都由控制器在 `08790a4` 上**逐条回真值源核过**（G-5）。历史台账里有 11 处行号已随重构漂移，
> 本文用的是**当前**行号，不是台账原文的行号。改动相关文件后请同步本文。

> 生成日期：2026-09-23 · 分支：`feat/settings-redesign-demo-i18n` · 计划：`docs/superpowers/plans/2026-09-18-plan-a-i18n-foundation-and-demo-backend.md`

## §1 这份清单是什么、不是什么

**是什么**：`mise run web` 跑起来的 demo 假后端（`apps/desktop/ui/src/demo/`）与真后端
（`crates/**` + `apps/desktop/src-tauri/**`）之间**已被识别、已被裁定、并且有意保留**的行为差异。
每一条都写清「后端怎么做 / demo 怎么做 / 为什么这样做 / 代价是什么」。

**不是什么**：不是缺陷列表。清单里的每一条都是**当时的正确选择**——要么是 AGENTS 规则 9
（领域算法是 Rust 纯函数，demo 里只呈现预置静态值）的直接后果，要么是「镜像它就得在前端另造一份
常量表 / 词库 / 别名表，那必然漂移」的取舍。**发现新的差异时，请先判断它属于哪一类**：

- 属于「demo 不许实现算法」⇒ 登记为新条目，不要实现；
- 属于「镜像成本 > 漂移风险」⇒ 登记为新条目，并写明镜像需要复制哪一份真值；
- **都不属于** ⇒ 那是缺陷，按 AGENTS 规则 8 走「demo 定稿 → 桌面端落地」，并**以 Rust 后端为真值源**。

**编号纪律**：`E-1` 起连续编号，不重号、不跳号。已被后续轮次对齐的条目**不删除**，
只在其行内标注「已对齐 · 留此仅作台账」（先例：E-17），以免后人重新发现一遍。

## §2 差异表 A：Prompt 题库 / CSV 族（E-1 … E-12）

| 编号 | 差异（demo 侧行为） | 理由 | 后端真值源 |
|---|---|---|---|
| E-1 | CSV 行判据只实现 `required`/`invalid_format`/`row_invalid` 三种，**未移植** `too_long`/`out_of_range`/`not_allowed` | 需要 `MAX_PROMPT_CHARS`/`MAX_WEIGHT`/`MAX_REPEAT_COUNT` 与整份广告法词库，`api/constants.ts` 里**没有前端镜像**；凭空造一份就是新漂移面 | `csv_io.rs:198-243` |
| E-2 | `group_name` 留空存 `null`，**不**回填 `intent.label_zh()` | 那是一张 7 条的**中文**表，写进 handler 直接踩门禁 7；前端已有本地化的 `__ungrouped__` 路径（`pages/PromptSetPage.tsx:35-40`） | `csv_io.rs:269-273` |
| E-3 | `prompt_set_generate` 是**克隆**（取项目里条目最多的那份），不是真生成 | 真生成要跑「模板展开 → LLM 扩写 → 口语化改写 → 竞品同框 → 去重」整条管线，AGENTS 规则 9 明令 demo 不许实现。取"条目最多"而非写死基线 id：用户删掉基线后仍可克隆 | — |
| E-4 | 生成出的 `version` 恒为 **1**（真后端按项目内最大 version+1 递增） | "版本"的语义是 P0-B 的**采集轮次**；demo 没有轮次概念，编一个递增数字反而像在演一条不存在的环比链路 | — |
| E-5 | `content_hash` = `demo-{条目数}-{文本总长}`，**不做哈希运算** | AGENTS 规则 9。三个性质同时成立：`demo-` 前缀（一眼看出是占位）、内容一变它就变、纯函数零依赖（不引 crypto） | — |
| E-6 | `prompt_set_dedupe` 回**静态**报告（kept=全部、removed=[]、duplicate_pairs=0） | 真口径是字符 3-gram Jaccard ≥0.85，那是 Rust 纯函数，P0-C 还要复用 | — |
| E-7 | `sample_size_grade` **不重算**，继承被克隆那份的静态值 | 同上 | — |
| E-8 | CSV 读取器对「收口引号后有数据」与「引号未闭合」**严格**报错，报完**跳到下一个换行继续扫**（不截断其余行）；诊断串是 demo 自拟的 ASCII 替身，**不是** csv 库 `err.to_string()` 的原文 | demo 要能把 `row_invalid` 这条错误路径**演出来**，且要演出 `csv_io.rs:172` 那个 `continue`（一行坏、其余行照样进）。🔴 **本行的「撤回」注记自 2026-09-23 起被反转，详见 E-28**：当初撤回的理由是「在 `csv-1.4.0` 与 `csv-core-0.1.13` 两棵树里查 `found data after closing quote` / `Unescaped*` **全 0 命中** ⇒ 方向未被证实」，那是**源码 grep**，只证明「csv 没有那句错误文案」，**不证明「csv 更宽松」这个方向为假**；现已由**行为实测**（复审席独立复跑探针）证实该方向**为真**——真 csv 对这两类输入压根不报错，所以 demo 更严。**结论以 E-28 为准。** | `csv_io.rs:161-172` |
| E-9 | `prompt_item_update` 的 `set_id/not_allowed` 分支**未实现** | 只有 `update_items_bulk` 能到达它，而它**没有** IPC 命令 ⇒ 从命令面不可达 | `prompt_service.rs` |
| E-10 | `prompt_item_update` 的 `id`/`set_id`/`position` 一律取**库里那份**，忽略入参同名字段 | "把条目挪到另一份题库"不是这条命令的语义（同 E-9） | — |
| E-11 | `prompt_set_list` **不校项目存在性**（没有题库就回空数组） | 与 `competitor_list` 同口径（`handlers/relations.ts`）；"这个项目一份题库都没有"是正常状态而非错误 | — |
| E-12 | `parseU8` 比 Rust 略严：拒 `'+3'`，而 `u8::from_str("+3")` 接受 | 归 E-8 同族（demo 的解析器是自拟替身，不逐字复刻 `from_str_radix` 的符号容忍）。代价：一份把权重写成 `+3` 的 CSV 在桌面端能导、在 demo 里报 `invalid_format` | `csv_io.rs:217-224` |

## §3 差异表 B：设置 / 密钥 / 导出族（E-13 … E-27）

| 编号 | 后端行为（真值源行号） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-13 | `validate_settings` 有 7 个数值区间（`service:30-36`）+ 模型名长度上限（`MAX_MODEL_NAME_CHARS`，`service:41`）+ `too_long` 判定（`service:333-343`） | 一律**不校验**，越界值照样落库 | A-4 只授权镜像两条。代价：demo 里把 `max_parallel` 填 999 也能存；镜像就要在前端另造一份常量表（必漂，违 AGENTS 规则 8 的定稿目的） |
| E-14 | `model.base_url` 的 `invalid_format` / `invalid_url`（`service:357-364`，整个 if-let 块 `:348-366`） | 不校验 | 属 spec G5「那条链路要重新设计」；代价：demo 里填 `ftp://x` 也能存 |
| E-15 | **`task-14-facts.md` §2 的表漏了两条**：`proxy.url` 的 `required`（`service:371`）与 `invalid_format`（`service:377-379`），整块在 `:367-382` | 不校验；`proxy.url` 只做 trim（`settings.ts:216-217`，镜像 `service:129-131`） | 我在核对真值源时发现事实表缺这两条，**在此更正**（G-5：涉序号必须从函数体抄原文）。代价同 E-14 |
| E-16 | `provider_test` 的 `ok=false` 支：网络不通/限流/5xx ⇒ `LlmTestResult{ok:false, message:Some(redact(...))}`（`service:227-243`） | **不演**，`message` 恒 `null`（`settings.ts:290`） | 演它需要一个「失败注入开关」，而开关的形状属产品决策；且 `message` 装的是**中文原因**，写进生产文件就踩门禁 7。归 Plan B |
| E-17 | 🔴 **【R1 已按裁定对齐 ⇒ 本行不再是偏离，留此仅作台账】** `config_from_settings` 对 `custom` 要求 `base_url` 与 `model` 非空，否则 `llm/config` + `reason=missing_base_url`/`missing_model`（`state.rs:104-118`；整段失败顺序在 `state.rs:72-119`，发生在**取 Key 之前**） | **已镜像**：`settings.ts:256-270`（① `unknown_provider` → ② `missing_base_url`/`missing_model` → ③ `missing_secret`），两个 `value` 都是厂商 id `"custom"`；预设厂商的 `model` 回落 `default_model` 那条**一字未改** | 原来登记的「不演」理由是 AGENTS 规则 9，复审判定**站不住**：那两条只是**空白检查**，与 A-4 已授权的 `language` 空白检查同形；且 `custom` 就在种子那 7 条预设里（`seed/settings.ts:96`）、UI 一次点击可达 ⇒ 控制器裁定「授权对齐」，R1 已改（处置与证据见 §11.3）。⚠ §5 末段那句「demo 会成功返回」自 R1 起**不成立**，以本节与 §11.3 为准 |
| E-18 | `latency_ms` 是实测值（`service:202-204`，`Instant::now()` / `elapsed()`） | 恒为常量 600（`settings.ts:77` 的 `LLM_TEST_LATENCY_MS`，用点 `:280` 与 `:285`） | 计划正文逐字要求 600ms。代价：结果行的「耗时」在 demo 里永远是 600ms，不代表真实往返 |
| E-19 | `export_write_file` 返回 `Some(path.display().to_string())`，即**最终路径**（`export.rs:67`，语义注释 `:28`） | 返回**文件名**（`export.ts:103-104`） | A-1 逐字授权。代价：三个调用点把返回值当路径展示（`ProjectListPage.tsx:73,90`、`CsvToolbar.tsx:83`；词典 `prompt.csv.exported` = 「CSV 已导出：{{path}}」）⇒ demo 下显示成「CSV 已导出：xxx-prompts.csv」。计划**接受**（`i18n/**` 与 `pages/**` 本轮禁改） |
| E-20 | 用户在「另存为」里点取消 ⇒ 返回 `null`（`export.rs:59-61`） | **永不返回 null**（浏览器下载没有取消按钮） | A-1 授权。代价：`string \ | null` 这个联合类型的 `null` 分支在 demo 里不可达；该语义仍由存量用例 `pages/ProjectListPage.test.tsx:206-209` 的 `stubAlways('export_write_file', () => null)` 在 invoke 层钉住（本轮禁改，没动它） |
| E-21 | `set_secret` 把 Key 写进系统钥匙串（`service:159-162`） | **连内存都不存**：只把 `configured` 翻成 `true`，值当场丢弃（`secret.ts:64-67`） | AGENTS 规则 3 的更强落法（`secret.ts:5-11`）。代价：demo 里换 Key 无法验证「新 Key 生效」；「演示模式不会写入系统钥匙串」那句 UI 文案属 `i18n/**` / `pages/**` ⇒ 归 Task 15（`secret.ts:13-14`） |
| E-22 | `configured` = 钥匙串里存在**且**值非空白（`service:170-174`） | `configured` 是库里的一个布尔（`secret.ts:75`） | demo 没有值可比。等价性由 `secret_set` 那一侧的 trim + 拒空保证（`secret.ts:49-52`）⇒「空白串算未配」这个语义仍然成立，测试 `secret.test.ts:90` 钉住 |
| E-23 | `LlmProvider::parse` 是**宽松解析**：trim / 转小写 / 去掉 `_`-`-`与空白，再查 12 条 `PROVIDER_ALIASES`（`provider.rs:121-141`）⇒ `deepseek`、`Deep Seek`、`kimi` 都认 | **逐字相等**判定（`settings.ts:97`，成员清单就是预设表那 7 个稳定 id） | 镜像那套归一化要在前端另造一份别名表（必漂）。代价：手填别名会被拒；但 UI 只发稳定 id（`ProviderSelect` 的选项来自 `llm_providers`）⇒ 这条路在界面上不可达。「有据偏离」写在 `settings.ts:91-92` |
| E-24 | 命令入参由 serde 反序列化成 `AppSettings`，半包入参会被**拒**（类型层） | 入参经 `settingsFromUnknown` **收窄**成完整 `AppSettings`（`settings.ts:131-168`；`asNumber` 非有限值 → 0），然后照常过体检 | demo 没有 serde。代价：空入参不会像真后端那样报「缺字段」，而是撞 provider 体检（`settings.test.ts:200` 钉住「不会把库改成半包」）⇒ 不会静默写进半包数据 |
| E-25 | 真后端写**裸字节**，由扩展名决定打开方式（`export.rs:62-67`） | Blob 带 `text/plain;charset=utf-8`（`export.ts:51-55`） | 浏览器下载需要 MIME；BOM + charset 两道都对上，Excel/记事本都不乱码。代价：下载下来的文件在操作系统层的类型识别与桌面端不完全一致 |
| E-26 | 「代理与超时影响的是已构造好的 HTTP 客户端，变更在应用重启后生效」（`service:121-123`，落库后还会 `tracing::info!` 一句） | **不演**（demo 无「重启」概念，也没有已构造的客户端） | A-3 逐字授权「不用演」。代价：demo 里改代理立刻「生效」（其实什么都不发生）；这条语义只能靠桌面端走查 |
| E-27 | —（这一条是**简报前提的更正**，不是后端偏离） | 简报 §A-1 说「jsdom 没实现 `createObjectURL`（打印 Not implemented）」；实测 vitest 的 jsdom 环境里全局 `URL` 是 **Node 的**，`createObjectURL` 存在但与 jsdom 的 `Blob` 不同 realm（`ERR_INVALID_ARG_TYPE`），且 jsdom 27 的 `Blob.prototype` 只有 `slice/size/type`（没有 `.text()`） | 所以 `export.test.ts` 用 `vi.stubGlobal('Blob', RecordingBlob)` 记录内容，用显式 `undefined` 造「运行环境不支持」那一支（`export.test.ts:245-249`）。守卫本身（`export.ts:77-80`）不变，仍然是「宁可抛开发者诊断，也不发一个假的『已导出』」 | ⚠ **口径更正（Task 14 R1 §11.2，全分支复审 MIN-2 要求补入）**：上文把「Node 的 `URL` 与 jsdom 的 `Blob` 撞 realm」说成了**环境的普遍性质**，这已被推翻——realm 冲突**只发生在 `export.test.ts` 内**，因为那份文件把全局 `Blob` 换成了自造的 `RecordingBlob`；**不替换 `Blob` 时整条链是通的**。由此得出一个更重要的结论：`export.ts:77-80` 那道 `typeof URL.createObjectURL !== 'function'` 守卫在测试里**自然走不到**，所以那条永久探针是**自己造前提**的（`vi.stubGlobal` + 显式 `undefined`）。后人不要照本行上半句去「无谓地桩 `Blob`」，也不要以为那道守卫能被自然触发 |
## §4 Task 15c 收口后新增的差异条目（E-28 … E-32）

> **编号规则**：`E-*` **只**登记「demo ↔ 真后端的行为差异」。后端自身的待办进 §5，
> 工程债与判据纪律进 §6，流程常驻条款进 §7。复审席在 `task-15-combined-review.md` §7 给过一份候选编号
> （E-28…E-35），其中 E-30/E-32/E-33/E-35 按本规则分别落到本文的 §5-1、§6-1、§6-9、§7-1。

| 编号 | 后端行为（真值源行号） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-28 🔴 | 真 `csv 1.4.0` 在 `has_headers(true).flexible(true)`（＝ `crates/geo-domain/src/csv_io.rs:135-138` 的配置）下，对「收口引号后还有数据」（`"closed"xx` → 单元格值 `closedxx`）与「引号未闭合直到 EOF」（把剩余全文吞成一个单元格）**都不报错** | 这两支**都发** `row_invalid` ⇒ **demo 比后端严** | demo 要把错误契约**演出来**：`contracts/error-codes.json` 登记了 `row_invalid`，`csv_io.rs:163-172` 也有那支防御分支。代价：**同一份 CSV 在浏览器里报错、在桌面端静默导入且单元格被拼坏** ⇒ 违反「demo 与真后端不可区分」。<br>🔴 **这一条需要产品负责人决策，不是知会**：① 放宽 demo 成「粘连」（代价：`row_invalid` 无处可演，而它在契约里登记着）；② 后端加显式校验（Rust 改动，在本计划范围之外）。<br>⚠ **E-8 里那句「撤回」自本条起被反转**：当初撤回的理由是「在 `csv-1.4.0` 与 `csv-core-0.1.13` 两棵树里 grep `found data after closing quote` / `Unescaped*` 全 0 命中 ⇒ 方向未被证实」——那是**源码 grep**，只证明「没有那句错误文案」，**不证明方向为假**；现已由**行为实测**（复审席独立复跑探针）证实「csv 更宽」这个方向**为真** |
| E-29 | csv 1.4.0 里**所有带位置的错误**装的都是**记录起始**位置：`src/error.rs:105-112` 的 `ErrorKind::position()` **只对** `Utf8` / `UnequalLengths` / `Deserialize` 返回内层 `pos`（其余 `None`）；`src/reader.rs:1890-1891` 的 `UnequalLengths` 用 `record.position().cloned()`；`src/reader.rs:1332-1333` 的表头 `Utf8` 用 `headers.byte_record.position()`；`src/string_record.rs:636` 的 `let pos = rdr.position().clone();` 在 `read_byte_record` **之前**取 ⇒ `csv_io.rs:168`（错误支 `err.position().line()`）与 `csv_io.rs:175-178`（域支 `record.position().line()`）**产出同一个行号**。另外 `csv_io.rs:168` 结尾是 `.unwrap_or(0)` ⇒ **错误不带位置时 `row` = 0** | 两支**同值**（都用记录起始行），已对齐。但 `row: 0` 那一支在 demo 里**不可构造**——demo 自己的词法器永远知道行号，`row >= 1` | 这条是 #31 的正确结论，登记在此**防止「两支不同」这个错误说法复活**（它一度被写进代码 docblock 与 15c-2 报告，R1 已改正）。<br>👉 **任何文档都不许再写「`err.position().line()` 是出错行」**。<br>代价：后端理论上能产出 `row: 0`（错误不带位置），demo 永远产不出；因为 E-28 那一支在真后端**几乎不可达**（`flexible(true)` 关掉 `UnequalLengths`、入参 `&str` 已是合法 UTF-8、走 `records()` 不涉及 `Deserialize`），实际观测不到 |
| E-30 | `parse_path` 的下标用 `chunk.parse::<usize>()`（`crates/geo-domain/src/entity_card.rs:419-421`）⇒ **接受前导 `+`**（`[+1]` 是合法下标），且**超出 `usize` 会解析失败**（`[99999999999999999999]` 报 `invalid_format`） | 两条都不同：`[+1]` 判**非法**，超大下标**放行** | 台账点名的两条分岐（段集为空 ⇒ `required` **2 键**、首段是 Index ⇒ `invalid_format` + `value` = 整个 path）已在 #30① 改成**逐支同构**（`entity-card.ts:241` 的 `inspectFieldPath`，对齐 `entity_card.rs:426-427`/`:429-431`/`:440-442`，判据 `entity-card.test.ts:193-213` 新增 7 行真值表）；**这两条残留**要消掉就得在前端引入 `usize` 的**位宽语义**（64 位上界、`+` 号容忍）＝**新开一个分岐面** ⇒ 明标在 `apps/desktop/ui/src/demo/handlers/entity-card.ts:235-237`。代价：手填 `[+1]` 或超大下标这类**表外路径**时两侧结论相反；UI 上的字段路径由前端自己生成，正常操作不可达 |
| E-31 | —（这条是 demo 侧**镜像假设**的边界，不是后端行为） | `matchesTagsLike`（`apps/desktop/ui/src/demo/handlers/shared.ts:99`）的前提是「JS 的 `JSON.stringify` 与 serde_json 默认序列化**逐字相同**（无空格分隔）」，写在 `shared.ts:93-97` | #30② 的镜像已实测覆盖**大小写、引号、`,`、含 `"` 与 `\` 与制表符 / C0 控制字符 / DEL 的标签**（判据 `project.test.ts:285`）并全部对齐。复审席的独立判断：两侧对 `"` `\` 都用 `\"` `\\`、对 `\b\t\n\f\r` 都用短转义、对其余控制字符都用 `\u00XX`、对非 ASCII 都**不**转义；唯一分岐面是**孤立代理项**，而它在 Rust `String` 里**根本不可表示** ⇒ 对**可达输入**同形成立。代价：这一层是**推理 + 抽样实测**，不是穷举证明；极端输入（控制字符一类）若将来出现分岐，先查这里 |
| E-32 | `export_write_file` 只把 `default_name` 当**保存对话框的默认名**，空串就是不预填、不报错（`apps/desktop/src-tauri/src/ipc/export.rs:40`）；最终返回**真实落盘路径**（`export.rs:67`，另见 E-19） | `default_name` 为空串时**原样回空串**，由浏览器自己挑下载名（`apps/desktop/ui/src/demo/handlers/export.ts:85-104`，`return defaultName` 在 `:104`） | 「对齐」在这里只能是**猜浏览器行为**，猜错就是新分岐；编一个名字回去＝demo 替用户造**假**信息，比不一致更糟；抛错又与 `export.rs:40` 不同形 ⇒ 取「**钉住现状**」，判据在 `apps/desktop/ui/src/demo/handlers/export.test.ts:216-226`。代价：今天**不可达**（三个调用方传的都是词典渲染好的非空名，且模板都带字面后缀）；若将来出现空名调用点需重新裁定（前端兜底一个 i18n 化默认名 / 后端也返回对话框实际用的名字） |

## §4b M3–M7 demo 闭环那一轮新增的差异条目（E-33 … E-45）

> **增补日期**：2026-09-28 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：`2026-09-28-demo-m3-m7-closed-loop-design.md`
>
> **编号说明**：本文 §4 的 docblock 提到过复审席在 `task-15-combined-review.md` §7 给的一份**候选**编号（E-28…E-35），
> 那份候选**从未被本文采纳**（其中的 E-33/E-35 当时就已分别落到 §6-9 / §7-1）。本文的 `E-*` 只按 §1 的纪律
> **从自身末尾续号**：E-32 之后就是 E-33。两份编号之间**没有对应关系**，不要拿那份候选清单来解读本节。
>
> **归类结论**（按 §1 的判据逐条过）：13 条**全部**属于「demo 不许实现算法」（规则 9）或「镜像成本 > 漂移风险」，
> **没有一条是缺陷**。唯一的例外形态是 E-42②（文稿的 CSV 置灰理由说错了）——它是**文案口径**问题而非算法问题，
> 两个候选修法都是产品口径，按 AGENTS 规则 8 交产品负责人裁，本轮不改。
>
> 🔴 **本节刻意不给行号**（理由见文首「2026-09-28 增补」那段）：改动未提交，钉行号等于钉在一个不存在的 commit 上。
> 引用一律用**路径 + 符号名**。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-33 🔴 | **M3–M7 的 20 条命令在 Rust 侧一条都不存在**：`apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 没有它们，`crates/**` 里没有对应 DTO、表与迁移（`collection_board` / `insight_list` / `diagnosis_overview` / `action_board` / `report_render` 在 `crates/` 与 `apps/desktop/src-tauri/` 下 grep **0 命中**） | `api/client.ts` 的 `IPC_COMMANDS` 由 40 条扩到 **60** 条，20 条全部在 `demo/backend.ts` 有真 handler（`Record<IpcCommand, DemoHandler>` ⇒ 漏一条 `tsc` 就红；`demo/backend.test.ts` 另有键集合相等断言） | AGENTS 规则 8 的 demo 优先：界面先收敛，契约由前端冻结后交给后端。🔴 **代价是用户可感知的**：`api/runtime.ts` 在桌面端判成 `'tauri'` ⇒ 这 20 条会走真 `invoke` ⇒ 后端没注册 ⇒ 报错。而 `components/AppLayout.tsx` 的左侧导航**没有按 runtime 屏蔽**这 5 个入口，所以 `mise run dev` 里点进采集 / 解析 / 诊断 / 行动 / 报告**任何一页都是报错现场**。裁定：**本轮不屏蔽**——屏蔽了就等于把「桌面端还差 20 条命令」这件事藏起来，而 Plan C 的排期正需要它显眼。👉 这也是 §5-11 那条「`IPC_COMMANDS` ↔ `ipc::handler()` 集合相等断言」至今没补的原因：**补了今天就红**，必须与 Plan C 的命令注册同一批落地 | 🔴 **2026-11-05 部分转正（读路径第一段）**：`collection_board` / `collection_round_get` / `collection_record_list` / `collection_record_get` 已落 Rust（`geo-domain::collection` + 迁移 `20261105000009_collection_read.sql` + `CollectionRepo` / `CollectionService`）。采集写路径、解析 / 诊断 / 行动 / 报告仍 demo-only；命令面 72 → **76**、pending 33 → **29**。 🔴 **2026-11-05 再转正 M4 读路径**：`insight_list` / `fact_check_list` 已落 Rust（`geo-domain::insight` + 迁移 `20261105000010_insight_fact.sql` + `InsightRepo` / `InsightService`）；`insight_correct` / `fact_check_resolve` 与诊断 / 行动 / 报告仍 demo-only。命令面 76 → **78**、pending 29 → **27**。 🔴 **2026-11-05 再转正 M5/M6 读路径**：`diagnosis_overview` / `diagnosis_competitors` / `diagnosis_funnel` / `diagnosis_engines` / `action_board` 已落 Rust（`geo-domain::diagnosis` / `action` + 迁移 `20261105000011_diagnosis_action_read.sql` + `DiagnosisRepo` / `DiagnosisService` / `ActionService`）。诊断按轮次存类型化 JSON 快照，行动看板按项目存快照；写路径、告警已读、处方状态仍 demo-only。命令面 78 → **83**、pending 27 → **22**。 🔴 **2026-11-05 再转正本地写路径**：`insight_correct` / `fact_check_resolve` / `diagnosis_alert_acknowledge` / `action_update_status` / `content_update_status` 已落 Rust。人工纠正同步提及明细与证据投影；告警已读改 overview 快照；处方完成时间首次盖章、回退清空；文稿只翻审核态。`content_generate` / 采集执行 / 报告仍 demo-only。命令面 83 → **88**、pending 22 → **17**。 🔴 **2026-11-05 再转正 `report_render`**：`geo-domain::report` 定义 `ReportDocument` / `ReportBlock` / `ReportSection` / `ReportMethodology` / `ReportRenderOptions` / `WhiteLabelProfile`（结构块 + 稳定记号，不做排版、不生成散文），`ReportService` 从既有诊断快照 / 核查问题 / 行动看板 / 证据记录组装三种版本；证据附录按 `include_evidence` 追加 `evidence` 节。🔴 与 demo 的两处有意差异：① 白标版在未传 `white_label` 时返回 `null`（demo 回落到种子里的示例机构），真后端不虚构服务商署名；② `model_versions` 暂为空数组（模型版本尚无落库来源），不伪造。命令面 88 → **89**、pending 17 → **16**。
| E-34 | 真后端 enqueue 时会展开出「题目数 × 引擎数 × 关键题目的重复次数」条任务，并逐条记账（产品定义 §3.5：7 引擎 × 60 prompts 一轮 ≤90 分钟、成功率 ≥90%、失败可单独重跑） | `collection_start` **只排一轮 `queued` 的空轮次**：`completed_queries`/`failed_queries`/`success_rate` 全 0、任务队列为空、`sample_size_grade` 一律回落最保守的 `insufficient`。`planned_queries = 题目数 × 引擎数`，**刻意不乘 `repeat_count`** | ① demo 不采集（规则 9），排队态必须能走查但不能假装自己会跑完。② **不乘 `repeat_count`** 是因为重复采样只作用于「关键题目」，而「哪些题算关键」由后端按意图与权重判定，demo 不判；乘上去还会与种子里第 3 轮自相矛盾（那一轮 `repeat_count: 2`、`planned_queries: 434` = 62 题 × 7 引擎）。`planned_queries` 本身**算**，是因为它是队列构造的算术、不是领域指标（规则 9 的红线是去重率 / 完整率 / 样本量分级那类**领域**计算）。判据在 `demo/seed.test.ts` 与 `demo/handlers/collection.test.ts`。代价：界面上「重复次数」这个入参**不影响任何数字**，产品负责人可能读成「选了没用」⇒ 已列为走查项（spec §12-2） |
| E-35 | 真后端重跑一条失败任务会真的再发一次请求，并**回写轮次级聚合**（`completed`/`failed`/`success_rate`/耗时/token） | `collection_task_retry` 不重跑：把 `demo/seed/collection-records-retest.ts` 里**预置**的那条证据（+ `SEED_RETRY_INSIGHTS` 里对应的解析结果）推进内存库，翻任务状态、`attempt += 1`、清 `failure_reason`。🔴 **轮次级聚合一律不动** | 重跑要有真引擎与真记账口径（成功率的分母含不含重复采样、超时算不算失败、降级到浏览器通道的耗时怎么记），demo 猜一个就是新漂移面（规则 9）。推进**预置**证据而不是凭空造一条，是为了让「失败 → 重跑 → 证据出现 → 解析结果跟着出现」这条链路可走查，同时不新增语料。重复点重跑不会把证据推进两次（按 `record.id` 去重）。🔴 **代价是界面会自相矛盾**：重跑成功后轮次的失败数与成功率**仍是旧值**，所以 `CollectionPage` 常驻「演示模式下聚合值是预置静态值、重跑后不重算」的口径说明（词典 `collection.staticNote`）。另有一支 demo 独有错误：`SEED_RETRY_OUTCOMES` 里查不到那条任务 ⇒ `state/conflict` + `reason: 'not_allowed'` + `value: 'no_demo_outcome'`（真后端不会有这个理由；`no_demo_outcome` 是 ASCII 记号，不踩门禁 7） |
| E-36 | 产品定义 §3.5 把「页面截图」写进**原始证据留存**这条护城河：每条记录保存 prompt 原文、引擎与模型版本、完整回答、引用链接、**页面截图**、时间戳、通道类型、耗时与成本；验收项含「单条记录可一键打开原始回答与截图」 | `CollectionRecordDetail.screenshot_path` 在**全部**种子里恒为 `null`，`EvidenceDrawer` 的截图那一格**永远显示空状态**（词典 `collection.evidence.noScreenshot`：「演示数据未包含截图；真后端会把截图与回答一起留存」） | demo 不抓网页也不截图（规则 9 的直接后果；且截图是二进制资产，塞进 TS 种子既不合理也让 bundle 膨胀）。🔴 刻意**保留那一格并明说**，而不是整格不渲染：截图是 M3 的**验收项**，藏起来等于让产品负责人漏验。代价：DTO 里 `screenshot_path` 的**非空分支在 demo 里不可达**，界面那一支（图片加载失败、本地文件路径解析）本轮**零测试覆盖**，Plan C 落地时要补 |
| E-37 | 真后端按项目按轮**实际记账**（查询次数 + token），并有硬配额上限、超额自动暂停（产品定义 §3.5「用量看板」） | `collection_board` 回的用量看板是**静态种子** `SEED_USAGE_BOARD`，且**只对种子里那个演示项目**有数据（其余项目回空看板）。`collection_start` 排的新轮次**不进看板**、不产生任何用量 | 记账口径（token 怎么数、失败请求算不算、缓存命中怎么折）是后端的事，demo 不算（规则 9）。「只对演示项目有数据」而不是给每个项目编一份：编出来的用量与该项目**根本没有轮次**这件事会当场打架。🔴 硬配额与超额暂停**在 demo 里完全不存在**（没有阈值、没有暂停态、没有提示），这是 M3 验收项里 demo **演不出来**的一项，spec §2 已把它写进非目标 |
| E-38 | 真后端的体检总分、五维得分、竞品矩阵、意图漏斗、引擎差异、趋势点、告警全部**从证据算出来**（产品定义 §3.7 与附录 C 的五维加权口径） | `diagnosis_*` 五条命令**一个算术都不做**，一律取 `demo/seed/diagnosis.ts` 的预置值。唯一写路径是 `diagnosis_alert_acknowledge` 翻 `db.alerts` 上的 `acknowledged`。🔴 `DiagnosisOverview` 内嵌的 `alerts` / `trend` 副本在**读取时**被 `db.alerts` / `SEED_TREND` 覆盖 | 规则 9。种子之间的自洽（权重加权 == 总分、归因卡片四个数 == 两轮 overview、报告数字 == 诊断数字）由 `demo/seed.test.ts` **静态钉住**，运行期不校验也不重算。「读取时覆盖」是 spec DR-17 的裁定：DTO 要求 overview 内嵌一份告警副本，若直接回副本，「标记已读」就得同时写两处（本仓反复警告的同步面）；覆盖后「两份副本谁是真值」在代码里只有一个答案。另：轮次存在但该视图无数据 ⇒ 回 `null`（列表类回 `[]`）**而不是报错**——进行中那轮（第 4 轮）刻意没有 overview，采集没跑完就出结论是造假 |
| E-39 | 真后端的人工纠正会**回流为 few-shot / 规则**以持续提升准确率（产品定义 §3.6「抽取质量保障」），结办一条核查问题也可能联动实体卡与准确率 | `insight_correct` 与 `fact_check_resolve` **真的改内存库**（人工操作这条链路必须能走查），但改完**不触发任何重算**：`confidence`、`fact_accuracy`、五维得分一动不动。纠正只许改三项（是否提及 / 推荐位次 / 情感倾向），其余字段传进来**原样忽略、不报错** | 回流训练与联动重算都是后端能力，demo 不做（规则 9）。**只放开三项**是产品语义而非技术限制：提及明细、回答形态、来源分布、置信度、风险标记是模型与规则的产物，让人改这些等于把「机器抽取的结果」与「人的判断」混成一团、事后没法追溯。🔴 唯一被同步的是**同一条事实在两个 DTO 上的两份写法**：`CollectionRecord.mentioned/rank/sentiment` 与 `AnswerInsight.self_*`、以及提及明细里 `role: 'self'` 那一行——那**不是重算**，不同步界面就会自相矛盾（种子里的一致性判据在 `demo/seed.test.ts`，运行期由 handler 维持）。界面因此常驻「纠正只改这一条的展示与证据行投影，不会重算任何比率」（`insight.correct.demoNotice`） |
| E-40 | 后端落地时这两个 DTO 的 `delta` 口径由 Rust 定；今天**没有真值源** | **已对齐（Plan B Task 8 · 裁定 3）**：两个 DTO 的 `delta` 现在都装**百分点**（比率类）或**条数**（`fact_error_count`）。`SEED_ALERTS` 的 `0.19 / -0.14 / -0.03` 已改成 `19 / -14 / -3`（`9` 是条数，不动）；`components/format.ts` 里的 `alertDeltaText` **连同它内部那支 `* 100` 一起删除**，格式化只剩 `metricDeltaText` 一个函数，单位由新增的 `alertMetricUnit(metric)` 给出（只回答单位、不做算术，AGENTS 规则 9） | 原先两个 DTO 分别按 M5 与 M7 的界面需要设计，口径不一致 ⇒ 界面上必须由两个格式化函数分别处理，同一个「降 14 个点」在两侧各有一套写法。👉 **已裁定（2026-09-29）：需要统一；方向取百分点**，并于 2026-09-30 按 `2026-09-28-demo-m3-m7-closed-loop-design.md` §11-3 的五步执行完毕（DTO 注释 → 种子 → 合成函数 → 判据 → 本条改标）⇒ **本条已对齐 · 留此仅作台账**。🔴 **界面上显示的数字一个都没变**（`-0.14 × 100` 与 `-14` 渲染出同一句「-14 个百分点」），变的是**契约与种子**：Plan C 落后端时 `AlertItem.delta` 必须**直接发百分点**，再发 0~1 的比率就会在界面上小 100 倍。判据两道：`components/format.test.ts` 断言 `alertDeltaText` 不再被导出（留着旧函数就等于口径没统一），`demo/seed.test.ts` 断言告警 delta 是整数、且与 `detail` 里点名的「N 个百分点」逐条对得上 |
| E-41 | 真后端的 `content_generate` 会调模型成文（与仓库现有 `gdk_auto_article` 自动成文能力打通，产品定义 §3.8 第 4 类处方），并跑合规扫描（不生成虚假案例/资质、不用绝对化用语） | `content_generate` **不调模型**：按模板 `kind` 从 `demo/seed/contents.ts` 取一份**预置**演示文稿（标题与正文各一张按 kind 索引的表）。产物一律 `status: 'pending_review'` + `compliance_checked: false`，界面显示「演示模式未执行合规扫描」（`action.contents.complianceUnchecked`） | 规则 9（不跑模型）+ AGENTS 规则 6（生成内容默认 `PendingReview`）。🔴 `compliance_checked` 对**新产物**恒为 `false`：demo 没有合规扫描器，写 `true` 就是**假声明**。种子里那两份「已经生成过」的文稿是 `true`——它们是演示数据，代表真后端扫过之后的样子，于是界面上两种形态（已扫 / 未扫）都能走查。走查的是**产物形态**（章节结构、Markdown 排版、审核态、导出格式），不是文笔 |
| E-42 | 桌面端产 `docx` / `pdf` / `png`（M7 要求 PDF 中英、Excel 明细、PNG 看板图、HTML；M6 要求导出 Markdown / DOCX / HTML） | ① `DESKTOP_ONLY_EXPORT_FORMATS = ['docx','pdf','png']`：报告页与文稿页这三个按钮**照旧渲染但置灰**，下面逐条说明「{{format}} 由桌面端提供，演示模式下不可用」。② 🔴 **文稿这里连 CSV 也置灰**（`CONTENT_EXPORTABLE_FORMATS = ['markdown','html']`，`api/content-compose.ts`），而**报告那里 CSV 是可点的**（`api/report-compose.ts` 的 `ReportExportKind` 含 `csv`） | ① 那三种要原生渲染或文档库，纯前端 demo 不引；**保留按钮**而不是不渲染，是为了让产品负责人看到桌面端的完整能力面。② 文稿正文是散文，CSV 没有意义（`api/content-compose.ts` 的头注释就是这个理由）——但置灰说明**沿用了** `action.export.desktopOnly` 那句「由桌面端提供」，于是**理由说错了**：报告 CSV 在 demo 里明明能出。🔴 这是本轮**唯一一处界面上自相矛盾**的形态。**已裁定（2026-09-29）：不改**，产品负责人的理由是「这个 web 页面只是个 demo」⇒ 按 §1 的先例（E-17）标为**已裁定 · 留此仅作台账**，下一个人不要重新发现一遍。⚠ 本条裁定**只**覆盖置灰理由的文案矛盾，不覆盖「文稿到底该不该有 CSV」这个能力问题；Plan C 落桌面端时若要给文稿加 CSV，仍需重新裁 |
| E-43 | 真后端按 variant 决定给哪些节；某一节没有数据时怎么处理由后端定（今天没有真值源） | `report_render` **只组装不生成**：按 `variant` 挑节 → 按 `include_evidence` 追加证据附录 → 按 `white_label` 决定署名。🔴 **没有数据的节整节省略**（`payload.sections[id]` 为空就不进 `sections`），不渲染空标题 | 报告是要发给老板与客户的，一个空的「竞品对标」看起来像「这一项是 0」，**比不出现更糟**。小样本的通道验证轮（第 1 轮）只预置了「结论」一节（连竞品矩阵都没有），于是三个版本在那一轮都只剩结论 + 关键数字 + 下一步。另：`variant` 是 M3–M7 里**唯一不做收敛**的枚举入参——契约外的值发 `validation/failed` + `invalid_format`，因为悄悄出一份别的版本比报错更糟（spec DR-16）。🔴 报告标题 / 节标题 / 指标名 / 表头 / 免责声明 / 口径说明**都不在种子里**，一律走词典（spec DR-19）⇒ 导出文件（Markdown / HTML / CSV）随界面语言走；种子只给稳定记号 + 数据。这也是「后端产出自然语言进契约」这一类问题（§5-2）在本轮**没有重犯**的原因 |
| E-44 | `contracts/error-codes.json` 冻结在 43 条，`errors.kinds.*` 钉在 Rust 真值源上不许扩；M3–M7 的实体在契约里**没有**自己的 `*_not_found` 码 | ① 13 个新 `field` 值只活在**前端词典** `i18n/locales/{zh-CN,en-US}/fields.ts` 里：`round_id` / `task_id` / `record_id` / `insight_id` / `issue_id` / `self_rank` / `alert_id` / `action_id` / `template_id` / `content_id` / `variant` / `engine_scope` / `status`。② 5 个新 `aria-label` 键（`insight.roundAria`、`insight.filters.{engine,review,mentioned,risk}Aria`）同样只在前端 | ① 假后端用**既有**的 `validation/failed` + `reason: 'invalid_id'` 组合报「这个实体 id 认不出」（spec DR-15），字段名因此必须进 `fields` 词典，否则界面上会露出 `round_id` 这种机器记号（AGENTS 规则 7）。**不新增错误码**是因为契约已冻结、`errors.kinds` 不许扩。② 占位文案在选中之后就消失，用占位定位既不稳定也与读屏用户看到的不一致，所以补了可访问名。🔴 代价：这 13 个字段名与 5 个键**在后端没有任何对应物**。👉 **已裁定（2026-09-29）：后端沿用** `validation/failed` + `invalid_id` + `field`，**不**给每类实体新发 `*_not_found`；附加要求是「后期生成本地应用时候需要能够兼容中英文」——这条今天已成立（后端只回稳定记号，文案由前端词典按语言渲染，13 个 `field` 值 zh/en 逐字对齐并有 parity 守卫看着）。Plan C 的义务是**不许把中文字段名写进 Rust**（那是 §5-2 的重犯），详见 spec §11-5 |
| E-45 | **Rust 侧不存在这个常量**：M4 的抽取质量口径（置信度门槛、双模型交叉校验）尚未落后端 | `api/constants.ts` 的 `REVIEW_CONFIDENCE_FLOOR = 0.75` 是 demo 与界面**共用**的展示口径：`demo/seed/insights.ts` 的 `needs_review` 静态值按它编排，`pages/InsightPage.tsx` 用它解释「为什么这几条进了复核队列」（`insight.list.confidenceFloor`） | 放在 `api/constants.ts` 而**不是留在种子里**，是因为页面也要用：页面 import 种子模块会让「界面文案依赖演示数据」这条反向依赖长出来，等真后端接上就得回来拆。与 `SUFFICIENT_SAMPLE_SIZE` / `MINIMUM_SAMPLE_SIZE` 那两个常量不同——那两个有 Rust 真值源（`crates/geo-domain`）且已由 `src/test/truth-source.ts` 那套「解析真值源」手法看着，这一个**没有**，所以它的头注释里明写了「真后端落地时以 `crates/geo-domain` 的抽取质量口径为准，若数值不同则改这里并在本文登记」。🔴 代价：门槛值改了种子就得重编（`needs_review` 是静态值，不是算出来的），两侧不一致时界面会说出「置信度低于 0.75 的进复核队列」而队列里明明有 0.80 的条目。👉 **已裁定（2026-09-29）：demo 验收确定后需要同步 Rust 侧**，已列为 Plan C 必做项（spec §11-2 / §13-6）：收进 `crates/geo-domain` 的 `pub const`，前端改走 `src/test/truth-source.ts` 解析真值源，不再手抄 |

## §4c Plan B（导航 / 设置 / 新建项目）那一轮新增的差异条目（E-46 … E-51）

> **增补日期**：2026-09-30 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：`2026-09-29-plan-b-navigation-settings-newproject-design.md`
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-45 之后就是 E-46，不重号、不跳号。
>
> **归类结论**（按 §1 的判据逐条过）：6 条里 4 条属于「demo 不许实现算法」（规则 9：E-46 / E-49 / E-50 / E-51），
> 2 条属于「镜像成本 > 漂移风险」（E-47 / E-48：镜像就要在前端另抄一份 Rust 枚举与 DTO 形状，那必然漂移），
> **没有一条是缺陷**。E-47 / E-48 / E-49 三条都带**Plan C 的落地义务**（扩枚举、加 `#[serde(default)]`、补三条命令），
> 已分别写进各条的"代价"格里。
>
> 🔴 **本节同样不给行号**（理由与 §4b 相同：改动未提交，钉行号等于钉在一个不存在的 commit 上），
> 引用一律用**路径 + 符号名**；只有 Rust 侧那些**本轮一行未动**的真值源给了行号（它们是已提交的稳定事实）。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-46 | **`llm_models_list` / `app_environment` 两条命令在 Rust 侧不存在**：`apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 没有它们，`crates/**` 里没有 `ModelsListResult` / `AppEnvironment` 这两个 DTO | `api/client.ts` 的 `IPC_COMMANDS` 由 60 条扩到 **62** 条，两条都在 `demo/backend.ts` 有真 handler（`demo/handlers/llm-models.ts` / `demo/handlers/app-environment.ts`）：前者按 provider 回 `demo/seed/model-catalogs.ts` 的预置清单（`source: 'preset'`），后者回一组形状正确的静态环境事实 | 与 E-33 同族（AGENTS 规则 8 的 demo 优先：界面先收敛，契约由前端冻结后交后端），那一族的命令数由 20 → **22**。🔴 代价同样是用户可感知的：桌面端 `runtime === 'tauri'` ⇒ 设置页点「拉取模型列表」会走真 `invoke` ⇒ 后端没注册 ⇒ 报错现场（裁定与 E-33 一致：**不屏蔽**，Plan C 的排期正需要它显眼）。另：`llm_models_list` 的入参可以带一把**临时** Key，它只在内存里过一趟，不落库、不进日志、不进错误 `params`（AGENTS 规则 3，判据在 `demo/handlers/llm-models.test.ts`） |
| E-47 | `crates/geo-llm/src/provider.rs:66-106` 的 `LlmProvider` 只有 **7** 个变体（6 家国内厂商 + `Custom`），`PROVIDER_ALIASES`（`:80-93`）那 12 条别名也只映射到这 7 个 | `demo/seed/settings.ts` 的 provider 预设表是 **12** 项：6 家国内厂商 → 5 家中转站（`openrouter` / `siliconflow` / `302ai` / `yunwu` / `deepbricks`）→ `custom` 末位；词典 `settings.providers.*` 与种子**同集同序**（漂移守卫在 `demo/seed.test.ts`），下拉顺序由词典钉住 | 产品负责人点名要「国内外模型厂商 + 知名中转站」（spec §9-A 裁定：本轮先用**预设表**，档案制 `provider_profiles` CRUD 推 Plan C）。镜像成本 > 漂移风险：要在前端复刻 7 个变体就得另抄一份枚举与别名表，而这一轮的目的恰恰是**扩**它。🔴 代价：Rust 侧 `LlmProvider::parse` 认不出这 5 个新 id ⇒ 桌面端存设置会把它们收敛成 `Custom`（预设 base_url 丢失）。**Plan C 的义务**是同一批里做完三件事：扩枚举变体、扩 `PROVIDER_ALIASES`、给每家补预设 `base_url`；`SEED_MODEL_CATALOGS` 那份静态模型清单则退役，换成按 `base_url` + Key 现拉（就是 `llm_models_list` 的 `source: 'upstream'` 那一支） |
| E-48 | `crates/geo-store/src/settings.rs:108-115` 的 `AppSettings` 只有 `proxy / concurrency / rate_limit / model / language / notify` 六段；`ModelConfig`（`:64-74`）只有 `provider / model / base_url / temperature / timeout_secs` | `api/types.ts` 的 `AppSettings` 追加 `privacy: PrivacyConfig`（4 个数据外发开关，默认 `true/true/true/false`）与 `storage: StorageConfig`（`last_export_dir`）；`ModelConfig` 追加 `protocol: 'openai_compat' \| 'anthropic'`。`settings_update` 是**整包写**，所以这三个字段在 demo 里真的会被存下来、刷新后恢复 | 三段都是产品负责人点名的设置项（权限与隐私 / 模型协议可选）。🔴 代价（**Plan C 必读**）：`settings` 表存的是 key-value JSON，真后端反序列化会因**缺字段**而失败——`AppSettings` 那六段没有 `#[serde(default)]` 兜底（只有 `ModelConfig.base_url` 有，见 `:70` 的注释先例），所以落地时要么给 `privacy` / `storage` / `protocol` 各加 `#[serde(default)]`，要么走一次迁移；`protocol` 还要与 `geo-llm` 的 `ChatClient` 分派接上（今天 Rust 只实现 OpenAI 兼容那一支，选 `anthropic` 会是个"能存不能用"的字段） |
| E-49 | 真桌面端能从 macOS 拿到通知 / 文件与文件夹 / 屏幕录制的**授权状态**，也能真的打开访达、弹系统目录选择器、跳系统设置 | `demo/handlers/app-environment.ts` 的 `permissions` 三项**恒为 `'unsupported'`**（浏览器确实没有这些系统权限，回 `'granted'` 是假声明）；`storage.*` 是一组形状正确的**静态 ASCII 路径**（demo 不碰文件系统）；「打开目录」「更改目录」「去系统设置」三个按钮**照旧渲染但置灰** + 一句「由桌面端提供，演示模式下不可用」 | 规则 9 + DR-35 的裁定：本轮**不加** `storage_open_dir` / `open_system_settings` / `permission_request` 三条命令，按钮置灰而不是隐藏（藏起来等于让产品负责人漏验一项能力），形态与 M7 对 docx/pdf/png 的既有口径一致。🔴 代价：这三个动作在 demo 里**零覆盖**，Plan C 加命令时要连同失败分支（用户拒绝授权、目录不可写、路径失效）一起补测；`db_size_bytes` 在 demo 里是静态值，真桌面端来自 `fs::metadata` 的 len，读失败时的 0 值分支同样只在 demo 里被"格式化层"覆盖（`bytesText` 把负数 / NaN 收敛成 `0 B`） |
| E-50 | 真后端**没有**"只给一个网址就建项"的命令：`services/entity_card_service.rs:85` 的 `autobuild` 要求项目已存在，抓取要几十秒、会真的爬站并调模型；抽取出的字段由 `crates/geo-domain/src/entity_card.rs:243-250` 的 `from_extraction` 一律标 `Pending` | `/projects/new/auto` 把**既有**命令串成一条链：`project_create`（草稿的品牌名先用网址的 host 占位）→ `entity_card_autobuild` → `project_update`（用抽到的 `standard_name` 回填项目名），抽取失败时 `project_delete` **回滚**刚建的项目；三段进度（抓取中 → 抽取中 → 完成 N%）各有**最短停留**，产物是种子里那张预置卡，`field_status` 一律 `pending` | DR-36「先建后抽、不改命令签名」+ 规则 2/9（不联网、不实现算法）。进度分三段而不是一步跳完，是因为**等待形态本身就是要验收的东西**（真后端抓取要几十秒）。🔴 代价三条：① 界面全程常驻「演示模式不抓取网页，抽取结果是预置数据」，抽出来的字段值与网址**无关**（填任何合法域名都得到同一张卡）；② "host 占位 → 标准名回填"是 demo 侧的演出，真后端要么在 `project_create` 之前就拿到品牌名，要么新发一条命令，**Plan C 需要裁**；③ 抽取失败时 demo 会**删掉**刚建的项目，真后端的 `autobuild` 失败不会删项目——两侧对"半成品项目"的处理不同，Plan C 要么沿用回滚、要么把这条差异做成用户可见的提示。✅ 本轮顺带**对齐**了一处：新建的卡此前照抄种子的混合状态（6 个字段一上来就是「官方口径」），现已改成一律 `pending`，与 `from_extraction` 同口径（判据在 `demo/handlers/entity-card.test.ts`） |
| E-51 | `crates/geo-store/src/settings.rs:113` 的 `AppSettings.language`（默认 `"zh_cn"`）是**生成内容**的语言；`crates/**` 里**没有**界面语言（locale）这个字段，真桌面端今天也没有它的落点 | 两个**互不联动**的控件：界面语言走 `store/preferences.ts` 的 `locale`，存 `localStorage['geo.preferences']`（首帧前同步读，避免闪语言），**不进** `AppSettings`；生成内容语言走 `settings.language`，整包写库。改一个不动另一个（DR-32，判据在 `pages/settings/GeneralSection.test.tsx`：切界面语言后 `i18n.language` 变而 `settings.language` 不变，反之亦然）。`theme` / `fontScale` 与 locale 同住一个 localStorage key，只含 `locale` 的**旧 payload** 被容忍（其余两项回落默认，不抛错） | DR-29 的裁定：外观与界面语言是**本机偏好**，不是项目数据，混进 `AppSettings` 会让"换台机器打开同一个库"改变别人的界面语言。🔴 代价：换机器 / 重装后界面语言回落默认 `zh-CN`，而生成内容语言跟着库走，两者会出现"界面英文、生成中文"的组合（这是**预期**，界面上分别标了「界面语言」与「生成内容语言」）。**Plan C 的义务**是裁一次 locale 要不要也进 `AppSettings`：若进，`preferences` 与库就成了两个真相，必须同时给出"谁覆盖谁"的规则，否则首帧同步读那条防闪逻辑会与库里的值打架 |

## §4d M1.5 素材层（关键词库 / FAQ 常见问题库）那一轮新增的差异条目（E-52 … E-54）

> **增补日期**：2026-09-30 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：`2026-09-30-keyword-faq-library-design.md`（DR-37 … DR-44）
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-51 之后就是 E-52，不重号、不跳号。
>
> 🔴 **命令面先说清楚（本节三条之外的"第 0 件事"，与 E-33 / E-46 同族）**：本轮新增的
> **10 条命令只有 demo 侧实现**——`api/client.ts` 的 `IPC_COMMANDS` 由 62 条扩到 **72** 条，
> `keyword_list` / `keyword_add` / `keyword_update` / `keyword_delete` / `keyword_generate` 与
> `faq_list` / `faq_add` / `faq_update` / `faq_delete` / `faq_generate` 在 `demo/backend.ts` 都有真 handler
> （`demo/handlers/keyword.ts` / `demo/handlers/faq.ts`），但 `apps/desktop/src-tauri/src/ipc/mod.rs` 的
> `generate_handler![]` 里**一条都没有**，`crates/**` 里也没有 `KeywordItem` / `FaqItem` / `KeywordKind` /
> `LibrarySource` 这四个 DTO。⇒ 桌面端（`runtime === 'tauri'`）点进这两个新页面会当场报
> `ipc/unknown_command`。「demo 独有命令」这一族的规模由 22 → **32**。裁定与 E-33 / E-46 逐字一致：
> **不屏蔽**——Plan C 的排期正需要它显眼（AGENTS 规则 8 的 demo 优先：界面先收敛，契约由前端冻结后交后端）。
> 与之相反，**两个导出出口一条新命令都没加**（DR-44）：CSV 与 FAQPage JSON-LD 的文本都在前端组装
> （`api/library-compose.ts`），落盘复用既有的 `export_write_file`；「引用到 Prompt 题库」同样复用既有的
> `prompt_item_add`（DR-43），所以那条链路是**真的写路径**——引用完切到题库页看得见那几道题。
>
> **归类结论**（按 §1 的判据逐条过）：3 条**全部**属于「demo 不许实现算法」（规则 9），
> **没有一条是缺陷**；3 条都带 Plan C 的落地义务，已分别写进各条的"代价"格里。
>
> 🔴 **本节同样不给行号**（理由与 §4b / §4c 相同：改动未提交，钉行号等于钉在一个不存在的 commit 上），
> 引用一律用**路径 + 符号名**。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-52 | 关键词挖掘要**调模型 + 调第三方关键词接口**才能产出月搜索量 / 竞争度 / 难度分。Rust 侧今天**没有这条链路**：`crates/**` 里没有 keyword 相关的 DTO / service / repo，`geo-crawler` 只抓页面不建词库，`contracts/error-codes.json` 里也没有关键词的字段名 | `keyword_generate`（`demo/handlers/keyword.ts`）只做三件事：按 `kinds` 过滤 `demo/seed/keywords.ts` 的 `SEED_KEYWORD_GENERATED_POOL`（12 行**紧凑语料**，不入初始库）、跳过库里已有的等值文本（见 E-54）、取前 `target_count` 条（`min(target_count, 命中数)`）。`monthly_volume` / `difficulty` 一律是种子里的**字面量**（初始 14 行 + 池 12 行），一个都不抓、一个都不算；其中 2 行刻意是 `null`，界面显示空值占位符而不是 0。页面常驻 `library.keyword.staticNote`，生成弹窗里再挂 `library.keyword.demoBody` | 规则 9 的直接后果（搜索量与难度分是第三方数据，不是领域算法，但 demo 同样不许联网去取，规则 2）。🔴 代价四条：① 生成结果与**项目本身无关**——任何项目点生成都得到同一批词，走查的是产物形态（类型 / 意图 / 审核态），**不是选词质量**，所以那句 `demoBody` 必须显示，否则产品负责人会拿演示数据评审选词；② 这两列在真后端接上之前**没有真值源**，Plan C 要裁第三方接口的口径（哪个数据源、月度还是日均、难度分怎么归一到 0–100）并把 `null` 的语义（"没数据"而不是"0"）一起定下来；③ `priority`（1..5）会被当成 Prompt 的 `weight` 引用进题库（DR-43），真后端若改这个区间，引用映射要同批改；④ CSV 表头常量 `KEYWORD_CSV_HEADER` 住在 `api/library-compose.ts` 而**刻意不进** `api/constants.ts`（那个文件的口径是"与 `csv_io.rs` 逐字同步"，而这张表在 Rust 侧还不存在）⇒ Plan C 要裁它进不进 `csv_io.rs`；不进的话，关键词 CSV 的表头就没有真值源守卫看着 | 🔴 **2026-11-03 部分转正**：`keyword_list` / `keyword_add` / `keyword_update` / `keyword_delete` 已落 Rust（`geo-domain::keyword` + `geo-store` 迁移 `20261103000002_keywords.sql` + `KeywordService`）。🔴 **2026-11-04 再转正 `keyword_generate`**：调模型生成候选，但 `monthly_volume` / `difficulty` 仍为 `null`——第三方关键词接口未接入，不用 0 或模型臆造值冒充。命令面因此 40 → **50**、pending 65 → **55**；FAQ 见 E-53。
| E-53 | FAQ 成文要**按实体卡 + 意图调模型**，并跑**合规扫描**（规则 6：生成内容默认 `PendingReview`、禁绝对化用语）。Rust 侧今天**没有 FAQ 这个实体**，也没有"结构化数据（JSON-LD）由后端产出"这条链路 | `faq_generate`（`demo/handlers/faq.ts`）**不成文、不跑合规扫描**：从 `demo/seed/faqs.ts` 的 `SEED_FAQ_GENERATED_POOL`（8 行）里按 `intents` 挑，产物 `source` 一律 `generated`、`status` 一律 `pending_review`。界面两处说明：`library.faq.staticNote` 常驻 + `library.faq.complianceUnchecked`（「演示模式未执行合规扫描」）挂在**待审的 AI 答案**旁边。导出走 `api/library-compose.ts` 的 `composeFaqJsonLd`，🔴 **只收 `status === 'approved'`** 的条目，零条可用时按钮置灰并给出原因（`library.faq.exportDisabled`） | 规则 6 + 规则 9。答案按 Markdown **原文**塞进 `acceptedAnswer.text`，不引解析器（与 `api/content-compose.ts` 对 `html` 那一支同族取舍）。🔴 代价三条：① schema.org 的 `text` 是**纯文本**口径，而 demo 里塞进去的是带 `\n` 与 `-` / `1.` 列表记号的 Markdown ⇒ Plan C 要裁"结构化数据里到底允不允许 Markdown 记号"（要转就得引渲染，不转就得接受搜索引擎原样索引）；② "只收 approved"这道闸门今天**由前端组装层持有**，真后端若改成由命令产出 JSON-LD，闸门必须一起搬过去——搬漏了就是把**待审答案贴到客户官网上**（规则 6 最坏的失败形态）；③ 合规扫描在 demo 里**零覆盖**，Plan C 要连同"扫描不过 ⇒ 不许采用"这条分支一起补测，界面那句 `complianceUnchecked` 届时要退役 | 🔴 **2026-11-03 部分转正**：`faq_list` / `faq_add` / `faq_update` / `faq_delete` 已落 Rust（`geo-domain::faq` + 迁移 `20261103000003_faqs.sql` + `FaqService`），`faq_generate` 仍 demo-only；命令面因此 44 → **48**、pending 61 → **57**。 🔴 **2026-11-04 转正**：`faq_generate` 已落 Rust（模型成文 + `compliance` 红线扫描，命中整批拒绝；产物 `generated` + `pending_review`，问题等值去重）；FAQPage JSON-LD 仍由前端组装后走 `export_write_file`。
| E-54 | 素材去重是**近似重复**判定，与 `prompt_set_dedupe` 的去重率同族——那是 `crates/geo-domain` 的**纯函数**（AGENTS 规则 9 点名的领域算法） | 两个 generate handler **一个相似度都不算**：只跳过与库里已有条目**文本完全相同**的（关键词比 `text`、FAQ 比 `question`，纯等值判断）。等值判断挡不住近似重复，所以 demo 里"点两次生成"只会得到一批新词，不会得到两份一模一样的清单，但**近义的两条会并存** | 规则 9（去重率是领域算法，demo 里只呈现预置静态值，不"顺手实现"）。做等值判断而不是完全不做，是为了让"连点两次不会重复入库"这条最基础的界面行为成立（否则走查时满屏重复条目，看不出别的东西）。🔴 代价三条：① `布袋除尘器厂家` 与 `布袋除尘器 厂家` 这种近似重复**挡不住**，界面上会出现两条几乎一样的词——真后端接上之前这是**已知现象**、不是缺陷；② 素材库因此**没有**去重率这个指标，M2 题库那套 `prompt_set_dedupe` + 去重率 + 样本量分级在素材层**没有对价**，Plan C 要裁"素材库要不要共用题库的去重口径"；③ 若共用，`dedupe` 的返回形状（去重率 + 被删条目清单）要在素材库再实现一次，两个页面的界面口径必须一致，否则同一个词在题库里被判重、在素材库里不被判重，用户看不出为什么。种子侧的一致性由 `demo/seed.test.ts` 静态钉住（两个池子各自内部零重复、且与初始库零重叠） |

## §4e M6.5 站点接入与补丁工作台那一轮新增的差异条目（E-55 … E-57）

> **增补日期**：2026-09-30 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：`2026-09-30-site-connect-patch-bench-design.md`（DR-45 … DR-58）
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-54 之后就是 E-55，不重号、不跳号。
>
> 🔴 **命令面先说清楚（本节三条之外的"第 0 件事"，与 E-33 / E-46 / E-52 同族）**：本轮新增的
> **11 条命令只有 demo 侧实现**——`api/client.ts` 的 `IPC_COMMANDS` 在 M1.5 那 72 条之上加 11 条
> （`site_board` / `site_profile_save` / `site_channel_upsert` / `site_channel_test` /
> `site_channel_remove` / `site_patch_add` / `site_patch_save` / `site_patch_generate` /
> `site_patch_transition` / `site_patch_history` / `site_patch_delete`），`demo/backend.ts` 都有真 handler
> （`demo/handlers/site.ts` + `demo/handlers/site-patch.ts`，读写 `demo/db.ts` 的 `siteProfiles` /
> `siteChannels` / `sitePatches` / `sitePatchEvents` 四张运行时表），但
> `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 里**一条都没有**
> （它今天仍止于 `secret::llm_providers`），`crates/**` 里也没有 `SiteProfile` / `SitePage` /
> `SiteChannel` / `SitePatch` / `SitePatchEvent` 这五个 DTO。⇒ 桌面端（`runtime === 'tauri'`）
> 点进「站点接入」会当场报 `ipc/unknown_command`。「demo 独有命令」这一族的规模由 32 → **43**。
> 裁定与 E-33 / E-46 / E-52 逐字一致：**不屏蔽**——Plan C 的排期正需要它显眼（AGENTS 规则 8 的
> demo 优先：界面先收敛，契约由前端冻结后交后端）。
> 与之相反，**六个导出出口一条新命令都没加**（DR-53）：交接单 / `llms.txt` / `robots.txt` 放行段 /
> `patches.json` / 边缘函数骨架 / 台账 CSV 的文本全在前端组装（`api/site-compose.ts`），
> 落盘复用既有的 `export_write_file`。
>
> **归类结论**（按 §1 的判据逐条过）：E-55 属「命令面尚未落地」（E-33 族），
> E-56 属「镜像成本 > 漂移风险」且撞上凭据面红线（规则 3），E-57 属「demo 不许实现算法」（规则 9）
> + 测试禁止联网（规则 2）；**没有一条是缺陷**；3 条都带 Plan C 的落地义务，已分别写进各条的"代价"格里。
>
> 🔴 **本节同样不给行号**（理由与 §4b / §4c / §4d 相同：改动未提交，钉行号等于钉在一个不存在的
> commit 上），引用一律用**路径 + 符号名**；例外是 Rust 侧那些**本轮一行未动**的凭据面真值源。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-55 | Rust 侧**没有"站点"这个实体**：`crates/**` 里没有 `SiteProfile` / `SitePage` / `SiteChannel` / `SitePatch` / `SitePatchEvent` 五个 DTO，没有对应的四张表与迁移，`apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 止于 `secret::llm_providers`，`contracts/error-codes.json` 里也没有站点相关的字段名 | 11 条命令在 `demo/handlers/site.ts` + `demo/handlers/site-patch.ts` 都有真实现（读写 `demo/db.ts` 的四张运行时表，`resetDemoDb()` 回种子）；页面在 `pages/SitePage.tsx`，六个产物在 `api/site-compose.ts` | AGENTS 规则 8 的 demo 优先（界面与契约先收敛）。🔴 代价五条：① 桌面端点进「站点接入」当场报 `ipc/unknown_command`，与 E-33 / E-46 / E-52 同族，**不屏蔽**；② Plan C P0 要按本轮冻结的契约（`api/types-site.ts`）建四张表 + 迁移 + 这 11 条命令；③ `SitePatchEventKind` 有 `exported`（导出留档）一档，而 demo **一条都不产生**——导出复用既有 `export_write_file`、刻意不为它加第 12 条命令（与 E-53 同族的取舍），⇒ Plan C 要裁「导出留档由谁记」：让前端记等于把审计口径交给客户端时钟；④ `site_patch_transition` 的三个动作在 demo 里是**全函数**（不存在"非法跃迁"错误码），三道闸门（发布要 `approved`、撤回要正在生效、回滚要有可回快照）今天**由前端持有**（`components/SitePatchTable.tsx` 的 `canPublish` / `canUnpublish` / `hasPendingChange`），真后端落地时必须把这三条判据一起搬过去——搬漏了就是把**待人工审核的草案发上客户官网**（规则 6 最坏的失败形态，与 E-53 ② 同形）；⑤ 六个产物的组装（含 `SITE_LEDGER_CSV_HEADER` 那 14 列）今天住在前端且**刻意不进** `api/constants.ts`（那个文件的口径是"与 `csv_io.rs` 逐字同步"，而这张表 Rust 侧还不存在）⇒ 与 E-52 ④ 是**同一条债**：Plan C 要裁它进不进 `csv_io.rs`，不进的话台账 CSV 的表头就没有真值源守卫看着 | 🔴 **2026-11-04 部分转正**：`site_board` / `site_profile_save` / `site_channel_upsert` / `site_channel_remove` 已落 Rust（`geo-domain::site` + 迁移 `20261104000005_site_profile_channels.sql` + `SiteRepo` / `SiteService`）；页面清单暂由项目自有页面资产投影，`patches` / `pool` 暂为空。🔴 **2026-11-05 再转正 `site_channel_test`**：边缘函数真发一次 GET，CMS / 仓库只报缺少配置或凭据；`check_detail` 已结构化。仅 `site_patch_generate` 仍 demo-only；命令面 56 → **72**、pending 49 → **33**。 🔴 **2026-11-04 第二段转正**：`site_patch_add` / `site_patch_save` / `site_patch_transition` / `site_patch_history` / `site_patch_delete` 已落 Rust（`geo-domain::site_patch` + 迁移 `20261104000006_site_patches.sql` + `SitePatchRepo` / `SitePatchService`）。手动补丁 `action_id` 非空一律拒绝（行动中心未落 Rust，避免悬空归因），`round_id` 留空串；`site_patch_generate` 仍 demo-only。命令面 60 → **65**、pending 45 → **40**。
| E-56 | 凭据面**只有一种 kind**：`apps/desktop/src-tauri/src/services/settings_service.rs:23` 把 `SECRET_KIND` 写死成 `"llm"`，`apps/desktop/src-tauri/src/ipc/secret.rs:13` 的 `secret_set(provider, value)` 入参里**没有** kind / subject；引用串由 `crates/geo-store/src/secret.rs:30` 的 `secret_ref(kind, provider)` 拼成 `keyring://{kind}/{provider}`（**恰好两段**），而 `:35` 的 `parse_secret_ref` 对 `provider.contains('/')` 一律返回 `None` | `demo/db.ts` 的 `demoSiteSecretRef(kind, projectId)` 拼的是 `keyring://site/{kind}/{project_id}`（**三段**）。站点通道只存 `endpoint` 与 `username` 两个**非敏感**字段；`credentials_state` 由 kind 推导，demo 里只会是 `not_required` 或 `missing`（**永不** `stored`），`secret_ref` 只是一个引用串——任何密码 / token 都不进内存、不进库、不进错误 params（规则 3 / DR-48）。界面上 `site.channels.demoCredentials` 在需要凭据的那三条通道上常驻 | 规则 3（密钥永不落库）+ 镜像成本（要在前端另造一份凭据面口径，必然漂移）。🔴 代价四条：① 三段引用串**过不了** `parse_secret_ref`（它按两段解析，多一段就回 `None`）⇒ Plan C P0 必须先把凭据面泛化成 `(kind, subject)`：`secret_set` / `secret_status` / `secret_delete` 三条命令都要加入参，`SECRET_KIND` 从常量变入参，`parse_secret_ref` 要支持多段（并同步它自己的单元测试）；② 站点通道要存的是 WordPress **应用程序密码**与边缘平台的部署 token，与模型 Key 是两类东西，混在 `llm` 这一个 kind 下会互相覆盖；③ demo 的 `credentials_state` 永不 `stored`，所以「凭据已入钥匙串」那一档在 demo 里**走查不出来**（词典里有、界面上看不到）——这是刻意的：demo 收一个它存不了的密码等于撒谎；④ `site_channel_test` 在真后端要**真的**发一次请求（探 `patches.json` 是不是 404、WP REST 可达不可达），凭据面没泛化之前它无从谈起 ⇒ P1 的 `edge` 通道与 E-56 是同一个前置 |
| E-57 | 页面清单由爬虫发现（`geo-crawler`），通道自检要**真的**发请求，补丁正文要**调模型**成文并跑合规扫描（规则 6：生成内容默认 `PendingReview`、禁绝对化用语）。这三条链路 Rust 侧今天都不存在（见 E-55） | ① `SEED_SITE_PAGES` 是 6 条**静态**页面，`crawlable` 与 `last_checked_at` 都是预置判断；② `site_channel_test`（`demo/handlers/site.ts`）**不联网**，逐字端出 `SEED_SITE_CHANNEL_PROBES` 的预置结论；③ `site_patch_generate` 从 `SEED_SITE_PATCH_POOL`（按处方分组的**字面量**池）逐字端出，不调模型、不跑合规扫描，产物一律 `draft` + `pending_review`；④ `publish` / `unpublish` / `rollback` 只翻状态 + 记事件 + 生成可下载文件，**线上站点一个字节都不会变**。界面四处常驻说明：`site.staticNote`（①②）、`site.generate.hint`（③）、`site.demoBody`（④）、`site.patches.published`（发布只是记账） | 规则 9（领域算法是 Rust 纯函数，demo 只呈现预置静态值）+ 规则 2（测试禁止联网）+ 规则 6。🔴 代价四条：① 自检结论与项目**无关**——任何项目点自检都得到同一句话，走查的是"自检这个动作在界面上长什么样"，**不是这条通道真的通不通**，所以 `staticNote` 必须常驻（否则产品负责人会拿演示结论去跟客户承诺上线时间）；② 生成池与台账按 `(action_id, kind, target_url)` **互斥**（`demo/seed.test.ts` 钉住），没进池子的处方生成回**空数组**、界面提示"没有可用的补丁模板"——真后端不存在这个空态，Plan C 接上模型之后这句提示要退役；③ 合规扫描在 demo 里**零覆盖**（与 E-53 ③ 同一条债）：池子里的字面量正文是人工写好的，绝对化用语那道闸门这一轮**没有对价**，Plan C 要连同"扫描不过 ⇒ 不许采用"这条分支一起补测；④ 「发布」在 demo 里是纯记账，所以 `site.patches.published` 那句刻意写成"已记为发布：线上生效要靠所选通道真的执行一次"——真后端接上第 1 条通道（P1 的 `edge`）之后这句话**必须重写**，别把它当成永久文案 |

## §4f M1.2 品牌实体卡瘦身与知识库那一轮新增的差异条目（E-58 … E-62）

> **增补日期**：2026-10-01 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：`2026-10-01-entity-card-slim-and-knowledge-base-design.md`（DR-59 … DR-72）
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-57 之后就是 E-58，不重号、不跳号。
>
> 🔴 **命令面先说清楚（与 E-33 / E-46 / E-52 / E-55 同族的"第 0 件事"）**：本轮新增的
> **7 条命令只有 demo 侧实现**——`api/client.ts` 的 `IPC_COMMANDS` 由 83 条扩到 **90**，
> `kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` / `kb_entry_detach` /
> `kb_entry_verify` / `kb_generate` 在 `demo/backend.ts` 都有真 handler（`demo/handlers/kb.ts`），
> 但 `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 里**一条都没有**，
> `crates/**` 里也没有 `KbEntry` / `KbModule` / `KbEntryKind` / `KbSource` / `KbSyncedBlock` 这些 DTO
> ⇒ 桌面端（`runtime === 'tauri'`）点进知识库会当场报 `ipc/unknown_command`。
> 「demo 独有命令」这一族的规模由 43 → **50**。裁定与前四轮逐字一致：**不屏蔽**（AGENTS 规则 8：
> 界面先收敛，契约由前端冻结后交后端）。与之相反，**两个导出出口一条新命令都没加**（DR-72）：
> Markdown 知识册与 JSON 知识包的文本都在前端组装（`api/kb-compose.ts`），落盘复用既有的
> `export_write_file`，预览弹窗复用既有的 `components/LibraryExportModal.tsx`。
>
> 🔴 **本轮还有一条与命令面无关、但更要紧的差异**：实体卡的字段面由 11 键收窄到 **7 键**（E-58），
> 而 Rust 侧的 `ALL_FIELDS` / `REQUIRED_FIELDS` / `completeness()` **一行未改** ⇒ 桌面端与 demo
> 现在**不是同一张卡**。前面四轮都是"多一个页面"（点进去报错，看得见），这一轮是**同一个页面在两端
> 显示不同的字段与不同的完整率**（看不见的分岐），Plan C 必须同批改 domain（见 E-58 / E-59 的代价）。
>
> **归类结论**（按 §1 的判据逐条过）：5 条里 2 条属于「demo 不许实现算法」（规则 9：E-58 的完整率、
> E-62 的生成与统计），2 条属于「Rust 侧还没有这个契约」（E-59 / E-60），1 条属于「demo 用**结构**
> 换掉了一套协议」（E-61 的读时投影）；**没有一条是缺陷**，5 条都带 Plan C 的落地义务。
>
> 🔴 **本节同样不给行号**（理由与 §4b … §4e 相同：改动未提交，钉行号等于钉在一个不存在的 commit 上），
> 引用一律用**路径 + 符号名**；例外是 Rust 侧那些**本轮一行未动**的真值源
> （`crates/geo-domain/src/entity_card.rs` 的 `ALL_FIELDS` / `REQUIRED_FIELDS` / `ProductSpec` /
> `EntityFields::completeness()`），按 G-5 给了行号。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-58 | `crates/geo-domain/src/entity_card.rs:27` 的 `ALL_FIELDS: [&str; 11]` 与 `:13` 的 `REQUIRED_FIELDS: [&str; 10]` 仍含 `price_range` / `cases` / `differentiators` / `official_tone`；`EntityFields`（`:111-131`，带 `#[serde(deny_unknown_fields)]`）仍是 11 个字段；完整率 `:198` 的 `completeness()` = 已填必填 / **10** | `api/types.ts` 的 `EntityFields` 收窄到 **7 键**（DR-59）：`price_range` 退出、报价并进 `products[].price`（E-59），`cases` / `differentiators` / `official_tone` 迁进知识库的 `case` / `differentiator` / `tone` 三个模块（种子里那几条 `source: 'imported'`，**不写迁移代码**）。`components/entity-fields.ts` 的 `ENTITY_FIELDS` 同步收窄 ⇒ 实体卡页只剩 **7 张**字段卡；`demo/handlers/entity-card.ts` 的 `ENTITY_ROOT_FIELDS` 白名单同步收窄，再收到 `price_range` 这类路径一律 `validation/failed` + `reason=unknown_field`（判据在 `demo/handlers/entity-card.test.ts`）。种子里的 `completeness` 写死 **0.86**（6/7，规则 9：demo 不自己算），与新字段面上"真算法会得到的值"自洽（`founded_year` 刻意留空） | 规则 8（demo 优先，界面先定稿）+ 规则 9（完整率是 `geo-domain` 的纯函数）。🔴 代价四条：① **两端不是同一张卡**：真后端 `entity_card_get` 回 11 键，前端类型只认 7 键，多出来的四键被 TS 静默忽略 ⇒ 桌面端上**已录入的案例 / 卖点 / 口径看不见但还在库里**（不是丢了，是没渲染）；② 反过来 demo 发 7 键给真后端**不会报错**（那四个键分别是 `Option` 与 `#[serde(default)]`）⇒「在桌面端保存一次实体卡就把 `cases` / `differentiators` / `official_tone` 清空」是**静默数据丢失**，Plan C 必须**先**做迁移（把三个字段的值搬进知识库）再收窄 domain，顺序反了就是删客户数据；③ 完整率的分母不同：真后端 6/10 = **0.6**、demo **0.86**，同一个项目在两端显示两个数 ⇒ Plan C 改 `REQUIRED_FIELDS` 时要连同 `filled_fields` / `is_filled` / `missing_fields` 与那条 Rust 契约测试一起改，改漏一处就是"完整率圈与缺失字段清单互相矛盾"；④ `entity.fields.price_range` / `.cases` / `.differentiators` / `.official_tone` 四个**标签键刻意留在词典里**（DR-62）：修订时间线要拿历史 `field_path` 查标签（老留痕里就有 `price_range`），删了键界面上就露裸记号 |
| E-59 | `crates/geo-domain/src/entity_card.rs:76-81` 的 `ProductSpec` 只有 `name` / `params` / `note` 三个字段，**没有** `price`；且这个结构体**没有** `deny_unknown_fields`（同文件里只有 `EntityFields:112` 有）⇒ 多出来的键被 serde **静默丢弃**、不报错 | `api/types.ts` 的 `ProductSpec` 多一个**可选** `price?: string | null`（DR-60：报价是**产品**的属性——一个厂家多款产品价格差一个量级，一个区间串既说不清也改不动）。实体卡页那张「产品与参数」字段卡按 JSON 原文编辑，报价就写在每个产品里；知识库的同步块把它拼成「报价：…」一行（`components/kb-view.ts` 的 `productBody`），`demo/seed/entity-cards.ts` 的两个产品各带一条报价口径 | 产品负责人本轮明确要求（需求第 2 条）。🔴 代价四条：① 桌面端把带 `price` 的产品清单发给真后端，`price` **静默消失**（比报错更坏：用户以为存上了，回读时才发现没了）⇒ Plan C 的 **P0** 是先给 domain 的 `ProductSpec` 加 `price`（含 `validate()` 的长度上限）再把前端的可选去掉；`products` 在库里是 JSON 文本列，加键按 `#[serde(default)]` 走就**不需要数据迁移**（老行读出来是 `None`），但 `deny_unknown_fields` 那一支要复核；② 报价从"一个顶层字段"变成"每个产品一格"⇒ `entity_card_update_field` 的**深层路径**（`products[0].price`）在 demo 里只校验 + 留痕、**不写回卡**（§B-2③：domain 的 `get_at` / `set_at` 不移植），界面上改报价是**整条产品清单一次写回**（顶层路径 `products`）；真后端接上之后要裁"到底支不支持深层写"——种子里那条修订留痕用的正是深层路径 `products[0].price`，两侧的口径必须一致，否则时间线上会出现一条"改了但没改"的留痕；③ 完整率**不含** `price`（它是产品对象里的键，不是顶层字段）⇒"有产品但一个报价都没填"在完整率上看不出来，Plan C 要裁报价算不算必填；④ `ProductSpec` 是前端唯一一处**有据偏离**后端 DTO 的地方（`api/types.ts` 的注释里点名了 E-59），复审时别把它当成"前端乱加字段" |
| E-60 | `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 里没有任何 `kb_*`；`crates/**` 里没有 `KbEntry` / `KbModule` / `KbEntryKind` / `KbSource` / `KbSyncedBlock` 这些 DTO，`geo-store` 的迁移里也没有知识条目这张表；`contracts/error-codes.json` 冻结（本轮**零新增**错误码） | 7 条命令 + `demo/handlers/kb.ts`；`api/types-kb.ts` 定义 **10 模块 / 6 形式 / 5 来源 / 2 源头**四个枚举与 `KbEntry` / `KbSyncedBlock` / `KbBoard` 三个 DTO；`api/kb.ts` 是唯一调用出口（组件不直接 `invoke`）。种子（`demo/seed/kb.ts`）是 12 条落库条目 + 10 行生成池，其中 4 条是"从实体卡迁出来"的 `source: 'imported'`。返回形状三种不一致是**刻意**的（board 回聚合、add/generate 回新增、update/detach 回单条、delete/verify 回快照），照 M1.5 与 M2 的既有契约 | 与 E-33 / E-46 / E-52 / E-55 同族（规则 8）。🔴 代价四条：① 桌面端点进知识库当场 `ipc/unknown_command`，「demo 独有命令」43 → **50**；② `kb_entry` 这张表与四个枚举在 Rust 侧**还没有真值源**，Plan C 要裁"知识条目是不是独立表、`origin_block_id` 怎么存"（见 E-61）；③ 新增的四个 `field` 记号（`kb_entry_id` / `kb_block_id` / `kb_title` / `kb_modules`）进了 `fields.*` 词典 ⇒ 真后端发这些 `params` 时键名必须**逐字**一致，否则界面上露机器记号（与 M3–M7 那一批同族）；④ 「引用进 Prompt 题库」**刻意不做**（DR-72 末段）：条目正文是"事实"、题库条目是"用户会怎么问"，两者不同构，硬映射会产出一堆不能用的题（M1.5 的关键词 / FAQ 才是题库的正确上游）⇒ 与 E-52 / E-54 那两个"复用既有命令"的出口不同，知识库的复用出口只有**导出**与 M6 内容生成的上下文（Plan C 裁定） | 🔴 **2026-11-04 部分转正**：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` / `kb_entry_verify` 已落 Rust（`geo-domain::kb` + 迁移 `20261104000004_kb.sql` + `KbRepo` / `KbService`）；`kb_generate` 仍 demo-only。命令面因此 50 → **55**、pending 55 → **50**。
| E-61 | 真后端要支持"跟着实体卡自动更新"，只有两条路：要么**存**一份同步块（就得有一套刷新协议 + 过期判定），要么在查询时 JOIN 投影。Rust 侧今天两样都没有（没有知识层这个实体） | 🔴 **同步块不落库**：`kb_board` 每次调用都由 `demo/handlers/kb.ts` 的 `projectSyncedBlocks()` 从 `entityCards` / `projects` / `competitors` / `assets` **现场投影**出 17 个块（DR-68 的逐字清单：实体卡 7 个字段 + 项目 6 类信息，数组字段**每个元素一块**，空值不投影），库里零字节 ⇒「基于实体卡信息变动而自动更新」是**结构性**成立的（没有第二份数据 ⇒ 不可能过期、不需要刷新协议、也没有"忘了同步"这个 bug 类；判据在 `demo/handlers/kb.test.ts`：改实体卡的产品报价 → 下一次 board 就是新值）。只有**副本**落库（`kb_entry_detach`，Notion 的 Unlink 同族），副本用 `stale_ids`（源头 `updated_at` 晚于副本 `verified_at ?? updated_at`）标过期；「重新同步」= 前端用 `components/kb-view.ts` 的 `composeSyncedRow` 按**当前**投影重算标题与正文，再走既有的 `kb_entry_update`（**不加命令**） | DR-67 的裁定（抄的是 Notion synced block / Confluence include 那一族成熟知识库的做法）。🔴 代价四条：① 真后端要复刻"不落库的投影"，就得在 `kb_board` 的查询里 JOIN 四张表并**逐字**照 DR-68 的清单（每个字段落哪个模块、算哪种素材形式）⇒ 那张清单是**契约**不是实现细节，Plan C 要把它抄成 Rust 侧的纯函数并配契约测试（漏一个字段就是"实体卡上有、知识库里没有"，而这种漏在 demo 里永远看不见）；② 投影里**一个界面标签都不许有**（规则 7）⇒ `KbSyncedBlock` 只装数据，"别名：""报价："这些词由前端查词典拼；真后端若图省事把拼好的中文字符串塞进 `value`，双语就废了；③ `stale` 判定在 demo 里只是**两个时间戳比大小**（规则 9 允许），真后端若要按"核实周期 + 变更历史"判定，那是 `geo-domain` 的纯函数，demo 不移植；④ 块的 `id` 由 `origin` + `field_path`（+ 下标）**纯函数派生**（`entity_card:products[0]`），副本的 `origin_block_id` 存的就是这个串 ⇒ 真后端要么沿用这条派生规则（那么"删掉第 1 个产品之后 `products[1]` 变成 `products[0]`，老副本会指到**另一个**产品上"这条**必须裁**），要么给同步块一个稳定主键。两种都行，但**不能一半一半** |
| E-62 | 知识成文要**按实体卡 + 模块调模型**并跑**合规扫描**（规则 6：生成内容默认 `PendingReview`、禁绝对化用语）；知识覆盖率 / 可信度评分是 `geo-domain` 的纯函数；图片 / 视频 / 文档要有**本地存储与缩略图**（`geo-store` 存文件）。Rust 侧今天四样都没有 | ① `kb_generate`（`demo/handlers/kb.ts`）**不调模型、不跑合规扫描**：从 `demo/seed/kb.ts` 的 `SEED_KB_GENERATED_POOL`（10 行，与初始库零重叠，由 `demo/seed.test.ts` 钉住）里按 `modules` 挑、跳过标题完全相同的、取前 `target_count` 条（`LIBRARY_GENERATE_MIN..MAX`，**复用**素材库那一档常量），挑不出来回**空数组**（不是错误）；产物一律 `source: 'generated'` + `status: 'pending_review'` + `verified_at: null`。② `KbStats` 七格只是**数数**（模块 / 条目 / 同步块 / 待审核 / 未核实 / 多媒体 / 待重新同步），没有覆盖率与评分。③ 媒体条目只存 `url` + `mime` **字面量**，不下载、不探测、不生成缩略图，界面上不出现 `<img>` / `<video>`。④ 全文搜索是前端 `includes`（标题 / 正文 / 标签），**不进命令契约**。界面四处常驻说明：`kb.demoHint`（页首）、`kb.generate.demoBody` + `kb.generate.complianceUnchecked`（生成弹窗）、`kb.entry.mediaNoPreview`（媒体条目） | 规则 9 + 规则 2 + 规则 6（与 E-52 / E-53 / E-57 同族，这是**第三次**登记同一批债）。🔴 代价四条：① 生成结果与**项目本身无关**（任何项目点生成都得到同一批字面量），走查的是产物形态（模块 / 形式 / 审核态），**不是知识质量** ⇒ 那两句免责说明必须常驻，否则产品负责人会拿演示数据评审"AI 写知识"的水平；② 合规扫描在 demo 里**零覆盖**（与 E-53 ③ / E-57 ③ 是同一条债）：池子里的字面量是人工写好的，绝对化用语那道闸门这一轮**没有对价**，Plan C 要连同"扫描不过 ⇒ 不许采用"这条分支一起补测，届时 `complianceUnchecked` 那句退役；③ 导出闸门（`api/kb-compose.ts` 的 `isExportable`：落库条目只收 `approved`、同步块排除 `disputed`）今天**由前端组装层持有**（判据在 `api/kb-compose.test.ts`），真后端若改成由命令产出知识包，闸门必须一起搬过去——搬漏了就是把**待审的知识喂给撰稿模型或贴到客户官网上**（与 E-53 ② 同形，规则 6 最坏的失败形态）；④ 因为项目来源的同步块**没有**审核态、始终可交付，"两个导出按钮都置灰"只在**一条可交付的都没有**时出现（新建项目还没填官网 / 行业 / 地域、也没有实体卡）——设计规格 §13 第 10 步的旧措辞（"把全部条目打回待审后就置灰"）**不准确，已同步改正** | 🔴 **2026-11-04 部分转正**：`kb_generate` 已落 Rust（按实体卡 + 模块调模型，产物 `generated` + `pending_review`，标题等值去重，命中广告法红线词整批拒绝）。媒体文件本地存储 / 缩略图、知识覆盖率与可信度评分仍**未落**。

## §4g 知识库重构（M1.2b）与文章管理 Article Studio（M6）那一轮新增的差异条目（E-63 … E-66）

> **增补日期**：2026-10-10 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：
> `2026-10-10-kb-redesign-and-article-studio-design.md`（DR-73 … DR-89）· **市场调研**：
> `2026-10-10-kb-and-article-studio-ux-survey.md`（Guru / Notion / Confluence / Slite / Document360 /
> Highspot / Seismic / Klue / Intercom / Help Scout / Jasper / Copy.ai / HubSpot，37 条来源链接）
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-62 之后就是 E-63，不重号、不跳号。
>
> 🔴 **命令面先说清楚（与 E-33 / E-46 / E-52 / E-55 / E-58 同族的"第 0 件事"），本轮是历轮里
> 第一次**有增有减**：
> - **减一条**：`kb_entry_detach` 随同步块整体退役而删除（DR-73），kb 族 7 → **6**；
> - **加十条**：`article_direction_list` / `article_direction_add` / `article_direction_generate` /
>   `article_template_list` / `article_template_save` / `article_template_delete` /
>   `article_schedule_list` / `article_schedule_save` / `article_schedule_run` / `article_list`
>   只有 demo 侧实现（`demo/handlers/article.ts`）。
>
> ⇒ `api/client.ts` 的 `IPC_COMMANDS` 由 90 → **99**，「demo 独有命令」这一族由 50 → **59**。
> `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` 里这十条**一条都没有**，
> `crates/**` 里也没有 `Article` / `ArticleDirection` / `ArticleTemplate` / `ArticleSchedule` /
> `ArticleSlot` / `ArticleFreq` 这些 DTO ⇒ 桌面端（`runtime === 'tauri'`）点进「文章管理」会当场报
> `ipc/unknown_command`。裁定与前五轮逐字一致：**不屏蔽**（AGENTS 规则 8：界面先收敛，
> 契约由前端冻结后交后端）。与之相反，**导出出口一条新命令都没加**（DR-89）：文章的 Markdown
> 导出在前端组装（`api/article-compose.ts`），落盘复用既有的 `export_write_file`，
> 预览复用既有的 `components/LibraryExportModal.tsx`；知识库那两个导出出口同样一条没加（DR-72 延续）。
>
> 🔴 **设计规格原先写的"90 → 100 / 族 50 → 60"（该文 §4 DR-87 与 §5 E-64）是错的**：
> 它漏算了同一轮里 kb 族自己减掉的那一条。正确口径是 **99 条命令 / demo 独有族 59 条**，
> 规格已按本节改正（见该文 §8 的回填记录）。
>
> 🔴 **本轮还作废了上一轮的一条差异**：**E-61 整条作废**。E-61 说的是"同步块是**读时投影**、
> 不落库 ⇒ 不可能过期，所以『基于实体卡信息变动而自动更新』是结构性成立的"；用户 2026-10-10 的
> 指示是"知识库不需要与实体卡相同的内容模块卡片"，而投影出来的正是那批重复卡片 ⇒ 同步块整体退役
> （DR-73），取而代之的是**一次性显式导入**（DR-81），它**不跟随**源头变化。于是"自动更新"这个能力
> 在 demo 里是**消失了**，不是换了实现。E-61 的原文按 §7 的纪律**保留不改**，由本节这条声明作废；
> 它对 Plan C 的那四条义务里，①（复刻投影 JOIN）与 ④（块 id 的派生规则）**一并免除**，
> ②（投影里不许有界面标签）搬进 E-63 的导入映射表，③（`stale` 判定是 `geo-domain` 的纯函数）
> 随 `stale_ids` 一起消失。
>
> **归类结论**（按 §1 的判据逐条过）：4 条里 1 条属于「demo 用**结构**换掉了一套协议」
> （E-63：同步块退役 + 命令面减一条），1 条属于「Rust 侧还没有这个契约」（E-64），
> 2 条属于「demo 不许实现算法 / 不许有运行时副作用」（规则 9：E-65 的调度引擎、
> E-66 的生成与合规扫描）；**没有一条是缺陷**，4 条都带 Plan C 的落地义务。
>
> 🔴 **本节同样不给行号**（理由与 §4b … §4f 相同：改动未提交，钉行号等于钉在一个不存在的 commit 上）；
> 例外是 Rust 侧那些**本轮一行未动**的真值源（`crates/geo-domain/src/entity_card.rs` 的 `ALL_FIELDS` /
> `REQUIRED_FIELDS` / `EntityFields::completeness()`），按 G-5 给了行号。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-63 | Rust 侧本就没有任何 kb 命令与 DTO（E-60 的口径延续：`generate_handler![]` 里零条、`crates/**` 里没有 `KbEntry`）。真后端若要落上一轮那份契约，模块枚举是 **10** 档（含 `service` 与 `differentiator`），`KbEntry` 带 `origin` / `origin_block_id` / `field_path`，`kb_board` 要现场 JOIN 实体卡与项目四张表做**读时投影**（E-61），并派生 `entity_card:products[0]` 这种块 id | 同步块**整体退役**（DR-73）：`kb_board` 的返回删掉 `synced` / `stale_ids` / `entity_card_updated_at`；`KbStats` 七格 → **六格**（删 `synced` / `stale`，增 `scripts`）；`KbEntry` 删 `origin` / `origin_block_id` / `field_path`、增 `scenario`；`KbSyncedBlock` / `KbOrigin` 两个类型删除；**命令 `kb_entry_detach` 删除**（kb 族 7 → 6）；`components/kb-view.ts` 删 `composeSyncedRow` / `findSyncedBlock` / `syncedLabelKey`，`toKbRows` 只吃 entries。模块枚举 10 → **11**（DR-74：删 `service`、`differentiator` 改名 `selling_point`、新增 `sales_script` / `support_script`）+ **场景** 10 档（DR-75，只对两个话术模块有意义，handler 对其余模块**强制置 null**、不报错）。绿色同步横幅换成**常驻职责说明条** `kb.dutyNote` +「从实体卡导入」（DR-81：走既有 `kb_entry_add`，draft 带 `source:'imported'`，**不新增命令**）。守卫同步退役：`i18n/no-hardcoded-strings.test.ts` 的 B-4「同步块投影标签键集」那段（3 例）删除、`demo/seed.test.ts` 的 `SYNCED_BLOCK_ID` 例外形状表删除、`pages/en-us-page-residual.test.tsx` 里"同步块只读说明"那句点名扫描换成职责说明条 | 用户指示 2026-10-10（"不需要实体卡相同的内容模块卡片"）⇒ DR-66 / DR-67 / DR-68 作废。🔴 代价四条：① **E-61 整条作废**（见本节抬头），"基于实体卡变动自动更新"这个能力在 demo 里**消失**，界面由 `kb.dutyNote` 常驻告知"两侧不互相同步、导入是一次性复制"——这句说明**必须**常驻，否则用户会以为改一处另一处跟着变；② Plan C 的义务从"复刻投影 JOIN + 块 id 派生"换成"复刻**导入映射表**"：实体卡 7 字段 + 项目的 竞品 / 资产 / 行业 / 地域 / 标签 → 各落哪个模块、算哪种素材形式、`field_status: official` → `approved` 其余 → `pending_review`（项目来源一律 `pending_review`）。那张表在 `components/kb-import.ts`（**前端**组装，因为标签词语言相关，与 `kb-view.ts` 同一条裁定），真后端若把导入做成命令，必须连标签的**双语拼装**一起搬，否则规则 7 破（判据在 `components/kb-import.test.ts`，zh + en 两侧都钉）；③ **不 dedup**：同一个字段可以被导入两次得到两条知识（去重率是 `geo-domain` 的纯函数、规则 9 不许 demo 实现），真后端要么给唯一约束、要么给用户一个合并入口，demo 里只在 Modal 上写明"一次性复制、不跟随"；④ 模块枚举**改名 + 删档**是数据面 breaking：真后端落库要有 `differentiator` → `selling_point` 的迁移与 `service` 的归并，而 demo 是靠**种子重写**规避的（`SEED_KB_ENTRIES` 25 行全部按 v2 写，**没有一行迁移代码**）⇒ Plan C 不能照抄 demo 的"没有存量"这个前提 |
| E-64 | Rust 侧零文章相关的命令与 DTO；真后端要落 M6 内容生产，需要 `Article` / `ArticleDirection` / `ArticleTemplate` / `ArticleSchedule` 四张表 + 槽位注入（六档：`brand` / `product` / `keyword` / `audience` / `scenario` / `competitor`）+ 调 `geo-llm` + 合规扫描（规则 6）+ 一张运行历史表 | **10 条命令只有 demo 侧实现**（方向 / 模板 6 条在 `demo/handlers/article.ts`、排期与文章 4 条在 `demo/handlers/article-schedule.ts`，照 `site.ts` / `site-patch.ts` 的同款拆分守住单文件 400 行），`IPC_COMMANDS` 90 → **99**、demo 独有族 50 → **59**。对象模型在 `api/types-article.ts`（`ARTICLE_SLOT_VALUES` 六档 + `AssertComplete<ValuesAreComplete<…>>` 编译期完整性网，照 `types-library.ts` / `types-site.ts` 的既有形状）；页面 `pages/ArticleStudioPage.tsx` 是三工作区（方向 / 模板 / 排期与文章，DR-86）；导航二级项 `articles` 排在**行动中心之后、站点接入之前**（DR-83）。槽位替换只在**模板预览**里用项目真实值现算（前端），生成路径**不做真拼接注入**（DR-89：`bindings.product_names` / `bindings.keyword_texts` / `kb_modules` 都**只记录不拼接**，界面上以 chips 回显）。🔴 命令面刻意收在 10 条 ⇒ **没有 `article_update`、也没有 `direction_update`**：文章评审的通过 / 打回寄生在 `article_list` 上（先改后回快照），方向归档寄生在 `article_direction_add` 上（带 id 即就地改状态），判据在 `demo/handlers/article.test.ts` | 规则 8 + 规则 9。🔴 代价五条：① 桌面端点进「文章管理」当场 `ipc/unknown_command`（与前五轮同族，不屏蔽）；② **"只记录不拼接"是本轮最容易被误读的一条**：模板预览会把槽位换成项目真值，看起来像"注入生效了"，但真生成走的是预置语料池（E-66），两者**不是同一条路径** ⇒ Plan C 必须把"预览的替换"与"生成的注入"统一成**同一个** `geo-domain` 纯函数，否则用户预览到的与生成出来的会不一致，而这种不一致在 demo 里**结构性看不见**；③ `bindings.keyword_texts` 存的是**词面快照**而不是关键词 id（真后端应当存 id 才能跟随词库改名），demo 取快照是因为它不跟随（规则 9），Plan C 要显式裁定"跟不跟随"并登记；④ **读命令带写副作用**（`article_list` / `article_direction_add` 那两条寄生写路径）是 demo 为守住"10 条命令面"取的**临时形状**，真后端**不应照抄**：它破坏 `list` 的幂等假设、也让"查一次列表"变成可写操作，Plan C 要显式加 `article_update` / `article_direction_update` 并把这两条登记成契约债；⑤ 导出复用 `export_write_file`（DR-89），一条新命令都没加 |
| E-65 | 真后端的定时生成要有**任务调度器**（cron / 后台队列）+ 到点调模型 + 失败重试 + 运行历史与告警，落在 `apps/desktop/src-tauri` 的后台任务与 `geo-store`；`next_run_at` 要按用户时区算 | **没有真 cron、也没有任何定时器**（DR-85）：`ArticleSchedule.next_run_at` 是 `demo/handlers/article.ts` 里一个**纯函数**按 `freq`（`daily` / `weekly`）+ `time`（`HH:mm`）+ `weekday`（周更必填、日更强制 `null`）相对**演示月份 2026-09** 算出来的；`enabled === false` 时 `next_run_at` 一律 `null`（关掉开关即清空、再打开重算，判据在 `demo/handlers/article.test.ts`）。到点**不**自动跑。「立即运行一次」（`article_schedule_run`）是**替身**：从预置文章池按标题去重取一篇挂到该排期上（`source: 'scheduled'`、`status: 'pending_review'`）、记 `last_run_at` 与 `run_count + 1`、把 `next_run_at` 按同一套纯函数往前推一格；池子跑空之后回**空数组**（不再新增、也不再记账）；停用的排期也能手动跑一次且**不改** `enabled`；模板「立即生成」走同一支但 `source: 'manual'` / `schedule_id: null` 且**不动**排期的账。刷新（`resetDemoDb()`）即全部回种子。界面常驻说明"演示模式不跑真实定时任务" | 规则 9（调度是运行时副作用，不是可预置的静态值）+ 规则 2（测试禁止真等待）。🔴 代价四条：① `next_run_at` 那套推进算法在 demo 里是纯函数，真后端要**复用同一套口径**（含"weekly 缺 `weekday`"、"`time` 跨月 / 跨年边界"、"`enabled === false` 时不推"这三个分支），否则两端显示的"下次运行"对不上，而这种分歧在 demo 里看不出来；② 到点不跑 ⇒ 走查只能验"配置面长什么样 + 手动跑一次的产物形态"，**验不了**"每天早上 8 点真的出一篇"，产品负责人评审时必须知道这一条；③ 没有失败重试、没有运行历史（`run_count` 是唯一痕迹），真后端的可观测性（哪次跑失败了、为什么、要不要告警）在 demo 里**零覆盖**，Plan C 要连 `ArticleRun` 这张表一起设计，并裁定"跑失败算不算 `run_count`"；④ 演示月份钉死在 2026-09（`demo/seed.test.ts` 的 `FIXED_SEED_WINDOW`）⇒ 界面上的"下次运行"永远是一个**过去**的时间点。这不是缺陷，是"刷新即重置"的口径，但那句常驻说明**必须**在，否则会被当成"定时器坏了" |
| E-66 | 文章生成要**按模板 + 绑定对象调模型**并跑**合规扫描**（规则 6：禁绝对化用语、生成内容默认 `PendingReview`）；字数统计 / 与既有内容的去重率 / 可读性评分是 `geo-domain` 的纯函数；产物要有版本与 diff（AI 修订走 accept / dismiss） | `article_schedule_run` 与模板「立即生成」**不调模型、不跑合规扫描**：从 `demo/seed/articles.ts` 的预置文章池按**标题去重**取一篇，一律 `status: 'pending_review'` 并挂「演示模式未执行合规扫描」标签；`word_count` 是种子写死的字面量（不是真数出来的）；`article_direction_generate`（AI 生成方向）同样从预置池取、条数被夹进 `LIBRARY_GENERATE_MIN..MAX`（**复用** M1.5 那一档常量）、池子用完回空数组。评审队列（状态筛选 / 批量通过 / 打回 / 预览 Drawer）是真的写路径，但寄生在 `article_list` 上（见 E-64 ④）。导出 Markdown 在前端组装（`api/article-compose.ts`，**只收 `approved`**）+ 既有 `export_write_file` | 规则 9 + 规则 2 + 规则 6（与 E-52 / E-53 / E-57 / E-62 同族，这是**第四次**登记同一批债）。🔴 代价四条：① 生成结果与**项目 / 模板 / 槽位全都无关**（任何项目点生成都得到同一批字面量），走查的是产物形态（评审态 / 绑定回显 / 导出闸门），**不是文章质量** ⇒ 那两句免责说明必须常驻，否则产品负责人会拿演示语料评审"AI 写文章"的水平；② 合规扫描在 demo 里**零覆盖**（与 E-53 ③ / E-57 ③ / E-62 ② 是同一条债）：池子里的字面量是人工写好的，绝对化用语那道闸门这一轮**同样没有对价**，Plan C 要连同"扫描不过 ⇒ 不许采用、不许导出"这条分支一起补测，届时那句 `complianceUnchecked` 退役；③ 导出闸门（`api/article-compose.ts` 的 `isExportable`：只收 `approved`）今天**由前端组装层持有**（判据在 `api/article-compose.test.ts`），真后端若改成由命令产出文章包，闸门必须一起搬过去——搬漏了就是把**待审的文章**发给客户或贴上官网（规则 6 最坏的失败形态，与 E-53 ② / E-62 ③ 同形）；④ 规则 6 里"生成内容默认 `PendingReview`"这一半在 demo 里是**真做的**（判据：跑一次之后没有任何一篇直接是 `approved`），所以 Plan C 不能把这条也当成"演示替身"一起重写——它是本轮**唯一**一条真落地的合规义务 |

## §4h 站长数据接入（M5.5）与知识库修订留痕（DR-119）那一轮新增的差异条目（E-67 … E-72）

> **增补日期**：2026-10-13 · **分支**：`feat/settings-redesign-demo-i18n`（**尚未提交**）· **设计规格**：
> `2026-10-12-webmaster-data-integration-design.md`（DR-90 … DR-119，其中 §8 是本节的预备稿）
>
> **编号说明**：按 §1 的纪律从本文自身末尾续号——E-66 之后就是 E-67，不重号、不跳号。
>
> 🔴 **命令面先说清楚（与 E-33 / E-46 / E-52 / E-55 / E-58 / E-63 同族的"第 0 件事"）**：
> 本轮**只增不减**，加六条：`search_board` / `search_source_upsert` / `search_source_remove` /
> `search_source_test` / `search_metric_import_csv` / `search_opportunity_update`，
> 只有 demo 侧实现（`demo/handlers/search.ts` + `demo/handlers/search-import.ts`，拆两个文件守 400 行上限）。
>
> ⇒ `api/client.ts` 的 `IPC_COMMANDS` 由 99 → **105**，「demo 独有命令」这一族由 59 → **65**。
> `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]` **仍是 40 条、一条未加**，
> `crates/**` 里也没有 `SearchSource` / `SearchQueryMetric` / `SearchAiOverview` / `SearchOpportunity`
> 这些 DTO ⇒ 桌面端（`runtime === 'tauri'`）点进「站长数据」会当场报 `ipc/unknown_command`。
> 裁定与前六轮逐字一致：**不屏蔽**（AGENTS 规则 8：界面先收敛，契约由前端冻结后交后端）。
>
> 🔴 **DR-119（知识库修订留痕）命令面不加**：逐字段留痕寄生在既有 `kb_entry_update` 的写路径上、
> 读出口寄生在既有 `kb_board` 的返回体里（多一个 `revisions` 字段），**没有新增任何命令**。
> 它对应的差异**不另立编号**：Rust 侧零 kb 命令与 DTO 已由 E-60 / E-63 登记，本节只在 E-67 的
> 归类结论里点一句"同一轮的另一个切片继承 E-60 / E-63"。
>
> 🔴 **本轮唯一的运行时依赖新增**：`apps/desktop/ui/package.json` 加了 `fflate`（解压 xlsx 用），
> 理由与保守备选见规格 DR-98；它带来一条**新的双解析器债**，登记为 E-72。
>
> **归类结论**（按 §1 的判据逐条过）：6 条里 1 条属于「Rust 侧还没有这个契约」（E-67）、
> 1 条属于「demo 不许实现算法」（规则 9：E-68 的 6 条机会规则）、
> 1 条属于「demo 不许有运行时副作用 / 不碰密钥」（规则 3：E-69）、
> 1 条是**裁定反转后的口径变更**（E-70：真后端也要做分层归一，与原草案相反）、
> 1 条属于「测试禁止联网」（规则 2：E-71 的可达性自检）、
> 1 条属于「同一格式将来有两份解析器」（E-72，与 E-67 ③ / `api/constants.ts` ↔ `csv_io.rs` 同族）；
> **没有一条是缺陷**，6 条都带 Plan C 的落地义务。
>
> 🔴 **本节同样不给行号**（理由与 §4b … §4g 相同：改动未提交，钉行号等于钉在一个不存在的 commit 上）；
> 例外是 Rust 侧那些**本轮一行未动**的真值源，按 G-5 给了行号：
> `apps/desktop/src-tauri/src/ipc/mod.rs` 的 `generate_handler![]`（**40 条**，本轮一条未加）、
> `apps/desktop/src-tauri/src/services/settings_service.rs:23` 的 `SECRET_KIND = "llm"` 与 `:270` 的
> `parse_provider`（只认 `LlmProvider`）、`crates/geo-store/src/secret.rs:35` 的 `parse_secret_ref`
> （只吃 `keyring://<kind>/<name>` 两段）。
>
> 🔴 **集成期补的一处契约修订（照实登记，不藏在"已落地"三个字里）**：三个切片并行落地之后，
> 走查第 5 条（接入建议条的分布数字来自种子）**首轮验不过**——`SearchBoardResult` 里没有流量分布
> 字段，`SEED_SEARCH_TRAFFIC_SPLIT` 因此没有落点，页面只能渲染 `onboarding.empty` 空态。
> 集成期按 DR-111 补齐三处：① `SearchTrafficEngine` / `SEARCH_TRAFFIC_ENGINE_VALUES` /
> `SearchTrafficShare` 从 `api/search-compose.ts` **搬进契约** `api/types-search.ts`
> （它们是 `traffic_split` 的行形状 ⇒ 属于数据；`suggestSources` 这个**函数**留在 compose，
> 原地回导出 ⇒ 既有 import 路径一条没改）；② `SearchBoardResult` 加 `traffic_split`；
> ③ demo 侧加**第七张只读表** `searchTrafficSplit`（行形状 = 契约 + `project_id`，访问器
> `searchTrafficSplitOf` 剥掉 `project_id` 再端出去）。
> 🔴 进库而不留在 `seed/**` 的理由与 `selfIndexSnapshots` 同一条：`search_board` 要按项目端出
> **这个站点**的分布，于是归档项目自然回**空数组** ⇒ 界面显示空态而不是替它编一份通用推荐
> （DR-111 的硬裁定）。真后端这一格由 `analytics` 组的**来源分析**算出，**不是**常量。
> 🔴 判据两侧都补了（TDD 先红后绿）：`demo/handlers/search.test.ts` 钉"端出种子那三项 + 是深拷 +
> 归档项目回空"，`pages/WebmasterDataPage.test.tsx` 钉"62% / 21% / 17% 与三个平台名逐项上屏、
> 且分布为空时一个百分号都不许出现"。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-67 | Rust 侧零 `search_*` 命令与 DTO；真后端要落需要五张表 + 三个 OAuth 客户端 + 三份 CSV 解析 + 令牌刷新与配额退避 + **映射表与目录表的 Rust 版**（§6 全清单） | **6 条命令只有 demo 侧实现**（`demo/handlers/search.ts` + `search-import.ts`），`IPC_COMMANDS` 99 → **105**、demo 独有族 59 → **65**，Rust 侧仍 40 条；🔴 但**归一 / 求和 / 重算 / 筛选 / 区间收敛在前端 compose 层真做**（DR-99），demo 与桌面端将来共用同一份 | 规则 8。🔴 代价四条：① 桌面端点进「站长数据」当场 `ipc/unknown_command`，**不屏蔽**（与前六轮同族）；② **OAuth 一条都没实现**（连假授权流程都没有），demo 能走查的只有导入 / 填报 / 汇总 / 筛选 / 机会处置五件事；③ 🔴 **映射表与目录表将来会有两份**（TS 与 Rust），口径漂移的风险与 `api/constants.ts` ↔ `csv_io.rs` 同族，Plan C 必须把"改一处同步另一处"写成判据；④ `search_board` 不分页（DR-97 ⚠），明细上万行时前端要扛，真后端必须改形态 | 🔴 **2026-11-04 部分转正**：`search_board` / `search_source_upsert` / `search_source_remove` / `search_opportunity_update` 已落 Rust（`geo-domain::search` + `search_opportunity` + 迁移 `20261104000007_search_sources_opportunities.sql` + `SearchRepo` / `SearchService`）。源目录、绑定推导、凭证引用串已落地；🔴 **2026-11-04 再转正 `search_source_test`**：可探测源真发一次 HTTP GET，OAuth 源只报缺少授权，人工源不需探测；`check_detail` 已改为结构化 `{ code, params }`（前端 `checkDetails.<code>` 词典渲染）。🔴 **2026-11-05 转正 `search_metric_import_csv`（A2a）**：只承诺百度《AI 流量分析》五列与规范列名；TS / Rust 双解析器对拍、其它源映射表仍待后续切片。`search_board` 的指标 / AI 汇总 / C 类留档 / 自建索引 / 流量分布暂返回空值。命令面 65 → **71**、pending 40 → **34**。
| E-68 | 6 条规则是 `geo-domain` 纯函数（阈值常量、可单测、可复算），机会由规则算出并与既有处方去重排序 | `SEED_SEARCH_OPPORTUNITIES` **手工写死 6 条**（每规则一条），翻状态不重算、**导入 CSV 也不会长出新机会**；🔴 但**汇总数字会随导入真变**（DR-99）⇒ 这一页是"一半真一半假" | 规则 9 + 规则 2。🔴 代价四条：① 走查验的是"一条机会长什么样 + 采纳/忽略状态机 + 三个跳转入口"，**验不了**"规则判定准不准"；② 规则 2/4/5 依赖 `geo-crawler` 的真实页面清单与 robots 解析，而 demo 那份是 `SEED_SITE_PAGES` 静态值 ⇒ 这三条规则在 demo 里**结构性不可能真判定**；③ `confidence` 是种子写死的，与 M4 那道 `REVIEW_CONFIDENCE_FLOOR` 门槛的**真实计算**无关；④ 🔴 **"汇总真变、机会不变"这个不对称最容易被误读**成"分析坏了"，`webmasterData.staticNote` 必须把这句话写进去 |
| E-69 | OAuth 令牌是账号级长期凭据，需要 `SECRET_KIND` 放开到 `search`、`parse_provider` 不再只认 `LlmProvider`、refresh_token 轮转、"令牌过期"的稳定错误码 | `secret_ref` 只是个字符串（`keyring://search/<kind>`），演示模式**不写系统钥匙串**（`components/SecretStatus.tsx` 那句提示已在） | 规则 3。🔴 本轮**刻意用两段引用串**（DR-96），与 **E-56** 那个三段串 `keyring://site/<kind>/<project_id>`（`parse_secret_ref` 会返回 `None`）**方向相反**：本轮的结论反过来给 E-56 指了一条正解——**凭据账号级 + 绑定项目级**，Plan C 处理 E-56 时应当一并裁定 |
| E-70 | 🔴 **本条 2026-10-12 反转**（原草案写的是"真后端也不应做跨源归一"）。修订后：真后端**应当**做分层归一（A 类可加 / B 类重算 / C 类独有），但**同样不得**跨量纲相加、不得对比率取平均、不得静默截断区间 | 归一在**前端 compose 层真做**（DR-95 / DR-107 / DR-109 / DR-110），合计行常驻区间 + 参与源清单 + 完整性旗标 | §3.7 结论 4 + 产品负责人裁定 3。🔴 反转理由照录在 DR-95"我错在哪"：原裁定把"术语能否统一"与"数值能否相加"混成一件事，用后者的风险否决了前者。代价三条：① 归一逻辑将来要在 TS 与 Rust 各有一份（同 E-67 ③）；② **映射表版本化**是硬义务——百度《AI 流量分析》至今无字段文档，平台改口径而我们没记版本，历史数字就无法解释；③ 合计数字一旦被追问，要能当场摊开"哪几个源、各自截至哪天、谁被采样了"——**给数字同时给得出账**，否则比不给更糟 |
| E-71 | 真后端的请求从用户本机发出（桌面端天然如此），可达性取决于客户网络 | 自检返回静态结论，**永不联网**；海外组带一句可达性常驻提示 | 规则 2 + DR-104。🔴 代价：GSC / Bing 这两条出海线在 demo 里**完全验不了**（连"授权成功长什么样"都只能靠 `status` 的静态值演），产品负责人评审时必须知道海外那两个源在 demo 里是**纸面设计**；且 🔴 Google 的 **sensitive scope 应用验证是周级流程**（DR-93），材料没递出去之前，桌面端接 GSC 会给客户看"未验证应用"红页 |
| E-72 | 真后端用 `calamine` 解析百度官方 xlsx 导出（Rust） | demo 用 `fflate` + 最小 reader 解析**同一格式**（TS，`api/search-xlsx.ts`） | DR-98 实测追加（2026-10-12 官方导出只有 xlsx）。🔴 代价三条：① xlsx 解析器将来有 TS / Rust 两份（同 E-67 ③ 族），判据要钉"**同一 fixture 两边解析结果逐格相同**"；② 最小 reader 只承诺百度这一种导出形态（`Sheet1` + inlineStr/sharedStrings），**GSC / Bing 的导出不在其范围内**（它们走 API 或 CSV）；③ 平台改导出结构（加列 / 改 sheet 名）时 demo 会静默认错列 ⇒ 判据必须钉"未知 sheet 名 / 缺表头列都报错而不是猜" |

## §4i 项目概览首页（2026-10-29）

> 本轮**命令面零新增**（`IPC_COMMANDS` 保持 **105**）：首页用 6 个既有命令并行取数，
> 选轮 / 环比 / 风险排序 / 组合分布全部在前端纯函数层
> （`api/overview-compose.ts` + `api/portfolio-compose.ts`）。设计见
> `docs/superpowers/specs/2026-10-29-project-overview-home-design.md`。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-73 | Rust 侧没有 `project_overview` / `portfolio_overview` 命令，也没有采集 / 诊断 / 核查 / 行动的读接口（`generate_handler![]` 仍 40 条）；真后端若落聚合，需要复用同一份「有结论轮次 / 环比 / 风险排序 / 组合分布」口径，并保证 M9 组合不对比率取平均 | 首页由 `project_get` + `collection_board` + `diagnosis_overview`（当前轮 + 上一轮）+ `diagnosis_competitors` + `fact_check_list`×N + `insight_list`×N + `action_board` 并行组装；P1 再取 `diagnosis_engines` / `search_board` / `article_list` / `site_board`；M9 组合页按项目 N+1 取 `collection_board` + `diagnosis_overview`；`lib` 侧零改动；`api/overview-compose.ts` 与 `api/portfolio-compose.ts` 有 23 条纯函数单测（含分布 / 筛选 / 排序） | 规则 8 + DR-97 ④。🔴 代价四条：① 桌面端点进首页，除项目名外各区块都会 `ipc/unknown_command`，**不屏蔽**，逐卡显示错误码（轮次清单失败也不整页红屏，保留导航与项目级待办）；② 选轮与环比在前端，真后端若也提供聚合命令必须同口径，否则同一个项目两个数；③ 首页对每个有结论轮次各查一次核查与复核队列，轮次多时是 N+1（demo 只有 3 轮；真后端应由一个聚合接口收敛）；④ 🔴 **M9 组合页已落 demo（`/portfolio`）但仍按项目 N+1 取数**（每项目 `collection_board` + `diagnosis_overview`）：真后端必须提供一个 `portfolio_overview` 聚合接口，返回「每个项目的最近结论轮次 + 四个指标 + 未读告警计数」，否则项目一多就会放大成 N 次 IPC；组合层的分布 / 筛选口径已在 `api/portfolio-compose.ts` 钉住 |

## §4j demo 全面功能走查与 P1/P2 修复（2026-11-03）

> 本轮**命令面零新增、零删除**（`IPC_COMMANDS` 保持 **105 = 40 条 Rust + 65 条 demo-only**），
> 修复集中在 demo handler、前端 compose 与导出契约；Rust 侧一行未改。
> 🔴 本节同样只给路径与符号名、不给行号（改动尚未提交，钉行号等于钉在一个不存在的 commit 上）。

| 编号 | 后端行为（真值源） | demo 行为 | 理由与代价 |
|---|---|---|---|
| E-74 | `project_export` 的 Rust DTO `ProjectExport` 只覆盖 **M1/M2 档案**（项目、实体卡、竞品、资产、题库），且带 `deny_unknown_fields`；知识库 / 采集轮次 / 诊断 / 站点 / 站长数据**不在**该 DTO 内 | demo 侧 `project_export` 走同一 DTO 形状；本轮把 UI 从「项目 JSON（全量）」改为「项目 JSON（M1/M2 档案）」，提示语显式列出实际范围（`i18n/locales/{zh-CN,en-US}/project.ts`，断言在 `pages/ProjectListPage.test.tsx`） | 规则 8。🔴 代价两条：① 用户若想备份知识库 / 采集 / 站点 / 站长数据，**当前没有任何一个导出包含它们**；Plan C 若要补，必须新增独立导出格式（如 `geo-project-archive-v2`）并单独写导入器，**不能**往 v1 DTO 里塞字段——`deny_unknown_fields` 会让旧桌面端直接拒收整个文件；② demo 与桌面端共用同一文案，所以本轮只改措辞、不改 DTO，跨端导入形状保持可互换 |
| E-75 | 真后端可能出现「轮次 `succeeded` / `partial`，但诊断未完成或失败」（`diagnosis_overview` 回 `null`）。M9 的 `portfolio_overview` 应把这个项目标成**第三态「有轮次 · 待分析」**，并排除出指标分布 | demo 里所有有结论轮次都配了 `SEED_DIAGNOSIS_OVERVIEWS`，这一态**不可达**；`buildProjectSnapshot` 在 `overview === null` 时把 `round` 压成 `null`，组合页因此把它归入「待采集」 | 规则 8 / 规则 9。🔴 代价三条：① demo 走查看不到「有轮次、无诊断」，评审时容易把「待采集」当成唯一空态；② 真后端这态不罕见（诊断任务可单独失败 / 重跑），若沿用现在的映射，「哪些客户有结论」的入口会给出错误答案；③ 本轮**不改** `ProjectOverviewSnapshot` 的形状（会让 M9 口径与页面状态机一起变），留到 `portfolio_overview` 落地时一次性补三态。✅ 现在已经安全的部分：`overview === null` 时**不进指标分布、不算有结论、不显示 0 分**（`api/portfolio-compose.ts` 的 `hasConclusion`） |

## §5 后端待办（**Rust 只读**，demo 侧不改；由镜像过程反推出来）

1. 🔴 **`tags LIKE '%"<json(tag)>"%'` 是对序列化文本做子串匹配**（`crates/geo-store/src/repo/project.rs:146-153`，
   注释在 `:147-148`），于是标签 `,` 会借元素之间的 `","` 命中**任何有 ≥2 个标签的项目**；
   另有 ASCII 大小写不敏感（`:138` 注释「LIKE 对 ASCII 大小写不敏感，中文按原样匹配」）带来的 4 处宽匹配。
   实测「精确成员判定 vs LIKE 子串」共 **6 处**分岐，demo 已**全部忠实镜像**（`shared.ts:61-99`，
   判据 `project.test.ts:212`/`:230`/`:245`）。**建议后端改用 `json_each` 做精确成员匹配。**
   ⚠ 影响面**用户可感知**：「我筛 `,` 怎么全出来了」。demo 忠实复现这个缺陷**既是好事**（不可区分）
   **也是坏事**（用户在 demo 里看到的就是缺陷本身）。
2. **`ProviderInfo.label_zh` 仍留在契约里，但 UI 已不读**（15c-1 的收口副产品）。
   删它要连带改 demo 种子、`src/test/fixtures.ts` 与多条命令的返回契约 ⇒
   建议作为「**后端产出自然语言进契约**」这一类问题的**统一决策**处理：AGENTS 规则 7 的精神是
   后端只给稳定错误码 + 语言中立 `params`，`label_zh` 是同类泄漏面里**最后一个还活着的字段**。
3. **spec G5「模型测试连接」链路要重新设计**（用户原始 bug #5）：`provider_test` 的 `ok=false` 支
   （网络不通 / 限流 / 5xx ⇒ `LlmTestResult{ok:false, message:Some(redact(&error.user_message()))}`，
   `apps/desktop/src-tauri/src/services/settings_service.rs:227-243`）demo **不演**（E-16），`message` 恒 `null`。
   这条**不是 demo 的问题**，是产品链路本身待重设计；且 `message` 装的是**中文原因**，
   与规则 7「后端只回语言中立 params」也冲突，重设计时一并处理。
   🔴 **中文散文的生产站点是 `crates/geo-llm/src/transport.rs:185`**
   （`.map_err(|err| TransportError::Other(format!("代理地址无效：{err}")))`，代理装配失败路径）。
   复审席扫遍 `crates/` + `apps/desktop/src-tauri/src/` 的全部非注释行，**这是唯一一处**出现在
   **错误消息构造路径**上的生产 CJK 字面量（其余 73 处命中全在测试 / 断言消息 / `testutil.rs` 里；
   `transport.rs:271`/`:275`/`:286` 那三处「fixture 目录读取失败」属 `FixtureTransport`，测试专用）。
   👉 G5 重设计时**连源头一起改成稳定 reason key**，不要只改 `LlmTestResult` 的形状——
   否则 `TransportError::Other` 仍带中文 prose，这些串会**改道**进日志或别的新字段，问题换皮重生。

## §6 工程债与判据纪律（不是差异，但下一个人必须知道）

1. **`apps/desktop/ui/src/demo/handlers/prompt-csv.ts` 已 **421 行**，超 AGENTS「单文件约 400 行就考虑拆分」的软线**。
   裁定**不拆**：复审席核过**无重复状态机**（只有一个 `parseCsv`），行数主要来自 docblock 与读写两条路径，
   而拆分会动到 14-R1 刚判过的禁改文件结构，风险 > 收益。后续若要拆，切口是「把 CSV 词法解析单独成模块」。
2. **`apps/desktop/ui/src/test/truth-source.ts` 是「后端 `pub const` ↔ demo 同字面量」的唯一入口**。
   以后凡有这类义务（已落地两条：`CSV_TAG_SEPARATOR` ↔ `csv_io.rs` 的 `TAG_SEPARATOR`、
   `RUST_EXPORT_FORMAT_VERSION` ↔ `project_transfer.rs:19`），一律往这里加解析器，
   **不要在测试里手抄字面量**；解析失败**必须抛**、不许回落默认值（回落＝把「后端把常量挪走了」变成静默假绿）。
3. **生产侧字面量只剩一份，且被三层判据钉住**：`project-transfer.ts:76` 是唯一的生产副本；
   `m1-contract.test.ts:412` 钉「生产副本逐字等于真值源」、`:409` 是**反永真钉子**（写死 `'geo-project-export-v1'`，
   否则断言会退化成「真值源解析出的值 == 真值源解析出的值」）、`:422-431` 是那个 `literalCopies` 扫描器**自己的**自测。
   `project.test.ts:471`/`:476` 是同形的第二处钉子（`:474-475` 明写「这行**必须**是字面量、**不许 DRY**」）。⇒ **测试侧写死字面量是必需的，不算「第二份副本」**。
4. **`apps/desktop/ui/src/test/**` 算生产源码扫描面**：测试 helper 的**抛错文案一律 ASCII**，中文只进注释
   （`truth-source.ts:11` 已自陈）。这是**想要的**——将来有人往 helper 里加中文抛错文案会红，**不是误报**。
5. **硬编码 placeholder 例外表是棘轮**：表**恒空**（`no-hardcoded-strings.test.ts:1002`），
   并用 `toEqual([])` **精确**钉住（`:1029`，比原先的 `.every(理由够长)` 更强——空数组上 `.every()` 是永真的）。
   将来任何新例外都必须**显式加行**、必然出现在 diff 里过审。
6. **残留判据双向钉住**（`apps/desktop/ui/src/pages/en-us-page-residual.test.tsx`）：短尾（≤4 字）
   **逐字列举** `SHORT_DATA_PINNED` = **81 条**（长度直方图：2 字 **62** / 3 字 **1** / 4 字 **18**；阈值 `:127`，清单 `:129` 起，docblock `:106-126`），
   判据在 `:233-239`（逐字清单 + 条数上界同一个闸门；`:229-231` 明写「条数与长度分布只在 docblock 里维护，
   这里刻意不抄第二份数字」），总清单上界断言在 `:223-226`；长尾有 `DATA_STRINGS_UPPER_BOUND = 260`（`:148`，当前真值 **228**），
   下界仍是 `>= 20`（只负责防空跑）。⇒ 「放行面变宽」从**静默**变成**必须过审**。
7. **`emDashLines >= 4` 哨兵**（`no-hardcoded-strings.test.ts:714-720`）：#52 裁定**不并入** `U+2026`/`U+2014`/`U+00B7`，
   但用这个哨兵钉住「空值占位符 `—` 至少还有 4 处」，一旦消失就说明裁定前提变了、必须重跑一次。
8. **`第一` 的负向前瞻**（`dictionary.test.ts:794-802`）：`第一(?!次|天|步|轮|批|版|层|手|线|季度|条|列|行|…)` 共 13 支，
   序数用法（「第一条」CSV 行序、「第一列」表头、「第一步」向导）不假红；最危险的 `第一名` **确实被抓**，**无假绿**。
9. ⚠ **en-US 整页守卫有一个不可消除的残余盲区**：`en-us-page-residual.test.tsx` 用「整页无 CJK **减去**种子数据串」作判据，
   其中那 **81 条 ≤4 字**的短数据串会被减掉 ⇒ **若某处未翻译的 chrome 恰好与这 81 条之一逐字相同，会被静默减掉**。
   缓解手段（全部已落地）：逐字钉死 + 条数钉死 + 上界 260 + 反向对照（`设置/删除/导出/项目/状态` 这类词**不许**被减掉）
   + 5 条整页守卫。**任何往种子语料加 ≤4 字新词的动作都必须回来过审**（断言消息已这么写）。
10. **契约测试守「键集」、模块测试守「键值」**（M10 的分工事实）：`error-contract.test.ts` 只保证
    「demo 发出的错误码与 params **键集**在 `contracts/error-codes.json` 登记过」，
    **不**保证每个 handler 在具体输入下发出**正确的键值**——那是各模块自己的 `*.test.ts` 的职责。
    **别把 `error-contract.test.ts` 当全能哨兵。**

11. 🔴 **`Rust generate_handler!` ↔ `TS IPC_COMMANDS` 的同集性没有自动守卫**（全分支复审 MIN-1）。
    `apps/desktop/src-tauri/src/ipc/mod.rs:5-6` 只有一句注释「命令清单以 `client.ts` 的 `IPC_COMMANDS` 为准：
    漏注册会在前端表现为 `ipc/internal` 拒绝，加命令时两边一起改」，`:17` 起是 `generate_handler![…]`。
    demo 侧有**编译期**（`Record<IpcCommand, DemoHandler>`）+ **运行期**（`backend.test.ts:113`/`:126`
    两枚 `toHaveLength(40)` 与键集相等）**双守卫**；**Rust 侧什么都没有**。
    ⇒ 谁在 `client.ts` 加一条命令、在 demo 接上、却忘了注册进 `generate_handler!`，`mise run check` **全绿**，
    缺陷只在**桌面运行时**表现为 `ipc/internal`，而桌面端不在 CI 里跑。
    三方同集今天实测是 **40 / 40 / 40**（Rust 注册 / TS 清单 / demo 实现，集合差全空），**但这个等式没有守卫**。
    👉 修法与 `apps/desktop/src-tauri/src/error.rs:251` 读契约 JSON **完全同一套手法**：在 `ipc/mod.rs` 加一个 `#[test]`，
    `include_str!("../../../ui/src/api/client.ts")` 读进来、正则抽 `IPC_COMMANDS = [ … ]` 的字面量，
    与注册清单做**集合相等**断言（加一条不注册 ⇒ 红；注册一条不在清单里 ⇒ 红）。**建议合并后第一件事补。**
12. **AGENTS 规则 5 的「bundled SQLite」只是**传递性**满足**（全分支复审 NIT-2，控制器已核过特性链）。
    workspace `Cargo.toml:39` 写的是 `features = ["runtime-tokio", "sqlite", "macros", "migrate", "chrono", "uuid"]`，
    **没有**显式 `bundled`，也没有显式 `libsqlite3-sys` pin；实际链路是
    `sqlx 0.9.0` 的 `sqlite = ["sqlite-bundled", …]`（`sqlx-0.9.0/Cargo.toml:181-182`）→
    `sqlite-bundled = […, "sqlx-sqlite/bundled", …]`（`:187-189`）→ `libsqlite3-sys/bundled`
    （`sqlx-sqlite-0.9.0/Cargo.toml:59`），当前解析到 `libsqlite3-sys 0.37.0`（`Cargo.lock:2616-2618`）。
    ⇒ **今天规则 5 是满足的**，但 sqlx 同时提供 `sqlite-unbundled`（`:198-201`），
    一次 sqlx 升级若改掉 `sqlite` 的默认含义，就会**静默**改链系统 sqlite（走 `pkg-config`/`vcpkg`），
    而在 macOS 上**照样编译通过**（系统自带 sqlite3）⇒ 本地看不出来，可复现性与跨平台打包会坏。
    👉 修法（很便宜）：把 `"sqlite-bundled"` 显式写进 features，或加一条
    `libsqlite3-sys = { version = "0.37", features = ["bundled"] }` 的 workspace pin + 一个断言特性开启的构建期检查。
## §7 流程常驻条款（写代码的人与复审的人都要遵守）

1. **变异证据的补强口径**：凡「变异**不是**由本轮存活的代理亲手跑出来的」（例如实现席中途被限流打死、
   控制器代写报告代提交），**复审席必须亲手重跑 ≥2 个**变异（其中 ≥1 个是「把判据改弱 ⇒ 必须红」这个方向），
   **不接受「核输出文件」作为等价证据**。先例：15b 的 9 个变异由死者跑、控制器只核了 `/tmp/t15b_*`，
   复审席亲手重跑 4 个（短尾清单 `82 vs 81` 红 / 往 `common.loading` 注 `保证排名` 红 /
   收窄 namespace 红 / 契约总扫改回 `Promise.all` 红）并 `shasum -c` 复原 4/4 之后，这个弱点才算关闭。
2. **非注释 CJK 自证的配方必须复用仓库那一份**：一律用仓库判据里的 `stripComments`
   （`no-hardcoded-strings.test.ts` / `en-us-page-residual.test.tsx` 用的同一个），或走 `src/test/repo-file.ts`；
   **不要再手写第二个扫描器**。先例：手写扫描器在 `ProxyForm.tsx:40-41` 那种「JSX 属性位置放 `//` 注释」的形状上**伪报**，
   而仓库判据处理得了（否则门禁不会绿）。风险不在代码，而在配方——下一个人遇到伪报，
   可能去「修」判据而不是修配方。

## §8 交回产品负责人的手动验收（控制器不代跑真人验收）

`mise run web` 打开 demo 后请逐项走查：

1. **全流程**：项目列表 → 建项目（5 步向导）→ 实体卡（字段编辑 / 状态切换 / 修订时间线）→ 题库
   （生成 / 去重 / CSV 导入导出）→ 设置各页（通用 / 数据与存储 / 模型 / 代理 / 扩展）。
2. **切 English**：全站**零中文残留**（含 antd 内置组件、错误提示、导出相关的上屏文案）。
3. **切回中文**：所有文案回到 zh-CN，**无键名裸露**（形如 `settings.proxy.url`）。
4. **模型测试连接**：按 spec G5，这条链路**当前有意保留缺陷**（见 §5-3）；请确认「本轮不修」符合预期，或排进下一轮。
5. **`REVOKE_DELAY_MS = 0`**（Task 14 Nit 2，`apps/desktop/ui/src/demo/handlers/export.ts:50`、用在 `:101`）：
   欠一次**真浏览器**走查——同步 `revokeObjectURL` 会在部分浏览器把刚发起的下载掐断，所以排到下一个宏任务；
   请确认真实浏览器里导出**不被掐断**、且没有可感知的闪烁或竞态。jsdom 里测不出来。
6. **导出**：JSON 与 CSV 下载后用 Excel / 记事本各开一次，确认 BOM + charset 两道都不乱码（E-25）。
7. **演示模式横幅与钥匙串提示**：`SecretStatus.tsx:106` 那句「演示模式不会写入系统钥匙串」**只在 `runtime === 'demo'`**
   时渲染 ⇒ 请确认桌面端（`mise run dev`）里它**不出现**。
8. **E-28 的决策**：准备一份含 `"closed"xx` 的 CSV，在 demo 里导入 ⇒ 会看到 `row_invalid` 报错；
   同一份文件在桌面端会**静默导入**且那个单元格是 `closedxx`。请裁：放宽 demo，还是后端加校验。
9. **项目概览（2026-10-29）**：点项目默认进概览；默认落第 3 轮（行动后复测）而不是进行中的第 4 轮；
   切第 1 轮看样本不足提示与环比消失；清空轮次看空态 + 去采集；英文界面除数据外无中文。
10. **组合总览（2026-10-29）**：左侧栏「项目 → 组合总览」；3 个 active 项目（1 个有结论、2 个待采集）；
    走查筛选（全部 / 有结论 / 待采集 / 有告警）、搜索、三种排序、分布指标切换与行内下钻；
    确认归档项目不出现、待采集行不显示 0%。
