//! 服务层错误站点的**结构性守卫**（Plan A Task 5 · 裁定 R-H 第三档）。
//!
//! 逐站点用例（`tests/*.rs` 的 params 级断言与各文件的表驱动用例）钉的是「今天这 41 处
//! 映射对不对」；本文件钉的是一件更耐时间的事：**以后谁在服务层新写一个中文 reason 站点，
//! 立刻红**。Task 3 复审 I-1 的教训是「映射写错了没人知道」，Task 5 把服务层站点里那批
//! 中文字面量 reason 全换成目录 key 之后（42 → 41 处，账见
//! [`the_guard_sees_every_production_site`] 的文档注释），回归的方向只有一个——
//! 有人图省事把散文写回去。
//!
//! ## 判据
//!
//! 含 `GeoError::validation(` / `GeoError::conflict(` / `GeoError::config(` /
//! `IpcError::new(` / `IpcError::with_params(` 的行，连同**它所属的那条语句**
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
//! `src/state.rs` + `src/services/` 整棵树。`src/ipc/**` 与 `src/error.rs` **不在**
//! 覆盖内：前者今天没有这 5 类站点（`ipc/export.rs` 走的是 `IpcError::internal`，
//! 属另一条待收口的链路，见 task-5-report），后者的站点全在 `#[cfg(test)]` 夹具里。

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
        "services/templates/mod.rs",
        include_str!("../src/services/templates/mod.rs"),
    ),
    (
        "services/templates/catalog.rs",
        include_str!("../src/services/templates/catalog.rs"),
    ),
];

/// 站点判据：这 5 个构造子是服务层能发出 `code + params` 的全部入口。
///
/// `GeoError::not_found(kind, id)` 不在列——它的两个参数都是数据（资源类别 + ID），
/// 没有 reason 可写散文；`IpcError::internal` 也不在列（裁定 §I 另行收口）。
const SITE_PATTERNS: &[&str] = &[
    "GeoError::validation(",
    "GeoError::conflict(",
    "GeoError::config(",
    "IpcError::new(",
    "IpcError::with_params(",
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
#[test]
fn the_guard_sees_every_production_site() {
    let expected: &[(&str, usize)] = &[
        ("state.rs", 3),
        ("services/mod.rs", 0),
        ("services/project_service.rs", 10),
        ("services/project_transfer.rs", 2),
        ("services/prompt_service.rs", 14),
        ("services/entity_card_service.rs", 2),
        ("services/settings_service.rs", 10),
        ("services/templates/mod.rs", 0),
        ("services/templates/catalog.rs", 0),
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
    assert_eq!(total, 41, "服务层生产站点总数");
    assert_eq!(FILES.len(), expected.len(), "FILES 与期望表要一一对应");
}
