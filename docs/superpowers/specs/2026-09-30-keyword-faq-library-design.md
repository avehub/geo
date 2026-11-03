# GEO 桌面客户端 · 关键词库 + FAQ 常见问题库（M1.5 素材层）设计规格

> **文档状态**：2026-09-30 定稿并同轮落地（demo 侧）。
> **关系**：承接 `2026-09-29-plan-b-navigation-settings-newproject-design.md` 的两级导航（DR-25 / DR-26），
> DR 编号续到 **DR-37 … DR-44**；DR-1 … DR-36 全部沿用。
> **需求真值源**：产品负责人 2026-09-30 口头需求（本文 §1 逐条留痕）+ `docs/GEO客户端-MVP产品定义-v1.md` §3.3 / §3.4 / §3.8。
> **范围**：🔴 **只改前端 demo**（`apps/desktop/ui`）。Rust 侧本轮零改动，新增差异登记进
> `2026-09-23-demo-vs-backend-known-divergences.md` §4d（编号从 **E-52** 起，按 §1 的续号纪律）。

---

## 1. 需求原文与拆解（2026-09-30）

> 「结合当前 demo 项目页面，在一级项目菜单下面需要增加关键词和 FQA pages 常见问题库菜单，可以放到品牌实体菜单下面：
> 内容支持手动录入，也可以 AI 自动生成关键词、长尾词、FQA 问题库。主要方便用户可以直接引用该部分内容进行优化网站、
> prompt 题库引用等。」

| # | 需求片段 | 落地位置 |
|---|---|---|
| 1 | 一级「项目」菜单下**新增两个二级项**：关键词库、FAQ 常见问题库 | §3（导航）、`components/SideNav.tsx` 的 `PROJECT_SECTIONS` |
| 2 | 位置在**品牌实体（卡）下面** | §3：顺序 = 实体卡 → **关键词库 → FAQ 库** → Prompt 题库 → 采集 → … |
| 3 | 内容**支持手动录入** | §6：`keyword_add` / `keyword_update` / `faq_add` / `faq_update` + 两个录入弹窗 |
| 4 | 也可以 **AI 自动生成**关键词、长尾词、FAQ 问题库 | §6：`keyword_generate` / `faq_generate`；🔴 demo 不调模型（规则 9，见 §7） |
| 5 | 方便**直接引用**去优化网站 | §8：关键词导出 CSV、FAQ 导出 **schema.org `FAQPage` JSON-LD**（复用 `export_write_file`） |
| 6 | 方便 **prompt 题库引用** | §8：勾选条目 →「引用到 Prompt 题库」→ 选题库 → 复用既有 `prompt_item_add`（**不加新命令**） |

## 2. 非目标（本轮明确不做）

- 🔴 **不改任何 Rust 代码**、不加迁移、不加 `#[tauri::command]`：10 条新命令**只有 demo 侧实现**，
  与 M3–M7 那 20 条、Plan B 那 2 条同族（差异 E-33 / E-46 的先例），桌面端点进来会报 `ipc/unknown_command`。
  👉 这一族的命令数由 22 → **32**。
- **不做关键词挖掘算法**：搜索量、竞争度、难度分、词根扩展、去重率一律是**预置静态值**（规则 9）。
- **不做 FAQ 答案的模型成文**：AI 生成走「预置语料批次」，产物一律 `pending_review`（规则 6）。
- **不做 Markdown → HTML 渲染**：JSON-LD 里的答案按**原文**塞进 `acceptedAnswer.text`
  （与 `api/content-compose.ts` 对 `html` 那一支的同族取舍：不引解析器）。
- **不做 CSV 导入**（只导出）：导入要移植 `csv_io.rs` 的表头校验与行级错误契约，属 Plan C。
- **不引新依赖**。

## 3. 导航与路由（DR-37）

`PROJECT_SECTIONS` 由 7 项扩到 **9** 项，新增两项**紧跟实体卡**：

```
▾ 澜舟工业除尘设备
    品牌实体卡        /projects/:id/entity-card
    关键词库          /projects/:id/keywords      ← 新增（TagsOutlined）
    FAQ 常见问题库    /projects/:id/faq           ← 新增（QuestionCircleOutlined）
    Prompt 题库       /projects/:id/prompts
    多引擎采集 … 报告与分享（原样）
```

**为什么放在实体卡之后、题库之前（DR-37）**：这两个库是**素材层**——实体卡描述"我是谁"，
关键词与 FAQ 描述"用户会怎么问"，Prompt 题库再从这两个库里**引用**问法去采集。
顺序即产品闭环顺序（M1 → M2 之间插一层 M1.5），与 `nav.*` 词典键顺序、路由路径段三者同名同序，
于是 `SideNav` 的 selectedKey 推导与跳转**仍然不需要映射表**（Plan B Task 6 的既有性质）。

**未选项目时这 9 项一律不出现**（不是置灰），沿用 spec §5 的裁定。

## 4. 契约：DTO（`api/types-library.ts`，DR-38）

```ts
type KeywordKind    = 'core' | 'long_tail' | 'brand' | 'competitor' | 'question';
type LibrarySource  = 'manual' | 'generated' | 'imported';

interface KeywordItem {
  id, project_id, text, kind: KeywordKind, intent: IntentCategory,
  monthly_volume: number | null, difficulty: number | null,   // 🔴 demo 静态值（§7）
  priority: number,                                           // 1..5，引用成 Prompt 时当 weight
  status: ContentStatus, note: string | null, source: LibrarySource,
  position: number, created_at, updated_at
}
interface FaqItem {
  id, project_id, question, answer_markdown, category: string | null,
  intent: IntentCategory, status: ContentStatus, source: LibrarySource,
  position: number, created_at, updated_at
}
```

- **`intent` 复用 M2 的 `IntentCategory`（7 类）**，不新造一套维度：这是"引用到 Prompt 题库"能
  一对一映射的前提（DR-39）。
- **`status` 复用 `ContentStatus`**（`pending_review` / `approved` / `rejected`）：AI 生成的素材
  在人工采用前不该被当成事实（规则 6）。标签复用词典 `action.contentStatuses`，**不新写一份**
  （先例：`entity.contentStatuses` 那个重复面被收掉，判据在 `i18n/enum-label-prefixes.test.ts`）。
- **`LibrarySource` 刻意不复用 `PromptSource`**：后者的 `template` / `rewritten` 两档来自
  「模板展开 → 口语化改写」那条管线，素材库没有这两条链路；借用会让界面显示一条并不存在的生成链。
- 枚举值清单照仓库口径给运行时数组 + `AssertComplete<ValuesAreComplete<…>>` 编译期完整性网。

## 5. i18n（DR-40）

- `nav` 加两键：`nav.keywords`（关键词库 / Keyword Library）、`nav.faq`（FAQ 常见问题库 / FAQ Library）。
- **只新增一个 namespace：`library`**（zh/en 各一个文件），内部再分
  `library.kinds.*` / `library.sources.*`（两张枚举标签表）+ `library.keyword.*` / `library.faq.*`（两页 chrome）
  + `library.reference.*` / `library.export.*`（两个共用弹窗）。
  🔴 不拆成 `keyword` + `faq` 两个 namespace：`sources` 与「引用 / 导出」两个弹窗是**共用**的，
  拆开会逼出第二份逐字相同的标签表（正是 `entity.contentStatuses` 那个缺陷类）。
  合规扫描面因此由 14 → **15** 个 namespace（`i18n/dictionary.test.ts` 的 `COMPLIANCE_NAMESPACES` 同步）。
- 新增两个 `enumLabel` 前缀：`library.kinds`、`library.sources`（44 → **46**）。
- **文案合规**（规则 6）：不出现"保证排名/霸屏/第一/最"，不出现 `guaranteed` / `#1` / `best` / `100%`；
  搜索量与难度那两列必须挂着 `library.staticNote` 那句"演示模式下是预置静态值"。

## 6. 命令面（10 条，DR-41）

`IPC_COMMANDS` 由 62 → **72**。命名与既有 M1/M2 的 CRUD 同族，入参一律 snake_case：

| 命令 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `keyword_list` | `project_id` | `KeywordItem[]` | `position ASC, id ASC` |
| `keyword_add` | `project_id, drafts[]` | `KeywordItem[]`（新增那几条） | `source` 由后端固定 `manual` |
| `keyword_update` | `item` | `KeywordItem`（单条） | 照 `prompt_item_update` 的形状：整行进整行出 |
| `keyword_delete` | `project_id, ids[]` | `KeywordItem[]`（剩余快照） | 幂等，照 `prompt_item_delete` |
| `keyword_generate` | `project_id, options` | `KeywordItem[]`（新入库那几条） | 🔴 预置批次（§7） |
| `faq_list` / `faq_add` / `faq_update` / `faq_delete` / `faq_generate` | 同上 | 同上 | 同族 |

- **返回形状三种不一致是刻意的**（照抄 M2 的既有契约：list 回数组、update 回单条、delete 回快照），
  不在 demo 里"统一"掉。
- **错误码不新增**（`contracts/error-codes.json` 冻结在 43 条）：项目不存在 → `project/not_found`；
  条目 id 认不出 / 必填为空 / 种类为空 → `validation/failed`（`field` + `reason` + 可选 `value`）。
  素材库**没有**自己的 `keyword/not_found` 码，与 `content_update_status` 用 `validation/failed` 同一先例。
- **`keyword_generate` 的 options**：`{ kinds: KeywordKind[], target_count: number }`；
  **`faq_generate`**：`{ intents: IntentCategory[], target_count: number }`。`target_count` 夹在 1..20。

## 7. 🔴 demo 的能力边界（规则 9，DR-42）

| 真后端将来怎么做 | demo 怎么做 |
|---|---|
| 关键词挖掘：调模型 + 第三方关键词接口，产出搜索量 / 竞争度 / 难度 | 从 `seed/keywords.ts` 的**预置池**里按 `kinds` 挑，`monthly_volume` / `difficulty` 是种子里的**字面量** |
| FAQ 生成：按实体卡 + 意图成文，跑合规扫描 | 从 `seed/faqs.ts` 的预置池里按 `intents` 挑，产物 `status: 'pending_review'`、界面标注"演示模式未执行合规扫描" |
| 素材去重（近似重复） | **不做**相似度计算；只跳过**文本完全相同**的条目（等值判断，避免连点两次生成出两份一模一样的清单） |

三条都写进差异台账（E-52 … E-54）。⚠ 与 M3–M7 同族：界面上必须**看得见**"这是演示数据"，
所以两个页面各挂一条 `staticNote`，生成弹窗里挂 `demoBody` 那句。

## 8. 引用出口（DR-43 / DR-44）

- **DR-43 · 引用到 Prompt 题库（不加新命令）**：勾选 N 条 → 弹窗里选目标题库（`prompt_set_list`）→
  `prompt_item_add(set_id, drafts)`。映射：`text` ← 关键词文本 / FAQ 问题；`intent` ← 同名字段；
  `weight` ← 关键词 `priority`（FAQ 恒 3 = `PromptDraft` 的后端默认）；`group_name` / `tags` **留空**。
  🔴 `group_name` 刻意不填"关键词库"这类中文串：它是**数据**，填了就会随界面语言变化
  （en 界面引用进去变成英文分组名，同一份库出现两种分组），而 `source` 由后端固定成 `manual`
  （`handlers/shared.ts` 的 `asPromptSource` 口径），所以界面另有一句提示说明"引用后按人工录入计"。
- **DR-44 · 优化网站的两个导出**（前端组装 + 既有 `export_write_file` 落盘，**不加导出命令**）：
  - 关键词 → CSV，表头 `text,kind,intent,priority,monthly_volume,difficulty,status,note`
    （🔴 表头常量住在 `api/library-compose.ts`，**不进** `api/constants.ts`：那个文件的口径是
    "与 `csv_io.rs` 逐字同步"，而这张表在 Rust 侧还不存在，Plan C 落地时再决定要不要收进 `csv_io.rs`）。
  - FAQ → `FAQPage` JSON-LD（`@context` / `@type` / `mainEntity[]`），**只收 `status === 'approved'` 的条目**：
    待审的答案不该被贴到官网上（规则 6 的落点）。零条可用时按钮置灰并说明原因。

## 9. 数据与种子

- `DemoDb` 新增两张**有写路径**的表：`keywords` / `faqs`（照 `DemoDb` 的既有裁定：只放会被写的表）。
- 种子挂在那个 active 项目（`SEED_ACTIVE_PROJECT_ID`）下：关键词 **14** 条（5 种 `kind` 全覆盖、
  3 种 `source` 全覆盖、三种 `status` 都出现）、FAQ **8** 条；另各有一个**生成池**
  （关键词 12 行 / FAQ 8 行），池子**不入初始库**——要让"点生成 → 库里多出来"这件事在界面上看得见变化
  （与 `SEED_RETRY_OUTCOMES` 不入初始库同一条理由）。
- 确定性照旧：id 是 ASCII 稳定字面量（`demo-kw-*` / `demo-faq-*`）、时间戳是 2026-09 的固定 RFC3339，
  一个 `Date.now()` / `Math.random()` 都不许有（`demo/seed.test.ts` 的钉子会自动数到新增的时间戳）。

## 10. 测试与守卫影响面（判据只增不减）

| 文件 | 改动 |
|---|---|
| `demo/handlers/keyword.test.ts` / `faq.test.ts` | **新增**：CRUD 语义、`validation/failed` 三支、生成批次、`pending_review` 默认态 |
| `pages/KeywordLibraryPage.test.tsx` / `FaqLibraryPage.test.tsx` | **新增**：列表落地、手动录入、AI 生成、引用到题库、导出置灰/可用、错误态 |
| `api/library-compose.test.ts` | **新增**：CSV 转义与表头、JSON-LD 只收 approved、空集时的形状 |
| `demo/backend.test.ts` | 62 → **72**（✅ 已落）；新增 `LIBRARY_COMMANDS`（10 条）进账本，账本由九份变十份 |
| `demo/seed.test.ts` | 时间戳总数 105 → **149**（✅ 已落：关键词 14 行 × 2 + FAQ 8 行 × 2 = 44；两个生成池是紧凑行、不带时间戳 ⇒ 一条不贡献）；新增 `demo/seed · M1.5 素材库` 一节 **5 条**自洽断言 |
| `components/SideNav.test.tsx` | 7 项 → **9** 项，顺序含新两项（✅ 已落，`SECTION_LABELS` 与靶心 ④⑤ 的文案同步） |
| `i18n/no-hardcoded-strings.test.ts` | components 37 → **46**（42 个 .tsx + 4 个非组件模块）、pages 清单 19 → **21**、抽取面 58 → **69**、`DEMO_SEED_EXPECTED` 15 → **17**（✅ 全部已落） |
| `i18n/enum-label-prefixes.test.ts` | `EXPECTED_PREFIXES` 44 → **46**（✅ 已落） |
| `i18n/dictionary.test.ts` | `COMPLIANCE_NAMESPACES` 14 → **15**（✅ 已落） |
| `pages/en-us-page-residual.test.tsx` | 新增两页的整页守卫 + 两个 seed 模块进减法清单（✅ 已落；短尾逐条过审的结论见 §12-2） |

## 11. 走查清单（`mise run web`）

1. 左侧「项目」→ 选中项目 → 实体卡下面出现**关键词库**与**FAQ 常见问题库**两项；未选项目时不出现。
2. 关键词库：14 条种子落地，5 种类型 / 3 种来源 / 3 种状态都能筛出来；类型与状态是词典标签，不是裸记号。
3. 「手动录入」一条 → 立刻出现在列表末尾，来源=人工录入、状态=**已通过**（`action.contentStatuses.approved` 的既有标签，本轮没有新写一份）；留空文本 → 报"必填"而不是静默成功。
4. 「AI 生成」→ 勾选类型 + 数量 → 生成中态可见 → 新增条目来源=AI 生成、状态=**待审核**；再点一次不会重复入库。
5. 勾选 3 条 →「引用到 Prompt 题库」→ 选题库 → 成功提示；切到 Prompt 题库页能看到那 3 条（来源=人工录入）。
6. 「导出 CSV」→ 预览 → 下载（demo 里是浏览器下载，文件名回显）。
7. FAQ 库：8 条种子；展开一行能看到答案原文（换行与列表记号**原样**保留）；「导出 FAQPage JSON-LD」
   **只含「已通过」**的条目（种子里 5 条），把全部条目打回待审后按钮置灰并说明原因。
8. 切 en-US：两个页面整页无中文（数据除外）；切暗色：无硬编码白底。
9. 刷新页面：库回到种子（"刷新即重置"）。

---

## 12. 落地回填（2026-09-30 同轮）

### 12-1 计划之外多改的两处（都是"判据不许两份"逼出来的）

1. **`library.reference.mappingNote` 拆成两句**（`keywordMappingNote` / `faqMappingNote`）。
   原稿把"关键词优先级作为权重"写进了两页**共用**的一句里，而 FAQ **没有** `priority` 字段
   （DR-43：FAQ 的权重恒取 `PromptDraft` 的后端默认值）⇒ 共用一句就必然对 FAQ 那一页说谎。
   现在由**页面**决定传哪一句（`LibraryReferenceModal` 多一个 `mappingNote: string` 入参），
   两个调用点就写在各自那段映射代码旁边，评审时一眼能核。
2. **两个生成弹窗的默认档搬进 `components/library-generate-defaults.ts`**。
   原先 `initialValues` 是弹窗里的字面量，而"默认档在预置池里挑得出几条"是**默认档与种子数据的
   联合性质**：`demo/seed.test.ts` 要拿它算出 6，两个页面测试里那个"生成 6 条"也要拿它算。
   三处各抄一份类型/意图清单就会静默漂移（同 `i18n/enum-label-prefixes.test.ts` 拦的那个缺陷类）。
   🔴 不住在弹窗文件里是**被迫的**：`react-refresh/only-export-components` 在
   `eslint --max-warnings 0` 下是硬红，组件文件不许再导出别的形状 ⇒ 照 `wizard-steps.ts` /
   `format.ts` 的先例，放成 `components/` 下的非组件数据模块（`no-hardcoded-strings.test.ts`
   的 components 计数因此是 46 而不是 45）。

### 12-2 `en-us-page-residual.test.tsx` 的短尾过审结论（M-1 那条闸门）

两个 seed 模块进减法清单之后：总清单 454 → **527**（上界同步 520 → **600**，留白比例与上一轮
一致，没有借这次放宽）；≤4 字的短尾只多出 **1 条**——`故障排查`（FAQ 的自由文本分类）。
逐条判断：全仓 `rg 故障排查` 除种子外**零命中**（`i18n/locales/**`、`components/**`、`pages/**`
都没有这个串）⇒ 没有任何界面标签与它同形，减法不会吃掉 chrome。FAQ 另外 7 个分类
（`选型` / `报价` / `安装` / `验收` / `维保` / `售后` / `工况`）**一条都没新增**——M3–M7 的处方
语料早就把它们收进清单了；≤3 字那两档同样一条没多（62 / 63 原样），风险面没有实质变宽。

### 12-3 顺带修掉的两个测试定位缺陷（不是本功能的问题，但被它暴露了）

1. **`src/test/dropdown.ts` 多了一支"弹层内定位"**（`openPopup` / `findClickablePopupItem` /
   `clickClickablePopupItem`，自带 4 条自证用例）。原有的 `findClickableMenuItem` 是**全文**找
   "文案匹配且可点、恰好一个"，它的前提是"同名文案只可能来自弹层"；素材库打破了这个前提——
   筛选 `Select` 的选项与表格里的枚举标签**逐字相同**（`竞品词` / `AI 生成` / `已通过`），
   表格单元格同样"可点"，命中数于是变成 2 / 5 / 10。这不是弹层没关干净，helper 也不该静默挑一个
   ⇒ 判据收窄到**展开着的那一份弹层**内部，"恰好 1 个可点项"的不变量原样沿用。
2. **展开行的多行原文不能用 `getByText` 比**。`getByText` 只把 **DOM 那一侧**的空白折叠掉，
   期望串不折叠 ⇒ 拿整段 Markdown 原文（含 `\n\n`）去比**永远比不上**（实测：原文 `queryByText`
   为 null、手工折叠后才命中）。而那恰好把"换行被原样保留"这件事测没了。改成断言展开行的
   `textContent` **包含**原文逐字（`textContent` 不做归一化）⇒ 判据反而更强。
