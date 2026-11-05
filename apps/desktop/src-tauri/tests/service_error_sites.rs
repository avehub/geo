//! 服务层错误站点的**结构性守卫**（Plan A Task 5 · 裁定 R-H 第三档）。
//!
//! 逐站点用例（`tests/*.rs` 的 params 级断言与各文件的表驱动用例）钉的是「今天这 48 处
//! 映射对不对」；本文件钉的是一件更耐时间的事：**以后谁在服务层新写一个中文 reason 站点，
//! 立刻红**。Task 3 复审 I-1 的教训是「映射写错了没人知道」，Task 5 把服务层站点里那批
//! 中文字面量 reason 全换成目录 key 之后（42 → 41 处，账见
//! [`the_guard_sees_every_production_site`] 的文档注释），回归的方向只有一个——
//! 有人图省事把散文写回去。
//!
//! ## 判据
//!
//! 含 `GeoError::validation(` / `GeoError::conflict(` / `GeoError::config(` /
//! `IpcError::new(` / `IpcError::with_params(` / `IpcError::internal(` 的行，
//! 连同**它所属的那条语句**
//! （按括号配平切出，见 [`statement_span`]），不得含 CJK 字符（`[\u{4e00}-\u{9fa5}]`）。
//!
//! 两条边界，都是刻意的：
//!
//! 1. **只禁 CJK，不禁英文**：裁定 R-J 要求 `IpcError::new(code, msg)` 的 `msg` 保留
//!    英文兜底短句，所以英文是合法取值。
//! 2. **按语句切而不是按行切**：站点大量写成多行 `format!`（`GeoError::validation(\n
//!    "field",\n format!("…中文…"),\n )`），只扫命中行会让守卫在改造前就是绿的、
//!    等于没跑。配平从命中行开始数括号，直到深度回到 0。
//!
//! **只扫生产代码**：每个文件切到第一行恰好是 `#[cfg(test)]` 的那行为止
//! （与 `crates/geo-domain/tests/reason_key_sites.rs` 的 `production_sites` 同一约定）。
//! 测试夹具里出现中文 `value` 是**合法**的——生产环境的 params 值本来就可能是中文用户数据
//! （壳侧 `guard_instance_params_stay_ascii` 的文档注释写明了这条边界：它只约束
//! 我们自己的夹具与常量，而它约束的是 error.rs 那四张清单，不是这里）。
//! 例如 `degradation_note_escapes_non_ascii_values_and_round_trips_them` 就必须用
//! 中文值才能证明转义生效。
//!
//! 注释行（`//` / `///` / `//!` 开头）整行跳过：文档注释里当然要写中文。
//! **行尾注释不跳过**——命中行后面挂一句中文注释同样会红，这是想要的（把散文
//! 挪到注释里绕过守卫没有意义，`params` 的取值口径写在 `crates/geo-domain/src/error.rs`
//! 的目录注释里，不需要站点自带中文注解）。
//!
//! ## 覆盖范围
//!
//! `src/state.rs` + `src/services/` 整棵树 + `src/ipc/` 整棵树 + 壳的两个入口
//! （`src/lib.rs` / `src/main.rs`）。`src/error.rs` **不在**覆盖内：它的站点全在
//! `#[cfg(test)]` 夹具里。
//!
//! `ipc/**` 与两个入口是 Task 5b 补进来的（复审 Minor 1 / Minor 4a）。
//! `ipc/export.rs` 那三处 `IpcError::internal("中文…")` 能活到 Task 5 收尾，正是因为
//! 这里有两个缺口：`FILES` 没有 `ipc/**`、`SITE_PATTERNS` 没有 `internal(`——
//! **缺一不可**，只补任何一边守卫仍然扫不到它。`lib.rs` / `main.rs` 今天的生产站点数
//! 是 **0**，以「期望 0」写进逐文件计数表，是为了把「将来谁在壳入口直接
//! `IpcError::new(...)` 拼中文」变成一件会红的事。

/// 被扫描的生产文件。写死清单而不是 glob：`include_str!` 不支持 glob，
/// 而写死清单还有一个好处——新增服务文件时忘记加进来，
/// [`the_guard_sees_every_production_site`] 的总数断言不会红，但 review 时
/// 这张清单就是「哪些文件被守着」的唯一答案，因此加文件时必须同时改两处。
const FILES: &[(&str, &str)] = &[
    ("state.rs", include_str!("../src/state.rs")),
    ("services/mod.rs", include_str!("../src/services/mod.rs")),
    (
        "services/project_service.rs",
        include_str!("../src/services/project_service.rs"),
    ),
    (
        "services/project_transfer.rs",
        include_str!("../src/services/project_transfer.rs"),
    ),
    (
        "services/prompt_service.rs",
        include_str!("../src/services/prompt_service.rs"),
    ),
    (
        "services/entity_card_service.rs",
        include_str!("../src/services/entity_card_service.rs"),
    ),
    (
        "services/settings_service.rs",
        include_str!("../src/services/settings_service.rs"),
    ),
    (
        "services/keyword_service.rs",
        include_str!("../src/services/keyword_service.rs"),
    ),
    (
        "services/faq_service.rs",
        include_str!("../src/services/faq_service.rs"),
    ),
    (
        "services/kb_service.rs",
        include_str!("../src/services/kb_service.rs"),
    ),
    (
        "services/site_service.rs",
        include_str!("../src/services/site_service.rs"),
    ),
    (
        "services/site_patch_service.rs",
        include_str!("../src/services/site_patch_service.rs"),
    ),
    (
        "services/search_service.rs",
        include_str!("../src/services/search_service.rs"),
    ),
    (
        "services/templates/mod.rs",
        include_str!("../src/services/templates/mod.rs"),
    ),
    (
        "services/templates/catalog.rs",
        include_str!("../src/services/templates/catalog.rs"),
    ),
    // ---- Task 5b（裁定 A-4）：`ipc/` 整棵树 ----
    ("ipc/mod.rs", include_str!("../src/ipc/mod.rs")),
    ("ipc/export.rs", include_str!("../src/ipc/export.rs")),
    ("ipc/project.rs", include_str!("../src/ipc/project.rs")),
    ("ipc/prompt.rs", include_str!("../src/ipc/prompt.rs")),
    ("ipc/settings.rs", include_str!("../src/ipc/settings.rs")),
    ("ipc/secret.rs", include_str!("../src/ipc/secret.rs")),
    (
        "ipc/entity_card.rs",
        include_str!("../src/ipc/entity_card.rs"),
    ),
    ("ipc/keyword.rs", include_str!("../src/ipc/keyword.rs")),
    ("ipc/faq.rs", include_str!("../src/ipc/faq.rs")),
    ("ipc/kb.rs", include_str!("../src/ipc/kb.rs")),
    ("ipc/site.rs", include_str!("../src/ipc/site.rs")),
    (
        "ipc/site_patch.rs",
        include_str!("../src/ipc/site_patch.rs"),
    ),
    ("ipc/search.rs", include_str!("../src/ipc/search.rs")),
    // ---- Task 5b（裁定 A-4b，复审 Minor 4a）：壳的两个入口，期望站点数 0 ----
    ("lib.rs", include_str!("../src/lib.rs")),
    ("main.rs", include_str!("../src/main.rs")),
];

/// 站点判据：这 6 个构造子是壳侧能发出 `code + params`（或 `code + message`）的全部入口。
///
/// `GeoError::not_found(kind, id)` 不在列——它的两个参数都是数据（资源类别 + ID），
/// 没有 reason 可写散文。
///
/// `IpcError::internal(` 是 Task 5b 补进来的：裁定 §I 当初把它记为「另行收口」，
/// 那次收口就是本任务（A-2 之后它只剩一个合法用法——语言中立的紧凑兜底串）。
/// 不列进来，`FILES` 里加了 `ipc/**` 也扫不到 `ipc/export.rs`。
const SITE_PATTERNS: &[&str] = &[
    "GeoError::validation(",
    "GeoError::conflict(",
    "GeoError::config(",
    "IpcError::new(",
    "IpcError::with_params(",
    "IpcError::internal(",
];

fn is_cjk(character: char) -> bool {
    ('\u{4e00}'..='\u{9fa5}').contains(&character)
}

fn is_comment_line(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// 切出生产代码部分：到第一行**恰好**是 `#[cfg(test)]` 的行为止。
///
/// 按整行比对而不是 `source.split("#[cfg(test)]")`：`project_service.rs` 的文档注释里
/// 就提到了 `#[cfg(test)]` 这个字符串，子串切分会切在注释上。
fn production_lines(source: &str) -> Vec<&str> {
    source
        .lines()
        .take_while(|line| line.trim() != "#[cfg(test)]")
        .collect()
}

/// 一条语句最多跨多少行。站点全是普通调用表达式，实际最长 5 行；
/// 这个上限只是防呆：万一某行的括号数不平衡（例如守卫被扩到含跨行字符串常量的文件），
/// 配平永远回不到 0，扫描会一路吃到文件末尾，把无关的中文（`EXPANSION_SYSTEM`
/// 这类提示词常量）误判成站点散文。截断比误报好，30 行足够宽。
const MAX_SPAN_LINES: usize = 30;

/// 一行里 ASCII 括号的净增减。跳过双引号字符串与转义，
/// 否则 `"("` 这种字面量会把深度数错（全角括号本来就不参与配平）。
fn paren_delta(line: &str) -> i32 {
    let mut depth = 0;
    let mut in_string = false;
    let mut escaped = false;
    for character in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' if in_string => escaped = true,
            '"' => in_string = !in_string,
            '(' if !in_string => depth += 1,
            ')' if !in_string => depth -= 1,
            _ => {}
        }
    }
    depth
}

/// 从 `start` 行开始按括号配平切出整条语句，返回跨到的行号（含 `start`）。
///
/// **必须按语句切而不是按行切**：站点大量写成多行 `format!`
/// （`GeoError::validation(\n "field",\n format!("…中文…"),\n )`），
/// 只扫命中行的话，守卫在改造**之前**就是绿的，等于没跑。
///
/// 配平以命中行为起点：该行开头的深度算 0，深度回到 0 即语句结束。
/// 命中行本身处在外层调用中间时（`return Err(\n GeoError::validation(…)`），
/// 起点深度记 0 会让 span 恰好覆盖这次调用的实参——那正是散文唯一可能出现的地方。
fn statement_span(lines: &[&str], start: usize) -> Vec<usize> {
    let mut depth: i32 = 0;
    let mut span = Vec::new();
    for (offset, line) in lines.iter().enumerate().skip(start).take(MAX_SPAN_LINES) {
        span.push(offset);
        depth += paren_delta(line);
        if depth <= 0 {
            break;
        }
    }
    span
}

/// 逐文件逐站点扫描，返回所有含 CJK 的站点（`文件:行号` + 原文）。
fn chinese_sites() -> Vec<String> {
    let mut offenders = Vec::new();
    for (name, source) in FILES {
        let lines = production_lines(source);
        for (index, line) in lines.iter().enumerate() {
            if is_comment_line(line) || !SITE_PATTERNS.iter().any(|p| line.contains(p)) {
                continue;
            }
            let span = statement_span(&lines, index);
            let text: Vec<&str> = span.iter().map(|at| lines[*at]).collect();
            if text.iter().any(|line| line.chars().any(is_cjk)) {
                offenders.push(format!("{name}:{}\n{}", index + 1, text.join("\n")));
            }
        }
    }
    offenders
}

#[test]
fn service_error_sites_carry_no_chinese_prose() {
    let offenders = chinese_sites();
    assert!(
        offenders.is_empty(),
        "服务层错误站点里还有中文散文（{} 处）：\n\n{}\n\n\
         reason 一律用 `crates/geo-domain/src/error.rs` 目录里的 key，\n\
         配套参数用 `with_param`（`limit` / `expected` / `value`），\n\
         面向用户的文案由前端词典按 locale 渲染（AGENTS 规则 7 / 裁定 R-J）。\n\
         `IpcError::new` 的兜底 message 只允许英文短句。",
        offenders.len(),
        offenders.join("\n---\n")
    );
}

/// 防空跑：守卫必须真的看见全部生产站点。
///
/// 逐站点用例的盲区是「站点被删/被改名后用例还绿」，本守卫的盲区则是
/// 「`include_str!` 路径写错、或 `SITE_PATTERNS` 里的构造子被换名，
/// 于是一条 CJK 都扫不到、断言永真」。这里把每个文件的站点数钉死：
/// 数字对不上就说明守卫的输入变了，必须同步。
///
/// 期望值 = Task 5 终态的**生产**站点数，与 `task-5-report.md` 的逐处清单同号。
///
/// ## 与 §A 事实 1 那份盘点对账（两套数字差在**判据**，不是差在站点）
///
/// §A 事实 1 数的是 46 处（`project_service` 11、`prompt_service` 16、`settings_service` 11、
/// `entity_card_service` 3、`project_transfer` 2、`state` 3），它的判据里**含**
/// `GeoError::not_found(`。本守卫的 [`SITE_PATTERNS`] 不含 `not_found`（理由见其文档注释），
/// 因此同一份 BASE（`d203e47`）代码按本守卫的判据只有 **42** 处 —— 差的 4 处全是
/// `not_found`：`project_service` 1、`prompt_service` 2、`entity_card_service` 1。
///
/// ## 42 → 41：一处收敛
///
/// `settings_service.rs` 原有**两处**逐字重复的「未知的模型服务商」（`update` 里一处、
/// `validate_settings` 里一处），本轮合并进 `unknown_provider_validation()` 单一来源：
/// −2 + 1（助手自身那一处）= **−1**。
///
/// `prompt_service.rs` 是 14 → 14，**成分**变了但净数不变：两处 `compliance/violation`
/// 的 `IpcError::new` 合并进 `compliance_violation()`（−2），同时该助手自身占一处（+1）、
/// `llm_ipc_error()` 里新增一处 `IpcError::new`（+1）。
///
/// 站点数变少是**收敛**，不是漏改——逐处 before → after 都在报告里对得上号。
///
/// ## 41 → 42：Task 5b 把 `ipc/**` 与壳入口纳入覆盖（裁定 A-4 / A-4b）
///
/// [`FILES`] 从 9 个文件涨到 18 个（`ipc/` 7 个 + `lib.rs` + `main.rs`），但站点数只有
/// `ipc/export.rs` 一处从 0 → **1**：
///
/// - 它原有 **3** 处 `IpcError::internal(`，其中 2 处按裁定 A-1 改走
///   `IpcError::from(GeoError::Io(..))`（code `io/failed`，OS / 库原文进 `reason`），
///   改完就**不再命中** [`SITE_PATTERNS`] 里的任何一项 —— 3 − 2 = 1；
/// - 剩下那 1 处是 oneshot 回调通道被 drop（裁定 A-2：code 仍为 `ipc/internal`，
///   message 换成语言中立紧凑串 `ipc/internal reason=dialog_channel_closed`）；
/// - 其余 8 个新文件都是 **0**：`ipc/` 另外 6 个文件只做参数搬运与 `?` 上抛，
///   `lib.rs` / `main.rs` 是装配入口（复审 Minor 4a 已核）。
///
/// ⇒ 41 + 1 = **42**。同一次改动里 `.set_title("导出")` 与 `tracing::info!("导出文件已写入")`
/// 两处 CJK **仍然留在** `ipc/export.rs`（裁定 A-5 授权保留：前者是原生对话框标题，
/// 正确修法要改 IPC 命令签名，属 Plan B；后者是日志，不是用户可见面）。它们不命中
/// [`SITE_PATTERNS`]，因此把该文件加进 [`FILES`] 之后守卫不会为它们红——这是预期的。
#[test]
fn the_guard_sees_every_production_site() {
    let expected: &[(&str, usize)] = &[
        ("state.rs", 3),
        ("services/mod.rs", 1),
        ("services/project_service.rs", 10),
        ("services/project_transfer.rs", 2),
        ("services/prompt_service.rs", 13),
        ("services/entity_card_service.rs", 2),
        ("services/settings_service.rs", 10),
        ("services/keyword_service.rs", 3),
        ("services/faq_service.rs", 3),
        ("services/kb_service.rs", 2),
        ("services/site_service.rs", 0),
        ("services/site_patch_service.rs", 5),
        ("services/search_service.rs", 8),
        ("services/templates/mod.rs", 0),
        ("services/templates/catalog.rs", 0),
        // Task 5b 新增（A-4）：`ipc/` 整棵树。只有 `export.rs` 有站点。
        ("ipc/mod.rs", 0),
        ("ipc/export.rs", 1),
        ("ipc/project.rs", 0),
        ("ipc/prompt.rs", 0),
        ("ipc/settings.rs", 0),
        ("ipc/secret.rs", 0),
        ("ipc/entity_card.rs", 0),
        ("ipc/keyword.rs", 0),
        ("ipc/faq.rs", 0),
        ("ipc/kb.rs", 0),
        ("ipc/site.rs", 0),
        ("ipc/site_patch.rs", 0),
        ("ipc/search.rs", 0),
        // Task 5b 新增（A-4b，复审 Minor 4a）：壳入口，以「期望 0」入表，
        // 将来谁在这里直接拼中文 message 就会红。
        ("lib.rs", 0),
        ("main.rs", 0),
    ];
    let mut total = 0;
    for (name, want) in expected {
        let source = FILES
            .iter()
            .find(|(file, _)| file == name)
            .unwrap_or_else(|| panic!("{name} 不在 FILES 清单里"))
            .1;
        let actual = production_lines(source)
            .iter()
            .filter(|line| !is_comment_line(line))
            .map(|line| SITE_PATTERNS.iter().filter(|p| line.contains(**p)).count())
            .sum::<usize>();
        assert_eq!(actual, *want, "{name} 的生产站点数变了，守卫清单要同步");
        total += actual;
    }
    assert_eq!(total, 63, "壳侧生产站点总数");
    assert_eq!(FILES.len(), expected.len(), "FILES 与期望表要一一对应");
}
