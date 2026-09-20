/**
 * Prompt 题库（Task 8 填入）：生成面板、表格、单条编辑器、竞品编辑器与 CSV 导入导出。
 *
 * # `csv.reasons.*` 为什么在这里而不在 `errors.reasons.*`
 *
 * 裁定 B-5 要求行错误走「code 级覆写优先 → `errors.reasons.<reason>` 兜底」，控制器建议的
 * 键形状是 `errors.csv.<reason>`。**这里换成了 `prompt.csv.reasons.<reason>`**，两条理由：
 * 1. `src/i18n/locales/{zh-CN,en-US}/errors.ts` **不在本任务的写集内**（简报 §C 只允许
 *    `{common,project,prompt,entity,settings}` 五个 namespace），写进去 §D-5 的越界自查就不是 0 行；
 * 2. `src/i18n/dictionary.test.ts` 的「结构闭合」用例把 `errors` 下的叶子钉成**六类**
 *    （code / reasons / kinds / transport / skip_tokens / fragments），多一个 `errors.csv.*`
 *    当场就是"不属于任何一类的键"。
 * CSV 导入导出本来就只有题库页这一个 surface，放 `prompt` 下语义也更贴。
 *
 * # `csv.reasons.not_allowed` 是**独立的合规模板**，不含 `{{value}}`
 *
 * CSV 导入里的 `not_allowed` 只可能来自广告法红线检查（`crates/geo-domain/src/csv_io.rs`
 * 的 `compliance::check` 那一支），它的 `params.value` 装的是**命中的红线词**，
 * 而 `RowFailure::from_geo` 原样透传 ⇒ 这是 Task 7 那条红线泄漏面的**第二次出现**
 * （复审 F-3a）。所以模板只说"含需改写的表述"，且 `mayEchoParamValue('not_allowed')`
 * 为 false，`errors.fragments.param_value` 那段也不会被追加。
 * 反面：`invalid_format` 的 `value` 是用户填的原始单元格内容（该显示的数据），
 * 它在 allowlist 里，照常追加。两条断言在 `src/api/errors.test.ts`。
 *
 * # `promptSet.notes.*`（裁定 B-6）
 *
 * 后端 `degradation_note()` 发的是 `degraded ` + 紧凑 JSON 的**单行 ASCII 机器行**
 * （`apps/desktop/src-tauri/src/services/prompt_service.rs`），字段是 `stage` / `code` / `params`。
 * 机器行不许原样显示给用户，由 `PromptSetPage` 按行分派到这里；散文行与老数据原样渲染。
 */
const prompt = {
  generate: {
    title: '生成题库',
    targetCount: '目标条数',
    repeatCount: '重复采样',
    industry: '行业模板',
    intents: '意图覆盖',
    submit: '生成题库',
    pipeline: '管线：模板展开 → AI 扩写 → 口语化改写 → 竞品同框 → 去重 → 版本化快照',
  },

  /**
   * 样本量纪律（产品文档第 4 节）。**告警标题本身**仍来自 `api/types.ts` 的
   * `SAMPLE_SIZE_WARNINGS`（复用后端 `SampleSizeGrade::warning_zh()`），归 Task 9。
   * 插值变量刻意不叫 `count`：i18next 见到 `count` 会走复数分支去找 `key_one`/`key_other`。
   */
  sampleSize: {
    detail: '当前题库共 {{total}} 条 prompt。建议补齐到 {{target}} 条以上再对外汇报分数。',
  },

  table: {
    intent: '意图',
    weight: '权重',
    weightAria: '权重 {{text}}',
    group: '分组',
    tags: '标签',
    source: '来源',
    competitors: '同框竞品',
    repeatCount: '采样',
    repeatCountAria: '采样次数 {{text}}',
    deleteHint: '删除后不可恢复，可先导出 CSV 备份',
    empty: '题库为空，点上方「生成题库」开始',
  },

  editor: {
    addTitle: '新增 prompt',
    editTitle: '编辑 prompt',
    text: 'Prompt 文本',
    textRequired: '请输入 prompt 文本',
    textTooLong: '不能超过 {{max}} 字',
    intent: '意图',
    intentRequired: '请选择意图',
    weight: '权重',
    weightTooltip: '1–5，核心词加权，越高越先采集',
    repeatCount: '采样次数',
    repeatCountTooltip: '1–3，P0-B 采集时这条 prompt 重复问几次',
    group: '分组',
    groupTooltip: '留空则按意图自动归组',
    groupPlaceholder: '留空按意图归组',
    tags: '标签',
    tagsTooltip: '输入后回车添加；生成管线打的标签（如「竞品同框」）也在这里改',
    tagsPlaceholder: '输入标签后回车',
  },

  /** 建项向导第 5 步。`MIN_COMPETITORS` / `MAX_COMPETITORS` 由组件传入插值。 */
  competitors: {
    intro:
      '填写 {{min}}–{{max}} 家直接竞品。题库会自动生成「本品牌 vs 竞品」同框 prompt，用于后续计算 Share of Voice。',
    tooFew: '至少填写 {{min}} 家竞品（当前 {{current}} 家）',
    tooFewDetail: '竞品不足会导致「品牌对比」类 prompt 无法覆盖，SOV 指标不可用。',
    tooMany: '竞品不能超过 {{max}} 家',
    nameTooLong: '竞品名称不能超过 {{max}} 字',
    namePlaceholder: '竞品名称',
    websitePlaceholder: '竞品官网（可选）',
    removeAria: '删除该竞品',
    add: '添加竞品',
  },

  csv: {
    export: '导出 CSV',
    import: '导入 CSV',
    exportPreviewTitle: '导出 CSV 预览',
    download: '下载文件',
    exported: 'CSV 已导出：{{path}}',
    exportHint: '共 {{lines}} 行（含表头 {{columns}} 列），UTF-8 带 BOM，可直接用 Excel 打开。',
    confirmImport: '确认导入',
    emptyWarning: '请先粘贴 CSV 内容',
    importHint: '表头必须是：{{header}}。导入会替换当前题库条目，并生成新的内容哈希。',
    importPlaceholder:
      'text,intent,weight,group_name,tags,source,repeat_count\n宏宇泵业靠谱吗？,purchase_recommendation,3,选购推荐,,manual,1',
    importSummary: '导入 {{imported}} 条，失败 {{failed}} 行',
    /** 行错误的**外壳**（裁定 B-5）：语序在两种语言里不同，所以不许在组件里拼接。 */
    rowError: '第 {{row}} 行：{{detail}}',
    reasons: {
      required: '必填的 prompt 文本为空',
      too_long: 'prompt 文本超过 {{limit}} 字上限',
      not_allowed: '含广告法禁用表述，请改写后再提交',
      invalid_format: '这一格的内容格式不正确',
      out_of_range: '数值超出允许范围（{{expected}}）',
    },
  },

  promptSet: {
    notes: {
      degraded: '{{stage}}未成功，本轮题目改由行业模板与本地改写补足（{{detail}}）',
      stage: {
        expansion: 'AI 扩写',
        rewrite: '口语化改写',
      },
    },
  },
};

export default prompt;
