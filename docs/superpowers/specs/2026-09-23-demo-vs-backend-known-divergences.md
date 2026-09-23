# demo 与真后端的已知差异（交底清单）

> **状态**：正式交底产出物（计划 `docs/superpowers/plans/2026-09-18-plan-a-i18n-foundation-and-demo-backend.md` §A-4 第 39 条）
> **基线 commit**：`08790a4`（分支 `feat/settings-redesign-demo-i18n`）· **行号核准日期**：2026-09-23
> **门禁**：cargo 22 targets / 515 passed / 0 failed；vitest 42 files / 635 tests；`CHECK_EXIT=0`
>
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
