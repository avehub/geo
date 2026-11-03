# GEO 桌面客户端 · 品牌实体卡瘦身 + 知识库（M1.2 知识层）设计规格

> 生成日期：2026-10-01 · 分支：`feat/settings-redesign-demo-i18n` · 状态：demo 侧落地，Rust 侧零改动
> DR 编号续到 **DR-59 … DR-72**；DR-1 … DR-58 全部沿用（DR-45 … DR-58 属站点接入那一轮）。
> 上游需求真值源：产品负责人 2026-10-01 口头需求（本文 §1 逐条留痕）+ `docs/GEO客户端-MVP产品定义-v1.md` §3.2 / §3.3 / §3.8。
> 🔴 本轮新增 **7 条命令只有 demo 侧实现**，且**实体卡字段面收窄**（`price_range` / `cases` /
> `differentiators` / `official_tone` 四个字段退出实体卡）——差异登记见
> `2026-09-23-demo-vs-backend-known-divergences.md` §4f（E-58 … E-62）。
> ⚠ 与「站点接入与补丁工作台」（`2026-09-30-site-connect-patch-bench-design.md`）在同一工作区并行推进：
> 两者都要改 `api/client.ts` 的 `IPC_COMMANDS`、`components/SideNav.tsx` 的 `PROJECT_SECTIONS`、
> `locales/*/index.ts`、以及那几份**写死条数**的守卫测试 ⇒ 合并时按「各自增量相加」核对，
> 不要照抄任何一侧的数字（本文 §12 给的是**本轮增量**，不是绝对值）。

---

## 1. 需求原文与拆解（2026-10-01）

产品负责人原话：

> demo 中品牌实体卡页面内，将产品价格卡片取消，写入产品与参数卡片中的一个字段中，取消案例卡片、
> 差异化卖点、官方口径卡片。然后在品牌实体卡菜单下添加知识库菜单，知识库内容需要结合项目录入时的
> 信息和素材，形成完整可复用可以修改的知识系统，需要基于实体卡信息变动而自动更新，素材可以按模块
> 显示，方便增删改，素材包括链接，文本，图片，视频等多种形式，可以结合市面成熟知识库进行设计。

| # | 需求片段 | 落地位置 |
|---|---|---|
| 1 | 取消**产品价格卡片** | §4：`ENTITY_FIELDS` 去掉 `price_range`（DR-59） |
| 2 | 价格**写进产品与参数卡片的一个字段** | §4：`ProductSpec` 增 `price`，每个产品自带报价（DR-60） |
| 3 | 取消**案例卡片 / 差异化卖点 / 官方口径** | §4：三个字段退出实体卡；内容**迁进知识库**对应模块（DR-61 / DR-62） |
| 4 | 品牌实体卡菜单下**新增知识库菜单** | §8：`PROJECT_SECTIONS` 在 `entity-card` 之后插 `knowledge`（DR-69） |
| 5 | 结合**项目录入时的信息和素材** | §7：`origin: 'project'` 的同步块（官网、行业、地域、标签、竞品、资产链接）（DR-68） |
| 6 | 形成**完整可复用可修改**的知识系统 | §5：模块化条目 + 六种素材形式 + 审核态 + 核实时间 + 导出（DR-63 … DR-66 / §11） |
| 7 | **基于实体卡信息变动而自动更新** | §7：同步块是**读时投影**，不落库 ⇒ 不可能过期；副本用 `stale_ids` 标记（DR-67 / DR-68） |
| 8 | 素材**按模块显示**，方便**增删改** | §8：模块分组面板 + 条目级增删改（DR-69） |
| 9 | 素材包括**链接、文本、图片、视频**等多种形式 | §5：`KbEntryKind` 六档（DR-64） |
| 10 | **结合市面成熟知识库**进行设计 | §2：Notion / Confluence / Guru / Slite / Outline / 语雀 / WordLift 的共同点，逐条抄了什么 |

## 2. 市面成熟知识库调研：抄了哪四件事

调研口径与站点接入那一轮（spec §2）一致：只抄**形态与纪律**，不抄具体实现，不引新依赖。

### 2.1 结构与分层

- **Confluence / 语雀 / 飞书知识库**：空间 → 目录树 → 页面 → 块。层级深、适合文档量大的团队，
  但"找一条事实"要翻三层。
- **Notion**：数据库 + 视图（按属性分组/筛选/排序），同一个页面可以在多个视图里出现。
  🔴 「**同一份内容、多个视图**」正是本轮要的：知识条目按**模块**分组是一个视图，按**素材形式**
  筛选是另一个视图，两者共用一份数据。
- **Slite / Outline**：扁平文档 + 标签 + 全文搜索，强调"写得快、找得到"。

**抄的结论**：知识库只做**两层**——`模块（固定枚举，10 个）` → `条目`。不做用户自建目录树：
① 目标客户是 1~3 人的市场部，目录树的维护成本高于收益；② 固定模块才能与实体卡字段、
Prompt 意图、行动处方**一对一挂钩**（自由目录挂不上）。模块内的"多视图"用筛选器实现（Notion 那条）。

### 2.2 可信与核实（Guru / Slite 的 verification）

- **Guru**：每张卡有 **owner** 与 **verification interval**（30/60/90 天），到期变
  "Unverified" 并给信任分；卡片短小（一屏内），强调"一个事实一张卡"；答案可直接被
  AI 助手引用（Guru 的 AI answers 只从**已核实**卡里取）。
- **Slite / Notion AI**：AI 回答附带来源链接，未核实的文档不进 AI 语料。

**抄的结论**：条目带 `status`（复用 `ContentStatus` 三态）+ `verified_at`（核实时间）。
🔴 **导出只收 `approved`**（与 FAQ 的 JSON-LD 导出同一条闸门，spec 2026-09-30 DR-44）：
未核实的知识不该被当成事实喂给内容生产或贴到官网上（AGENTS 规则 6 的落点）。
"到期未核实"这种**基于时间窗的判定**本轮不做（那是领域算法，规则 9），只呈现 `verified_at` 本身。

### 2.3 同步块（Notion synced block / Confluence include）

- **Notion**：synced block 有一个**源**，源改了所有镜像跟着改；用户可以 "Unlink"
  把镜像变成**可编辑副本**，此后不再跟随源。
- **Confluence include / 语雀「引用」**：同一思路，引用是只读的，要改就改源头。

**抄的结论**（本轮最关键的一条裁定，DR-67）：实体卡与项目信息**不复制进知识库**，
而是每次 `kb_board` **读时投影**成同步块 ⇒ "基于实体卡变动自动更新"是**结构性**成立的
（没有第二份数据就没有过期问题）。用户要改同步块只有两条路：
① 「去实体卡改」（跳回 M1，源头唯一）；② 「转为可编辑副本」（= Notion 的 Unlink），
副本落库、不再跟随，但记着 `origin_block_id`，源头再变时由 `stale_ids` 标出「源头已更新」。

### 2.4 素材形式（多媒体）

- **Notion / Confluence**：块类型区分 text / heading / list / link(bookmark) / image / video / file，
  每种类型有自己的编辑器与预览。
- **WordLift**（GEO 同族）：把知识组织成"实体 + 主张 + 证据"，证据可以是图片/视频/PDF，
  最终产出 JSON-LD 供搜索引擎与 AI 读取。

**抄的结论**：`KbEntryKind` 六档（`statement` / `text` / `link` / `image` / `video` / `file`），
一个条目一种形式，`url` + `mime` 承载媒体，`body_markdown` 承载文本/说明/图注。
🔴 **不渲染远端媒体**：demo 里的图片/视频地址都是 `example.com` 家族的保留域名，
真去 `<img src>` / `<video src>` 会打网络请求（AGENTS 规则 2 的精神）⇒ 界面只显示
**素材卡**（类型图标 + 标题 + 地址 + `mime`），不拉流、不下载。

## 3. 非目标（本轮明确不做）

- 🔴 **不改任何 Rust 代码**、不加迁移、不加 `#[tauri::command]`：7 条新命令**只有 demo 侧实现**
  （与 M3–M7 的 20 条、Plan B 的 2 条、M1.5 的 10 条、站点接入的 11 条同族）。
- 🔴 **不动 Rust 的实体卡字段面**：`crates/geo-domain/src/entity_card.rs` 的 `ALL_FIELDS`（11）/
  `REQUIRED_FIELDS`（10）/ `completeness()` 分母**一行未改**——本轮只在 demo 与前端契约上瘦身，
  代价与 Plan C 的义务登记为差异 **E-58 / E-59**。
- **不做全文检索引擎**：搜索是前端对已加载条目做 `includes`（照关键词库的既有做法），
  不进命令契约、不做分词与相关度排序。
- **不做版本历史**：条目只有 `created_at` / `updated_at` / `verified_at` 三个时间戳；
  逐版本回溯是实体卡修订留痕（M1）已有的能力，知识库本轮不复制一套。
- **不做权限与 owner**：单机单人产品（`docs/GEO客户端-MVP产品定义-v1.md` §2），
  Guru 那套 owner/团队核实没有落点。
- **不做富文本编辑器**：正文是 Markdown **原文**（与 FAQ 答案同族取舍，不引解析器）。
- **不引新依赖**。

## 4. 实体卡瘦身（DR-59 … DR-62）

### DR-59 · 字段面 11 → 7

`ENTITY_FIELDS`（`components/entity-fields.ts`）与 `EntityFields`（`api/types.ts`）同步收窄成：

```
standard_name / aliases / founded_year / qualifications / products / service_regions / contact
```

退出的四个字段各有去处，**不是简单删掉**：

| 退出字段 | 去处 | 理由 |
|---|---|---|
| `price_range` | `products[].price`（DR-60） | 报价是**产品**的属性：一个厂家多款产品价格差一个量级，一个区间串既说不清也改不动 |
| `cases` | 知识库 `case` 模块（种子已迁） | 案例要带链接、图片、客户名与工况，`string[]` 装不下 |
| `differentiators` | 知识库 `differentiator` 模块 | 卖点是**要长期打磨的语料**，不是一次性抽取的字段 |
| `official_tone` | 知识库 `tone` 模块 | 口径/合规红线是内容生产的输入，属知识层 |

🔴 **实体卡因此回到它的本职**：回答"我是谁"的**结构化事实**（名字、别名、成立年份、资质、
产品与报价、服务地域、联系方式）；"我怎么讲自己"（案例、卖点、口径）全部下沉到知识库。
这也让 M4 事实核查的对照面更干净：核查的是**事实**，不是话术。

### DR-60 · `ProductSpec` 增 `price`

```ts
interface ProductSpec { name: string; params: string[]; price?: string | null; note: string | null }
```

- **可选而不是必填**：真后端的 `ProductSpec` 今天没有这个键（`deny_unknown_fields`），
  桌面端拿到的产品对象里没有 `price` ⇒ 声明成必填会让"后端没给"变成类型谎言（差异 E-59）。
- 界面形态不变：`products` 仍是 `json` 类字段卡（就地 JSON 编辑 + 解析失败就地报错），
  只是种子里每个产品多了 `price`；`formatFieldValue` 对对象数组走 `JSON.stringify` 分支，
  所以**零组件改动**就能显示出来。
- 🔴 Plan C 的义务：`price` 要进 `crates/geo-domain/src/entity_card.rs` 的 `ProductSpec`
  与迁移（`geo-store` 的 `entity_card` 存的是 JSON 文本 ⇒ 只需改 domain 的结构体与 `is_filled`），
  同时把 `REQUIRED_FIELDS` / `ALL_FIELDS` / `completeness()` 的分母按 DR-59 收窄。

### DR-61 · 完整率的口径

demo 的 `completeness` 仍是**种子里写死的静态值**（规则 9，不移植 `EntityFields::completeness()`），
但静态值必须与"真算法在新字段面上会得到的值"自洽：7 个必填字段里刻意留空 1 个
（`founded_year`）⇒ **6/7 = 0.86**。种子里写 `0.86`，由 `demo/seed.test.ts` 钉住
（`founded_year === null` + `0.8 <= completeness <= 1`）。
🔴 真后端今天算的是 **6/10 = 0.6**（分母还是 10）⇒ 差异 E-58 登记，Plan C 改分母时一起收口。

### DR-62 · 迁出字段的**标签**留在词典里

`entity.fields.price_range` / `.cases` / `.differentiators` / `.official_tone` 四个键**不删**：

1. 真后端的 `ALL_FIELDS` 还是 11 ⇒ 桌面端的**历史修订留痕**与**事实核查记录**里仍会出现这些
   `field_path`，`enumLabel` / `RevisionTimeline` 查不到标签就回落成裸 id（用户可见的机器记号）；
2. `FactCheckPanel` / `ActionTable` 用的是 `enumLabel(t, 'entity.fields', field_path)`，
   与 `ENTITY_FIELDS` **不是**同一张表（前者是"任何可能出现的 field_path"，后者是"卡上显示哪些字段"）。

判据：`i18n/no-hardcoded-strings.test.ts` 的 B-4 那条只断言**单向**
（`ENTITY_FIELDS` 的每个 `labelKey` 在两侧都存在），刻意**不**加反向断言，
反向断言会把这条裁定变成假红。四个键在词典里挂着「已退出实体卡，仅用于历史记录」的注释。

## 5. 知识库的对象模型（`api/types-kb.ts`，DR-63 … DR-66）

### DR-63 · 模块是**固定枚举**，不是用户自建目录

```ts
type KbModule = 'brand' | 'product' | 'qualification' | 'service' | 'case'
              | 'differentiator' | 'tone' | 'audience' | 'competitor' | 'media';
```

10 个模块 = 4 个「实体卡同步」（brand / product / qualification / service）
+ 3 个「迁出字段的家」（case / differentiator / tone）
+ 3 个「项目录入与素材」（audience / competitor / media）。
每个枚举配 `KB_MODULE_VALUES` 运行时清单 + `AssertComplete<ValuesAreComplete<…>>` 编译期完整性网
（照 `types-library.ts` / `types-site.ts` 的既有形状）。

### DR-64 · 素材形式六档

```ts
type KbEntryKind = 'statement' | 'text' | 'link' | 'image' | 'video' | 'file';
```

`statement`（一句可被 AI 直接引用的定义句/主张）与 `text`（Markdown 长文）分开，
是 GEO 场景的刻意区分：**定义句**是 AI 回答里最容易被整段引用的单位（WordLift / Scrunch 的
"clarified entity definitions and claims" 同族），它值得单独一档、单独统计。

### DR-65 · 条目 DTO

```ts
interface KbEntry {
  id, project_id, module: KbModule, kind: KbEntryKind,
  title: string, body_markdown: string,
  url: string | null, mime: string | null,      // link/image/video/file 用
  tags: string[],                                // 自由文本标签（数据，不进词典）
  status: ContentStatus,                         // 复用：pending_review / approved / rejected
  source: KbSource,                              // manual / generated / imported / synced / detached
  origin: KbOrigin | null,                       // entity_card / project / null
  origin_block_id: string | null,                // 副本记着它脱离的那个同步块（DR-67）
  field_path: string | null,                     // 源头字段名（实体卡顶层字段 / 项目字段）
  verified_at: string | null,                    // Guru 式核实时间；null = 从未核实
  position, created_at, updated_at
}
```

- 🔴 `KbSource` **刻意不复用** `LibrarySource`（3 档）：知识库多出 `synced`（实体卡/项目投影）
  与 `detached`（曾是投影、已转可编辑副本）两档，这两条链路素材库没有。
  借用会让关键词库的筛选器长出两个永远选不到东西的选项（与 `LibrarySource` 不复用
  `PromptSource` 同一条理由）。
- `status` 复用 `ContentStatus`，标签复用 `action.contentStatuses`（**不新写一份**，
  判据在 `i18n/enum-label-prefixes.test.ts`）。

### DR-66 · 同步块 DTO（**不落库**）

```ts
interface KbSyncedBlock {
  id: string;                    // 'entity_card:products[0]' / 'project:assets[1]'，纯函数派生 ⇒ 稳定
  project_id: string;
  module: KbModule;
  kind: KbEntryKind;
  origin: KbOrigin;              // 'entity_card' | 'project'
  field_path: string;            // 'products' / 'website' / 'competitors' / 'assets' …
  title: string | null;          // 源自**数据**的名字（产品名 / 竞品名 / 资产标题）；没有就是 null
  value: unknown;                // 原始值，界面用 formatFieldValue / kb-view 的组装器渲染
  field_status: FieldStatus | null;  // 实体卡那个字段的可信状态（项目来源为 null）
  source_updated_at: string;     // 源头最后更新时间（实体卡 / 项目的 updated_at）
  position: number;
}
```

🔴 **`title` 与 `value` 里不许出现界面标签**：`demo/handlers/**` 的非注释 CJK 必须为 0（门禁 7），
所以「别名：」「参数：」这类**词**由界面按当前语言查词典拼（`components/kb-view.ts`），
handler 只搬**数据**。这条约束决定了 `value` 是 `unknown` 而不是已格式化好的字符串——
顺带把"语言相关的列表连接符"这个老坑（`formatFieldValue` 的 `listSeparator` 必填参数）挡在外面。

## 6. 命令面（7 条，DR-67）

`IPC_COMMANDS` 增量 **+7**（本轮从 83 → **90**；若站点接入那一轮尚未合入则从 72 → 79）。

| 命令 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `kb_board` | `project_id` | `KbBoard` | 一次拿全：`entries`（落库）+ `synced`（投影）+ `stale_ids` + `stats` |
| `kb_entry_add` | `project_id, drafts[]` | `KbEntry[]`（新增那几条） | `source` 由后端固定 `manual`、`status` 固定 `approved`（人工已经看过） |
| `kb_entry_update` | `entry` | `KbEntry`（单条） | 整行进整行出（照 `keyword_update`）；`id`/`project_id`/`position`/`created_at`/`source`/`origin*` 前端改不动 |
| `kb_entry_delete` | `project_id, ids[]` | `KbEntry[]`（剩余快照） | 幂等；🔴 同步块的 id 认不出 ⇒ 忽略（投影不可删，删源头才有效） |
| `kb_entry_detach` | `project_id, block_id, title, body_markdown` | `KbEntry` | Notion 的 Unlink：把投影转成可编辑副本（`source: 'detached'`） |
| `kb_entry_verify` | `project_id, ids[]` | `KbEntry[]`（快照） | 批量核实：`status → approved` + `verified_at → now` |
| `kb_generate` | `project_id, options{ modules[], target_count }` | `KbEntry[]`（新入库那几条） | 🔴 预置池，不调模型；产物 `source: 'generated'` + `status: 'pending_review'` |

- **返回形状三种不一致是刻意的**（照 M1.5 与 M2 的既有契约：list/board 回聚合、add/generate 回新增、
  update 回单条、delete/verify 回快照），不在 demo 里"统一"掉。
- **错误码不新增**（`contracts/error-codes.json` 冻结）：项目不存在 → `project/not_found`；
  条目 id 认不出 / 必填为空 / `block_id` 认不出 → `validation/failed`（`field` + `reason` + 可选 `value`）。
  新增的 `field` 值（`kb_entry_id` / `block_id` / `modules`）要进 `fields.*` 词典，
  否则界面上会露出机器记号（与 M3–M7 那一批同族）。
- **导出与引用一条新命令都不加**：导出复用既有 `export_write_file`（§11）。

### DR-67 · 「基于实体卡变动自动更新」是**结构性**的，不是定时任务

`kb_board` 每次调用都从 `db.entityCards` / `db.projects` / `db.competitors` / `db.assets`
**现场投影**出 `synced`（纯函数，无缓存、无副本）⇒ 实体卡一改，下一次 board 就是新的。
落库的只有**副本**（`source: 'detached'`）与人工/AI 条目；副本用 `stale_ids` 标记
「源头 `updated_at` 晚于副本的 `verified_at ?? updated_at`」——这是**两个时间戳比大小**，
不是领域算法（规则 9 允许）。界面据此显示「源头已更新，可重新同步」，
「重新同步」= 界面按当前投影重新组装标题与正文，走既有的 `kb_entry_update`（**不加命令**）。

`KbBoard`：

```ts
interface KbBoard {
  project_id: string;
  entries: KbEntry[];          // position ASC, id ASC
  synced: KbSyncedBlock[];     // 模块序 → position ASC（确定性，不按时间排）
  stale_ids: string[];         // 源头已变的副本 id
  stats: KbStats;              // 展示用计数（不是领域算法）
  entity_card_updated_at: string | null;
  project_updated_at: string;
}
interface KbStats { modules, entries, synced, pending_review, unverified, media, stale }
```

## 7. 同步来源清单（DR-68）

投影是**逐字列出的固定清单**（不是"把实体卡所有字段都投一遍"），因为每个字段要指定
落哪个模块、算哪种素材形式：

| 源头 | `field_path` | 模块 | 形式 | `value` |
|---|---|---|---|---|
| 实体卡 | `standard_name` | brand | statement | string |
| 实体卡 | `aliases` | brand | statement | string[] |
| 实体卡 | `founded_year` | brand | statement | number \| null |
| 实体卡 | `qualifications` | qualification | text | string[] |
| 实体卡 | `products[i]`（**每个产品一块**） | product | text | ProductSpec（含 `price`） |
| 实体卡 | `service_regions` | service | statement | string[] |
| 实体卡 | `contact` | service | text | Contact |
| 项目 | `website` | brand | link | string |
| 项目 | `industry_label`（回落 `industry`） | audience | statement | string |
| 项目 | `region` | service | statement | string |
| 项目 | `tags` | audience | statement | string[] |
| 项目 | `competitors[i]`（**每个竞品一块**） | competitor | link | Competitor |
| 项目 | `assets[i]`（**每个资产一块**） | media | link | ProjectAsset |

- **空值不投影**：`founded_year === null`、`website === null`、`contact === null`、空数组
  ⇒ 该块**不出现**（界面上"没有这条知识"比"这条知识是空的"更好读，也不会诱导用户去核实一个空值）。
  🔴 例外：`founded_year` 为 null 时**仍然不投影**，但实体卡那边它是必填待补 ⇒ 两页各自呈现，
  知识库不复制"待补"这个状态。
- 块的 `id` 由 `origin` + `field_path`（+ 下标）纯函数派生 ⇒ 刷新后仍是同一个 id，
  副本的 `origin_block_id` 不会漂。
- `field_status` 只有实体卡来源有（项目/竞品/资产没有字段可信状态）⇒ 其余为 `null`。

## 8. UI 与导航（DR-69）

```
▾ 澜舟工业除尘设备
    品牌实体卡        /projects/:id/entity-card
    知识库            /projects/:id/knowledge     ← 新增（ReadOutlined）
    关键词库 … FAQ … Prompt 题库 … 采集 … 报告（原样）
```

- **为什么紧跟实体卡**（同 DR-37 的理由）：实体卡说"我是谁"的**结构化事实**，
  知识库说"关于我的一切可复用素材"，两者是**源与流**；关键词库/FAQ 再从知识层里取问法。
  路径段 `knowledge` 与 `nav.knowledge` 同名 ⇒ 选中态推导仍不需要映射表。
- **页面形态**（自上而下）：
  1. 标题 + 一句定位说明 + 「演示模式」提示（`common.demoModeHint` 同族）；
  2. **统计条**（7 个 `Statistic`：模块 / 条目 / 同步块 / 待审核 / 未核实 / 多媒体 / 待重新同步）；
  3. **同步说明条**（`Alert`）：实体卡最后更新时间 + 「同步块随实体卡自动更新，要改请去源头」
     + 一个跳到实体卡的按钮（`useNavigate`）；
  4. **工具条**：搜索框 + 模块/形式/状态/来源四个筛选 + 「新增知识」「AI 生成」「批量核实」
     「导出」「删除选中」；
  5. **模块面板**（`Collapse`，10 个模块各一面板，默认展开有内容的）：面板头 = 模块名 +
     条目数 + 同步块数；面板内 = 条目卡列表（`KbEntryCard`）。
- **条目卡**：类型图标 + 标题 + 状态 Tag + 来源 Tag +（同步块额外显示）字段可信状态 Tag +
  正文（Markdown 原文，`whiteSpace: pre-wrap`）+ 地址（`Typography.Link`，`rel="noreferrer"`）+
  标签 + 核实时间 + 操作（编辑 / 核实 / 转为副本 / 重新同步 / 删除，按 `source` 分流）。
- 🔴 **同步块只有两个动作**：「去实体卡改」（跳转）与「转为可编辑副本」（`kb_entry_detach`）；
  编辑与删除按钮**不出现**（不是置灰）——置灰会让人以为"权限不够"，而真相是"这里没有可改的数据"。
- 🔴 **图片/视频不拉流**（DR-64 的对价）：媒体条目显示成素材卡（图标 + `mime` + 地址），
  界面上写明「演示模式不加载远端媒体」。

## 9. i18n（DR-70）

- `nav` 加一键：`nav.knowledge`（知识库 / Knowledge Base）。
- **新增一个 namespace：`kb`**（zh/en 各一个文件），内部分：
  `kb.modules.*`（10 个模块标签）+ `kb.modulesHint.*`（每个模块一句用途说明）
  + `kb.kinds.*`（6 种素材形式）+ `kb.sources.*`（5 档来源）+ `kb.entry.*` / `kb.editor.*`
  / `kb.generate.*` / `kb.sync.*`（同步说明与投影标签）/ `kb.stats.*` / `kb.export.*`。
  合规扫描面 +1 个 namespace（`i18n/dictionary.test.ts` 的 `COMPLIANCE_NAMESPACES` 同步）。
- 新增 3 个 `enumLabel` 前缀：`kb.modules`、`kb.kinds`、`kb.sources`
  （`i18n/enum-label-prefixes.test.ts` 的 `EXPECTED_PREFIXES` 同步）。
- **审核态标签复用** `action.contentStatuses`、**字段可信状态标签复用** `entity.fieldStatuses`
  （都不新写一份）。
- `kb.sync.projectFields.*`：项目来源的投影标签（`website` / `industry_label` / `region` / `tags` /
  `competitors` / `assets`）；实体卡来源直接复用 `entity.fields.*`（DR-62 留下的那张表）。
  🔴 这两张标签表都是**动态 key**（从数据拼出来），扫描测试抓不到 ⇒ 在
  `i18n/no-hardcoded-strings.test.ts` 的 B-4 家族里加一条点名断言（照 `NOTE_STAGES` 的先例）。
- **文案合规**（规则 6）：不出现"保证排名/霸屏/第一/最"，不出现 `guaranteed` / `#1` / `best` / `100%`。

## 10. 🔴 demo 的能力边界（规则 9 / 规则 2 / 规则 6，DR-71）

| 真后端将来怎么做 | demo 怎么做 |
|---|---|
| `kb_generate`：按实体卡 + 模块调模型成文，跑合规扫描 | 从 `demo/seed/kb.ts` 的**预置池**里按 `modules` 挑，逐字端出；产物 `pending_review`，界面标注「演示模式未执行合规扫描」 |
| 知识库全文检索（分词 + 相关度） | 前端 `includes` 过滤已加载条目 |
| 图片/视频/文档的**本地存储与缩略图**（`geo-store` 存文件、生成缩略图） | 只存 `url` + `mime` 字面量，不下载、不预览、不生成缩略图 |
| 副本过期判定（按核实周期 + 源头变更历史） | 只比两个时间戳（`stale_ids`），不做周期与历史 |
| 实体卡 → 知识库的**双向**写回（在知识库里改同步块 = 改实体卡） | **不做**：同步块只读，改要么去实体卡、要么转副本（DR-67） |
| 迁移（把已有项目的 `cases` / `differentiators` / `official_tone` 搬进知识库） | 种子里**已经搬好**（`demo/seed/kb.ts` 那几条 `source: 'imported'`），不写迁移代码 |

## 11. 导出与复用（DR-72）

`api/kb-compose.ts` 组装两种产物，落盘一律走既有 `export_write_file`（🔴 不新增导出命令），
预览与下载复用 `components/LibraryExportModal.tsx`（不新写弹窗）：

1. **Markdown 知识册**（`geo-knowledge-<projectId>.md`）：按模块分节，条目按形式渲染
   （`link`/`image`/`video`/`file` 渲染成 Markdown 链接，`statement` 渲染成引用块），
   给内容团队与代运营直接读；🔴 **只收 `approved`**（未核实的知识不进交付物）。
2. **JSON 知识包**（`geo-knowledge-<projectId>.json`）：模块 → 条目的机器可读结构，
   带 `origin` / `field_path` / `verified_at`，供 Prompt 与内容生成当上下文注入
   （WordLift / Scrunch 的"给 AI 一份澄清过的事实"同族）。同样**只收 `approved`**。

零条可用时两个按钮都置灰并给出原因（照 FAQ 的 `exportDisabled` 先例），不导出一份空壳。

**复用出口**（本轮不新增命令）：知识库条目可以经既有 `prompt_item_add` 引用进 Prompt 题库吗？
🔴 **刻意不做**：条目的正文是"事实"，题库的条目是"用户会怎么问"，两者不同构，
硬映射会产出一堆不能用的题（M1.5 的关键词/FAQ 才是题库的正确上游）。
知识层的复用出口是**导出**（本节）与 M6 的内容生成（`content_generate` 的上下文，Plan C 裁定）。

## 12. 测试与守卫（本轮**增量**，不是绝对值）

| 文件 | 本轮改动 |
|---|---|
| `demo/handlers/kb.test.ts`（新） | 7 条命令的正/反例：board 的投影清单与确定性、**改实体卡后 board 跟着变**（DR-67 的靶心）、detach 后镜像被副本取代、stale 判定、verify 批量、generate 预置池与 `pending_review`、删除幂等、`project/not_found` 与 `validation/failed` 的 params |
| `pages/KnowledgeBasePage.test.tsx`（新） | 模块分组渲染、筛选与搜索、同步块**没有**编辑/删除按钮、转副本、批量核实、导出置灰条件、en-US 整页无中文 |
| `components/EntityFieldCard.test.tsx` / `pages/EntityCardPage.test.tsx` | 字段面 11 → 7；价格断言改成「产品卡里出现 `price`」 |
| `demo/handlers/entity-card.test.ts` | `ENTITY_ROOT_FIELDS` 7 项；迁出字段的 `field_path` 现在报 `unknown_field` |
| `demo/handlers/m1-contract.test.ts` / `error-contract.test.ts` | 用 `price_range` 当样例的地方换成 `products` |
| `demo/seed.test.ts` | 实体卡静态完整率 0.86；知识库种子的确定性（时间戳落在演示月份、id 固定、池子与初始库零重叠） |
| `components/wizard-steps.test.ts` | `ENTITY_FIELDS_FROM_DRAFT` 去掉 `official_tone`；`ENTITY_FIELDS_FROM_EXTRACTION_ONLY` 5 → 2（`founded_year` / `qualifications`） |
| `i18n/no-hardcoded-strings.test.ts` | components / pages / demo-seed 三个计数 +本轮新文件数；`kb.sync.projectFields.*` 的动态 key 点名断言 |
| `i18n/enum-label-prefixes.test.ts` | `EXPECTED_PREFIXES` +3（`kb.modules` / `kb.kinds` / `kb.sources`） |
| `i18n/dictionary.test.ts` | `COMPLIANCE_NAMESPACES` +1（`kb`） |
| `demo/backend.test.ts` | 命令账本 +1 组（`kb_*` 7 条），总数字 +7 |
| `components/SideNav.test.tsx` | 二级项 +1，顺序含 `knowledge`（紧跟实体卡） |
| `pages/en-us-page-residual.test.tsx` | 新页面进整页守卫；`demo/seed/kb.ts` 进减法清单 |

## 13. 走查清单（`mise run web`）

1. 实体卡页只剩 **7 张字段卡**；「产品与参数」卡的 JSON 里每个产品带 `price`；
   价格/案例/差异化卖点/官方口径四张卡**不见了**；完整率圈显示 **86%**。
2. 左侧「项目」→ 选中项目 → 实体卡下面出现**知识库**；未选项目时不出现。
3. 知识库首屏：统计条 7 个数字、同步说明条挂着实体卡的最后更新时间、10 个模块面板
   （有内容的默认展开）。
4. **自动更新**（DR-67 的靶心）：回实体卡把某个产品的 `price` 改掉 → 回知识库 →
   `product` 模块那条同步块的报价**已经是新值**（没有"同步"按钮，也不需要刷新两次）。
5. 同步块只有「去实体卡改」与「转为可编辑副本」两个动作；转副本后该块从同步区消失，
   副本出现在同一模块里，来源标签是「已转副本」，可以编辑/删除/核实。
6. 种子里那条**副本**挂着「源头已更新」标记（`stale_ids`），点「重新同步」后标记消失、
   正文变成实体卡当前值。
7. 「新增知识」：选模块 + 形式（链接/文本/图片/视频/文档）+ 标题 + 正文 + 地址 + 标签 →
   保存后立刻出现在对应模块末尾，来源=人工录入、状态=已通过；标题留空 → 报"必填"。
8. 「AI 生成」：勾模块 + 数量 → 新增条目来源=AI 生成、状态=**待审核**，并挂着
   「演示模式未执行合规扫描」；再点一次不会重复入库。
9. 勾选若干条 →「批量核实」→ 状态变已通过、核实时间变成当前时间。
10. 「导出」：Markdown 与 JSON 两个产物都能预览 + 下载；待人工审核的条目一个字都不进产物。
    🔴 置灰的条件是「**一条可交付的都没有**」，不是「条目全被打回待审」：项目来源的同步块
    没有审核态、始终可交付（`field_status` 为 `null`，闸门只排除 `disputed`）⇒ 要看到置灰，
    得是一个什么都还没填的新项目（没有实体卡、官网 / 行业 / 地域 / 标签 / 竞品 / 资产都为空）。
    判据在 `pages/KnowledgeBasePage.test.tsx` 的两条导出用例与 `api/kb-compose.test.ts` 的闸门那一组。
11. 图片/视频条目**不加载远端媒体**（只显示素材卡与地址），界面上写明原因。
12. 切 en-US：整页无中文（数据除外）；切暗色：无硬编码白底。
13. 刷新页面：知识库回到种子（"刷新即重置"）。
