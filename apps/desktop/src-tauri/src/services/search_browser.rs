//! 百度站长「路径 C：控制系统 Chrome（CDP）」的用户在场取数。
//!
//! 只读取用户**自己已登录**的 Chrome/Edge 里当前可见页面的 `<table>`：
//! 不代登录、不输入账号密码、不绕验证码、不调用私有 XHR、不读 cookie / localStorage。
//! 会话留在本机独立 profile（`AppState::browser_profile_dir`），不进数据库。
//!
//! 🔴 列映射不在这里重写：抽出的 TSV 一律交给既有的
//! [`SearchService::import_metrics`]，与文件 / 粘贴导入共用同一个解析器。

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use geo_domain::{parse_search_table, GeoError, ParseInput, ProjectId, SearchSourceKind};
use serde::Serialize;

use crate::error::IpcError;
use crate::services::search_service::SearchMetricImportResult;
use crate::services::SearchService;
use crate::state::AppState;

/// Chrome 调试端口就绪的最长等待。
pub const CHROME_START_TIMEOUT: Duration = Duration::from_secs(20);

/// 百度搜索资源平台的传统面入口。
pub const BAIDU_ZIYUAN_URL: &str = "https://ziyuan.baidu.com/";
/// 百度搜索资源平台的 AI 流量分析入口。
pub const BAIDU_ZIYUAN_AI_URL: &str = "https://ziyuan.baidu.com/aiflow/index";

/// `search_browser_open` 的返回体。Chrome 不在这里关闭：用户要继续在同一窗口里操作。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchBrowserSession {
    /// CDP 的浏览器级 WebSocket 地址（`/json/version` 的 `webSocketDebuggerUrl`）。
    pub ws_url: String,
    /// 本机独立 profile 目录，会话留在这里，不进数据库。
    pub profile_dir: String,
    /// 启动时打开的页面。
    pub target_url: String,
}

/// 只有百度站长的两个面允许走系统浏览器取数。
pub fn browser_target_url(kind: SearchSourceKind) -> Option<&'static str> {
    match kind {
        SearchSourceKind::BaiduZiyuan => Some(BAIDU_ZIYUAN_URL),
        SearchSourceKind::BaiduZiyuanAi => Some(BAIDU_ZIYUAN_AI_URL),
        _ => None,
    }
}

/// 每个 kind 一个独立 profile：传统面与 AI 面不共享登录态窗口。
pub fn profile_dir_for(base: &Path, kind: SearchSourceKind) -> PathBuf {
    base.join(kind.as_str())
}

/// 只收集**可见**的 `<table>`，每张表转成「表头 + 行」的 TSV。
///
/// 单元格取 `innerText`，压掉换行与制表符；空行丢弃。脚本只读 DOM，
/// 不碰 cookie / localStorage / 网络接口。
pub fn extract_visible_tables_script() -> &'static str {
    r#"(() => {
  const clean = (value) => (value || '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && style.opacity !== '0';
  };
  const tables = Array.from(document.querySelectorAll('table'))
    .filter(visible)
    .map((table) => Array.from(table.querySelectorAll('tr'))
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map((cell) => clean(cell.innerText || cell.textContent));
        while (cells.length > 0 && cells[cells.length - 1] === '') {
          cells.pop();
        }
        return cells.join('\t');
      })
      .filter((line) => line.trim() !== '')
      .join('\n'))
    .filter((text) => text !== '');
  // 🔴 `Tab::evaluate` 固定 `return_by_value: false`：数组只会回 objectId。
  // 回一个字符串，`RemoteObject.value` 才拿得到内容。
  return JSON.stringify(tables);
})()"#
}

/// 取 TSV 的第一行作为表头；空表 / 全空白返回 `None`。
pub fn tsv_header(table: &str) -> Option<Vec<String>> {
    let line = table.lines().next()?;
    let header: Vec<String> = line
        .split('\t')
        .map(|cell| cell.trim().to_string())
        .collect();
    if header.iter().all(|cell| cell.is_empty()) {
        None
    } else {
        Some(header)
    }
}

/// 保留表头能被既有解析器识别的表（顺序不变）。
///
/// 识别逻辑直接委托 `geo-domain::parse_search_table`（只喂表头），
/// 因此这里不存在第二套列映射。
pub fn pick_candidate_tables(tables: &[String]) -> Vec<String> {
    tables
        .iter()
        .filter(|table| header_is_recognized(table))
        .cloned()
        .collect()
}

/// 表头识别直接委托既有解析器：只喂第一行，`Ok` 即「这个表头我们认识」。
fn header_is_recognized(table: &str) -> bool {
    let Some(header) = tsv_header(table) else {
        return false;
    };
    let payload = header.join("\t");
    parse_search_table(ParseInput {
        payload: &payload,
        project_id: ProjectId::new(),
        kind: SearchSourceKind::BaiduZiyuanAi,
        period_start: "2000-01-01",
        period_end: "2000-01-01",
        data_through: "2000-01-01",
        imported_at: DateTime::<Utc>::from_timestamp(0, 0).expect("epoch 恒可构造"),
    })
    .is_ok()
}

/// 每张候选表的行级失败摘要。
#[derive(Debug, Clone)]
pub struct TableFailure {
    pub table: usize,
    pub reason: String,
    pub rows: Option<serde_json::Value>,
}

/// 所有候选表都失败时的稳定错误：`validation/failed { field: "payload", reason: "parse_failed" }`。
pub fn table_failures_error(failures: &[TableFailure]) -> IpcError {
    let tables: Vec<serde_json::Value> = failures
        .iter()
        .map(|failure| {
            let mut entry = serde_json::json!({
                "table": failure.table,
                "reason": failure.reason,
            });
            if let Some(rows) = &failure.rows {
                entry["rows"] = rows.clone();
            }
            entry
        })
        .collect();
    IpcError::with_params(
        "validation/failed",
        [
            ("field", "payload"),
            ("reason", "parse_failed"),
            ("value", ""),
        ],
    )
    .with_detail(serde_json::json!({ "tables": tables }))
}

/// `ws_url` 只接受**回环**的 WebSocket 地址；不合法时不发起连接（P2-05）。
///
/// `ws_url` 是前端回传的入参，只校验 scheme 的话，一个被诱导 / 被篡改的地址就能让本进程
/// 把 CDP 会话连到外网主机的调试口上（连带把 profile 里的百度登录态交到远端手里）。
/// 因此 host 必须是 `127.0.0.1` / `localhost` / `[::1]`；其余一律 `invalid_ws_url`，
/// 沿用既有稳定错误码，不新增契约条目。
pub fn validate_ws_url(ws_url: &str) -> Result<(), IpcError> {
    let invalid = || browser_error("invalid_ws_url");
    let parsed = url::Url::parse(ws_url.trim()).map_err(|_| invalid())?;
    let scheme_is_ws = matches!(parsed.scheme(), "ws" | "wss");
    let host_is_loopback = match parsed.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if scheme_is_ws && host_is_loopback {
        Ok(())
    } else {
        Err(invalid())
    }
}

/// 区间必须是 `YYYY-MM-DD` 且起点不晚于终点。
pub fn validate_period(period_start: &str, period_end: &str) -> Result<(), IpcError> {
    for (field, value) in [("period_start", period_start), ("period_end", period_end)] {
        if !super::search_service::is_date(value) {
            return Err(GeoError::validation(field, "invalid_format")
                .with_param("value", value)
                .into());
        }
    }
    if period_start > period_end {
        return Err(GeoError::validation("period_start", "out_of_range")
            .with_param("value", period_start)
            .with_param("expected", format!("<={period_end}"))
            .into());
    }
    Ok(())
}

fn free_loopback_port() -> Result<u16, IpcError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(GeoError::Io)?;
    let port = listener.local_addr().map_err(GeoError::Io)?.port();
    drop(listener);
    Ok(port)
}

/// 系统 Chrome 的启动参数（纯函数，便于测试钉住安全约束）。
///
/// 🔴 这里**刻意不带** `--remote-allow-origins`（P1-01）。取证（2026-11-07，本机 registry 源码）：
/// - tungstenite 0.29.0 `src/client.rs:223-246`（`impl IntoClientRequest for Uri`）构造的握手请求
///   只有 `Host` / `Connection` / `Upgrade` / `Sec-WebSocket-Version` / `Sec-WebSocket-Key` 五个头，
///   **不放 `Origin`**；`&str` 也是先转 `Uri` 走同一条路（同文件 `199-203`）；
/// - tungstenite 0.29.0 `src/handshake/client.rs:112-197`（`generate_request`）只写这五个必需头
///   （`124-125` 的 `WEBSOCKET_HEADERS`）再加调用方自带的头；`184-185` 的
///   `if name == "origin" { name = "Origin" }` 只是大小写归一，不会凭空加头；
/// - headless_chrome 1.0.22 `src/browser/transport/web_socket_connection.rs:232` 用
///   `tungstenite::client::connect_with_config(ws_url.as_str(), …)` 连接，走的正是这条无 Origin 的路径
///   （该 crate 自己启动 Chrome 时也从不传 `--remote-allow-origins`）。
///
/// 结论：Chrome 的 origin 白名单只作用于**带 `Origin` 的**握手，对本进程毫无意义；
/// 开 `*` 只会把带着客户登录态的调试端口对本机任意网页敞开，故不开通配。
pub fn chrome_launch_args(port: u16, profile_dir: &Path, target_url: &str) -> Vec<String> {
    vec![
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", profile_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        target_url.to_string(),
    ]
}

/// 启动系统 Chrome/Edge 并把调试 WebSocket 地址交还给前端。
pub async fn browser_open(
    state: &AppState,
    project_id: ProjectId,
    kind: SearchSourceKind,
) -> Result<SearchBrowserSession, IpcError> {
    let target_url = browser_target_url(kind).ok_or_else(|| kind_error(kind))?;
    SearchService::from_state(state)
        .require_project(project_id)
        .await?;
    let executable = headless_chrome::browser::default_executable()
        .map_err(|_| browser_error("chrome_not_found"))?;
    let profile_dir = profile_dir_for(&state.browser_profile_dir, kind);
    std::fs::create_dir_all(&profile_dir).map_err(GeoError::Io)?;
    let port = free_loopback_port()?;

    // 只打开页面，不代登录：用户在真实窗口里自己完成扫码 / 登录。
    // 不 kill 子进程：Chrome 要继续开着，用户还要在同一个窗口里操作。
    Command::new(executable)
        .args(chrome_launch_args(port, &profile_dir, target_url))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| browser_error("launch_failed"))?;

    let ws_url = wait_for_ws_url(port).await?;
    Ok(SearchBrowserSession {
        ws_url,
        profile_dir: profile_dir.display().to_string(),
        target_url: target_url.to_string(),
    })
}

/// 连接已打开的系统 Chrome，读取当前可见表格并交给既有导入管线。
pub async fn browser_capture(
    state: &AppState,
    project_id: ProjectId,
    kind: SearchSourceKind,
    ws_url: String,
    period_start: String,
    period_end: String,
    now: DateTime<Utc>,
) -> Result<SearchMetricImportResult, IpcError> {
    browser_target_url(kind).ok_or_else(|| kind_error(kind))?;
    validate_ws_url(&ws_url)?;
    validate_period(&period_start, &period_end)?;

    let service = SearchService::from_state(state);
    service.require_project(project_id).await?;

    let tables = tokio::task::spawn_blocking(move || read_visible_tables(&ws_url))
        .await
        .map_err(|_| browser_error("browser_task_failed"))??;
    let candidates = pick_candidate_tables(&tables);

    if candidates.is_empty() && tables.is_empty() {
        // 页面上一个可见 `<table>` 都没有：多半是停在首页 / 登录页 / 图表页。
        return Err(browser_error("no_table_found"));
    }
    if candidates.is_empty() {
        let failures: Vec<TableFailure> = tables
            .iter()
            .enumerate()
            .map(|(index, table)| TableFailure {
                table: index,
                reason: "missing_header".to_string(),
                rows: tsv_header(table).map(|header| serde_json::json!({ "header": header })),
            })
            .collect();
        return Err(table_failures_error(&failures));
    }

    let mut failures = Vec::new();
    let mut empty_success = None;
    for (index, table) in candidates.iter().enumerate() {
        match service
            .import_metrics(
                project_id,
                kind,
                table.clone(),
                period_start.clone(),
                period_end.clone(),
                now,
            )
            .await
        {
            Ok(result) => {
                if !result.metrics.is_empty() || !result.ai_overviews.is_empty() {
                    return Ok(result);
                }
                // 识别得出表头、但页面上还没有数据行：先记下，继续找有数据的那张表。
                empty_success.get_or_insert(result);
            }
            Err(error) => failures.push(TableFailure {
                table: index,
                reason: error
                    .params
                    .get("reason")
                    .cloned()
                    .unwrap_or_else(|| error.code.clone()),
                rows: error.detail.clone(),
            }),
        }
    }

    if let Some(result) = empty_success {
        return Ok(result);
    }
    Err(table_failures_error(&failures))
}

async fn wait_for_ws_url(port: u16) -> Result<String, IpcError> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| browser_error("debug_port_unavailable"))?;
    let url = format!("http://127.0.0.1:{port}/json/version");
    let deadline = Instant::now() + CHROME_START_TIMEOUT;
    loop {
        if let Ok(response) = client.get(&url).send().await {
            if let Ok(value) = response.json::<serde_json::Value>().await {
                if let Some(ws_url) = value
                    .get("webSocketDebuggerUrl")
                    .and_then(|value| value.as_str())
                    .filter(|value| !value.is_empty())
                {
                    return Ok(ws_url.to_string());
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(browser_error("debug_port_timeout"));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn read_visible_tables(ws_url: &str) -> Result<Vec<String>, IpcError> {
    // 测试 / CI 不连真实浏览器（AGENTS 规则 2 的同款开关，照 `services/browser.rs`）。
    if std::env::var_os("GEO_DISABLE_BROWSER").is_some() {
        return Err(browser_error("browser_disabled"));
    }
    let browser = headless_chrome::Browser::connect(ws_url.to_string())
        .map_err(|_| browser_error("connect_failed"))?;
    let tabs = browser
        .get_tabs()
        .lock()
        .map_err(|_| browser_error("connect_failed"))?
        .clone();
    let tab = tabs
        .iter()
        .find(|tab| tab.get_url().contains("ziyuan.baidu.com"))
        .or_else(|| tabs.first())
        .cloned()
        .ok_or_else(|| browser_error("no_tab"))?;

    let object = tab
        .evaluate(extract_visible_tables_script(), false)
        .map_err(|_| browser_error("evaluate_failed"))?;
    let value = object
        .value
        .ok_or_else(|| browser_error("evaluate_failed"))?;
    parse_tables_payload(&value)
}

/// 把脚本回的 JSON 字符串还原成表格列表。非字符串 / 坏 JSON 一律 `evaluate_failed`
/// （不回显页面内容）。
pub fn parse_tables_payload(value: &serde_json::Value) -> Result<Vec<String>, IpcError> {
    let raw = value
        .as_str()
        .ok_or_else(|| browser_error("evaluate_failed"))?;
    serde_json::from_str(raw).map_err(|_| browser_error("evaluate_failed"))
}

fn kind_error(kind: SearchSourceKind) -> IpcError {
    GeoError::validation("kind", "not_allowed")
        .with_param("value", kind.as_str())
        .into()
}

/// 浏览器侧的失败统一走 `browser/unavailable`，`reason` 是稳定子原因。
/// 前端词典会把子原因渲染成可操作提示；不再用 `validation/failed + not_allowed`
/// 把真实原因藏掉（否则用户只会看到“系统浏览器不被允许”）。
fn browser_error(reason: &str) -> IpcError {
    IpcError::with_params("browser/unavailable", [("reason", reason)])
}

#[cfg(test)]
mod tests {
    use super::*;

    const AI_TABLE: &str =
        "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n除尘设备\t12\t300\t4\t33.33%";
    const PAGE_TABLE: &str =
        "页面\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n/products/a\t3\t20\t1\t33.33%";
    const CANONICAL_TABLE: &str = "query\timpressions\tclicks\tctr_check\nfilter bag\t80\t4\t0.05";
    const UNRELATED_TABLE: &str = "指标\t数值\n收录量\t120";

    #[test]
    fn target_urls_match_the_two_baidu_surfaces() {
        assert_eq!(
            browser_target_url(SearchSourceKind::BaiduZiyuan),
            Some("https://ziyuan.baidu.com/")
        );
        assert_eq!(
            browser_target_url(SearchSourceKind::BaiduZiyuanAi),
            Some("https://ziyuan.baidu.com/aiflow/index")
        );
    }

    #[test]
    fn only_the_two_baidu_kinds_are_allowed() {
        for kind in SearchSourceKind::all() {
            let allowed = matches!(
                kind,
                SearchSourceKind::BaiduZiyuan | SearchSourceKind::BaiduZiyuanAi
            );
            assert_eq!(
                browser_target_url(kind).is_some(),
                allowed,
                "{}",
                kind.as_str()
            );
        }
    }

    #[test]
    fn profile_dir_is_scoped_per_kind() {
        let base = Path::new("/tmp/profile");
        assert_eq!(
            profile_dir_for(base, SearchSourceKind::BaiduZiyuan),
            PathBuf::from("/tmp/profile/baidu_ziyuan")
        );
        assert_eq!(
            profile_dir_for(base, SearchSourceKind::BaiduZiyuanAi),
            PathBuf::from("/tmp/profile/baidu_ziyuan_ai")
        );
    }

    #[test]
    fn extract_script_only_reads_visible_tables_and_emits_tsv() {
        let script = extract_visible_tables_script();
        assert!(script.contains("querySelectorAll('table')"));
        assert!(script.contains("innerText"));
        assert!(script.contains("getBoundingClientRect"));
        assert!(script.contains("\\t"));
        // 🔴 不碰会话与私有接口。
        for forbidden in ["cookie", "localStorage", "sessionStorage", "fetch("] {
            assert!(!script.contains(forbidden), "脚本不得读取 {forbidden}");
        }
    }

    /// `headless_chrome::Tab::evaluate` 把 `return_by_value` 写死成 `false`：
    /// 数组结果只回 objectId、`RemoteObject.value` 是 `None`。所以脚本必须回**字符串**。
    #[test]
    fn extract_script_returns_a_json_string_not_an_array() {
        let script = extract_visible_tables_script();
        assert!(
            script.contains("JSON.stringify"),
            "脚本必须以 JSON 字符串返回，否则 RemoteObject.value 为空"
        );
    }

    #[test]
    fn parse_tables_payload_accepts_a_json_string() {
        // JSON 字符串里的 \t / \n 是转义字符，解析出来是真正的制表符与换行。
        let value = serde_json::json!("[\"a\\tb\\n1\\t2\"]");
        assert_eq!(
            parse_tables_payload(&value).expect("JSON 字符串可解析"),
            vec!["a\tb\n1\t2".to_string()]
        );
        assert_eq!(
            parse_tables_payload(&serde_json::json!("[]")).expect("空数组"),
            Vec::<String>::new()
        );
        // 非字符串 / 坏 JSON：都是稳定的 `evaluate_failed`，不把页面内容带进错误。
        for broken in [serde_json::json!(1), serde_json::json!("not json")] {
            let error = parse_tables_payload(&broken).expect_err("必须失败");
            assert_eq!(error.code, "browser/unavailable");
            assert_eq!(error.params["reason"], "evaluate_failed");
        }
    }

    #[test]
    fn tsv_header_trims_cells_and_rejects_blank_tables() {
        assert_eq!(
            tsv_header(" 关键词 \t AI引用量 \n除尘\t1"),
            Some(vec!["关键词".to_string(), "AI引用量".to_string()])
        );
        assert_eq!(tsv_header(""), None);
        assert_eq!(tsv_header("   \n x"), None);
    }

    #[test]
    fn pick_candidate_tables_accepts_baidu_ai_five_columns() {
        let picked = pick_candidate_tables(&[AI_TABLE.to_string()]);
        assert_eq!(picked, vec![AI_TABLE.to_string()]);
    }

    #[test]
    fn pick_candidate_tables_accepts_page_and_canonical_headers() {
        let picked = pick_candidate_tables(&[PAGE_TABLE.to_string(), CANONICAL_TABLE.to_string()]);
        assert_eq!(
            picked,
            vec![PAGE_TABLE.to_string(), CANONICAL_TABLE.to_string()]
        );
    }

    #[test]
    fn pick_candidate_tables_drops_unrecognized_tables() {
        let picked = pick_candidate_tables(&[
            UNRELATED_TABLE.to_string(),
            AI_TABLE.to_string(),
            "".to_string(),
        ]);
        assert_eq!(picked, vec![AI_TABLE.to_string()]);
        assert!(pick_candidate_tables(&[UNRELATED_TABLE.to_string()]).is_empty());
    }

    #[test]
    fn parse_failed_error_carries_per_table_row_errors() {
        let error = table_failures_error(&[TableFailure {
            table: 1,
            reason: "invalid_format".to_string(),
            rows: Some(serde_json::json!([
                {"row": 3, "reason": "invalid_format", "params": {"column": "AI点击量", "value": "--"}}
            ])),
        }]);

        assert_eq!(error.code, "validation/failed");
        assert_eq!(error.params["field"], "payload");
        assert_eq!(error.params["reason"], "parse_failed");
        let detail = error.detail.expect("detail 必须带每张表的行级摘要");
        assert_eq!(detail["tables"][0]["table"], 1);
        assert_eq!(detail["tables"][0]["rows"][0]["row"], 3);
    }

    #[test]
    fn capture_rejects_non_ws_urls_without_connecting() {
        let error = validate_ws_url("http://127.0.0.1:9222/devtools/browser/x")
            .expect_err("http 不是 WebSocket 地址");
        assert_eq!(error.code, "browser/unavailable");
        assert_eq!(error.params["reason"], "invalid_ws_url");
        assert!(validate_ws_url("ws://127.0.0.1:9222/devtools/browser/x").is_ok());
        assert!(validate_ws_url("wss://127.0.0.1:9222/devtools/browser/x").is_ok());
        assert!(validate_ws_url("").is_err());
    }

    /// P2-05：`ws_url` 来自前端入参，只校验 scheme 的话，被诱导的地址能把 CDP 会话
    /// 连到外网主机（连带把 profile 里的登录态暴露给远端调试口）。host 必须是回环。
    #[test]
    fn capture_rejects_non_loopback_ws_hosts_without_connecting() {
        for rejected in [
            "ws://evil.example:9222/devtools/browser/x",
            "wss://evil.example/devtools/browser/x",
            "ws://192.168.1.20:9222/devtools/browser/x",
            "ws://10.0.0.8:9222/x",
            // 看着像回环、其实是外部域名
            "ws://127.0.0.1.evil.example:9222/x",
            "ws://localhost.evil.example:9222/x",
            // 没有 host
            "ws:///devtools/browser/x",
        ] {
            let error = validate_ws_url(rejected).expect_err("非回环 host 必须被拒");
            assert_eq!(error.code, "browser/unavailable", "{rejected}");
            assert_eq!(error.params["reason"], "invalid_ws_url", "{rejected}");
        }
        for accepted in [
            "ws://127.0.0.1:9222/devtools/browser/x",
            "wss://127.0.0.1:9222/devtools/browser/x",
            "ws://localhost:9222/devtools/browser/x",
            "ws://LocalHost:9222/devtools/browser/x",
            "ws://[::1]:9222/devtools/browser/x",
        ] {
            validate_ws_url(accepted).unwrap_or_else(|error| {
                panic!("{accepted} 应被接受：{} {:?}", error.code, error.params)
            });
        }
    }

    /// P1-01：客户端握手不带 `Origin`（取证见 `chrome_launch_args` 文档），
    /// 所以既不需要、也不允许开通配 origin 白名单。
    #[test]
    fn launch_args_do_not_open_the_devtools_origin_allowlist() {
        let args = chrome_launch_args(
            9222,
            Path::new("/data/browser-profile/baidu_ziyuan"),
            BAIDU_ZIYUAN_URL,
        );
        assert!(
            !args.iter().any(|arg| arg.contains("remote-allow-origins")),
            "不得给调试口开 origin 白名单（尤其不能是 `*`）：{args:?}"
        );
        assert!(
            args.iter().any(|arg| arg == "--remote-debugging-port=9222"),
            "{args:?}"
        );
        assert!(
            args.iter()
                .any(|arg| arg == "--user-data-dir=/data/browser-profile/baidu_ziyuan"),
            "{args:?}"
        );
        assert_eq!(
            args.last().map(String::as_str),
            Some(BAIDU_ZIYUAN_URL),
            "最后一个参数仍是要打开的百度站长页面：{args:?}"
        );
    }

    #[test]
    fn period_guard_rejects_bad_dates_and_reversed_ranges() {
        assert!(validate_period("2026-10-10", "2026-11-06").is_ok());
        assert_eq!(
            validate_period("2026-10-1", "2026-11-06")
                .expect_err("日期形状不对")
                .params["reason"],
            "invalid_format"
        );
        assert_eq!(
            validate_period("2026-11-07", "2026-11-06")
                .expect_err("起点晚于终点")
                .params["reason"],
            "out_of_range"
        );
    }

    #[test]
    fn free_port_binds_loopback_and_releases_it() {
        let port = free_loopback_port().expect("回环端口可取");
        assert!(port > 0);
        let listener = TcpListener::bind(("127.0.0.1", port)).expect("取到的端口应已释放");
        drop(listener);
    }
}
