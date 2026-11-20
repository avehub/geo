# 生成依据 grounding：实体卡与已核实知识进入 AI 生成上下文

> 缘起：产品负责人 2026-11-19 指出「知识库、关键词、FAQ、Prompt 的 AI 生成没有参考已填入、
> 已核实的品牌实体卡与知识库」。本文把修法定稿为一条共享接缝，并记录落地范围与边界。
>
> 上游真值源：`docs/GEO客户端-MVP产品定义-v1.md` §3.3「实体卡即真值源（Ground Truth）：
> M4 的事实核查、M6 的内容生成全部以它为准」。

## 1. 问题

真后端五个生成入口各自拼一段 Prompt，上下文口径互不一致：

| 入口 | 修复前的上下文 |
|---|---|
| `keyword_generate` | 项目品牌/行业/地区/官网 + 实体卡 `products[].name` + 已有词 |
| `faq_generate` | 同上 + 意图 |
| `kb_generate` | 同上 + 模块 |
| `prompt_set_generate` | 项目品牌/别名/品类/地区 + 竞品 + 实体卡首个产品名、参数、备注、服务地域 |
| 文章方向 / 文章生成 | 项目品牌/行业/地区/官网；文章模板只渲染槽位，`kb_modules` 只记录 |

后果：

- 实体卡的 `standard_name`、别名、成立年份、资质、价格区间、服务地域、案例、差异化卖点、
  官方口径、联系方式基本没有进入生成；关键词 / FAQ / 知识库只拿到产品名。
- `field_status`（官方口径 / 待确认 / 存疑）**从未被生成链路读取**，「核实」不影响生成。
- 知识库只被 `KbService` 读写，其他生成服务从不读取 `kb_entries`；核实过的销售话术、
  产品卖点、案例对生成零贡献。
- 文章模板的 `kb_modules` 只记录引用关系（DR-89 的 demo 口径被 Rust 原样继承），不参与检索。

## 2. 裁定

新增 **`geo_domain::grounding`** 纯函数模块，作为五个生成入口唯一的上下文装配点；
新增 **`services::generation`** 纯 Prompt 组装层，统一下发 `【引用规则】`。

### 2.1 实体卡事实块

- 逐字段渲染 `ALL_FIELDS`（11 项），不只产品名；产品保留全部产品、参数与备注。
- 按 `EntityCard::status_of(field)` 分两段：
  - `official` → 「官方口径（可作为事实引用）」；
  - `pending` / `disputed` → 「待确认/存疑（只能作为背景，不得当作事实断言）」，
    行尾显式标注 `（待确认）` / `（存疑）`。
- 未填写字段单列「未填写」，让模型知道“没有”而不是“可以编”。
- 没有实体卡时回落项目档案（品牌 / 行业 / 地区 / 官网 / 标签），并明确写“未建立品牌实体卡”。

### 2.2 知识库知识块

只收同时满足以下条件的条目：

1. `status == approved`；
2. `verified_at.is_some()`；
3. 模块命中本次用途的白名单（文章模板可用 `template.kb_modules` 覆盖）。

排序：焦点词命中数降序 → `updated_at` 降序 → `position` 升序 → `id` 稳定序。
焦点词来自项目与实体卡（品牌、标准名称、别名、产品、参数、地域、案例、卖点、标签）。

预算：默认最多 8 条、3000 字符；超预算先降条数，再截正文（单条正文上限 600 字符），
并在知识块末尾写「另有 N 条因预算未纳入」。

### 2.3 用途 → 默认知识模块

| 用途 | 默认模块 |
|---|---|
| 关键词 | product / selling_point / case / audience |
| FAQ | product / support_script / sales_script / case / qualification |
| 知识库生成 | brand / product / selling_point / case / qualification / audience / tone / competitor / sales_script / support_script |
| Prompt 题库 | audience / selling_point / competitor / case / product |
| 文章 / 方向 | brand / product / selling_point / case / qualification / audience / tone（模板可覆盖） |

### 2.4 统一引用规则

五个入口的 Prompt 都追加同一句：

> 只能把“官方口径（可作为事实引用）”与“已核实知识库”写成事实；待确认/存疑内容只能作为背景，
> 不得当作事实断言；资料没有的信息写“未提供”，不得编造资质、案例、数据或效果承诺。

关键词 / FAQ / 知识库三个 Prompt 因此也获得了此前只有文章 Prompt 才有的“不编造”约束。

## 3. 落地范围

| 文件 | 改动 |
|---|---|
| `crates/geo-domain/src/grounding.rs` | 新增 `Grounding` / `GroundingInput` / `GroundingBudget` / `GenerationPurpose` / `focus_terms` + 7 条单测 |
| `apps/desktop/src-tauri/src/services/generation.rs` | 新增 5 个纯 Prompt 组装函数 + 6 条单测 |
| `keyword_service.rs` / `faq_service.rs` / `kb_service.rs` | 读取 `KbRepo`，装配 grounding，改用共享 Prompt |
| `prompt_service.rs` | 模型扩写 Prompt 注入 grounding；模板展开与本地口语化不变 |
| `article_service.rs` | 方向生成与文章生成注入 grounding；`template.kb_modules` 真正参与检索 |

边界：

- **命令面零新增**（仍 120 条），不改迁移、不改 DTO。
- **demo 行为不变**：`mise run web` 仍按 E-52 / E-53 / E-62 / E-66 返回预置池或克隆题库，
  不调模型、不装配 grounding；`staticNote` / `demoBody` 常驻。
- 生成物仍一律 `pending_review`；合规红线扫描仍在落库前整批拒绝。
- 不把 `pending` / `disputed` 当事实：它们只出现在「待确认/存疑」段。

## 4. 测试

- `cargo test -p geo-domain --lib grounding`：官方/待确认分流、全部产品、只收已核实知识、
  模块过滤、焦点词排序与预算、引用规则、焦点词收集。
- `cargo test -p geo-desktop --lib grounding`：5 个 Prompt 都带事实块、知识块与引用规则；
  待确认字段不进入 `fact_fields`。
- `cargo test -p geo-desktop --test keyword_service --test faq_service --test kb_service --test prompt_service --test article_service`：
  既有生成、去重、合规、降级路径不回归。

## 5. 未做 / 后续

1. **没有向量检索**：当前是焦点词子串匹配 + 预算截断；同义长尾知识可能召回不到。
2. **没有 UI 溯源**：生成结果暂不显示“参考了哪些字段 / 哪些知识条目”，只在 tracing 里记录
   `Grounding::summary_zh()`。若要做，建议在生成命令返回里加只读的 provenance 字段，
   而不是改 `notes`（`notes` 的机器行纪律见裁定 §H-1）。
3. **内容生成 / 站点补丁生成尚未接入**：`content_generate` / `site_patch_generate` 仍只取产品名；
   后续应复用同一 grounding。
4. **实体卡 `pending` 的处置**：当前进入“待确认”段，模型可能误用；更严格的做法是按用途
   禁止 `pending` 参与“答案类”生成，只允许“问题类”生成参考。需要产品裁定。
