//! 导出落盘：走系统「另存为」对话框，由 Rust 侧写文件。
//!
//! 为什么不用 WebView 的 `<a download href="blob:">`：macOS 上 Tauri 用的是
//! WKWebView，它**不实现** blob URL 的 `download` 属性，点击后静默无反应，
//! 用户只看到「已导出」的提示却拿不到文件（spec FR-B2 也因此指定用
//! `tauri-plugin-dialog` 选路径）。所以导出统一收口到本命令：
//! 对话框选路径 → `tokio::fs::write` → 把最终路径回给前端展示。

use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use csv::ReaderBuilder;
use geo_domain::GeoError;
use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptions};
use rust_xlsxwriter::{Format, Workbook};
use tauri::{AppHandle, State};

use crate::state::AppState;
use tauri_plugin_dialog::DialogExt;

use crate::error::IpcError;

/// `export_write_file` 的落盘格式。缺省是纯文本（Markdown / HTML / JSON / CSV）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExportFormat {
    Text,
    Xlsx,
    Pdf,
}

/// 解析前端传来的 `format`：缺省 = `text`，未知值走冻结的 `validation/failed`。
pub(crate) fn parse_export_format(format: Option<&str>) -> Result<ExportFormat, IpcError> {
    match format {
        None | Some("text") => Ok(ExportFormat::Text),
        Some("xlsx") => Ok(ExportFormat::Xlsx),
        Some("pdf") => Ok(ExportFormat::Pdf),
        Some(value) => Err(IpcError::with_params(
            "validation/failed",
            [
                ("field", "format"),
                ("reason", "not_allowed"),
                ("value", value),
            ],
        )),
    }
}

/// 把 CSV 文本解析成行。`flexible(true)` 是必要的：报告 CSV 的每个段落列数并不一致。
fn parse_csv_rows(content: &str) -> Result<Vec<Vec<String>>, IpcError> {
    let content = content.strip_prefix('\u{FEFF}').unwrap_or(content);
    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(content.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| io_failure(std::io::Error::other(error)))?;
        rows.push(record.iter().map(str::to_string).collect());
    }
    Ok(rows)
}

/// sheet 名：去掉扩展名、截断到 Excel 的 31 字符上限；空名回落到 `Sheet1`。
fn sheet_name(default_name: &str) -> String {
    let mut stem = Path::new(default_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if stem == default_name && default_name.starts_with('.') {
        stem = "";
    }
    let truncated: String = stem.chars().take(31).collect();
    if truncated.is_empty() {
        "Sheet1".to_string()
    } else {
        truncated
    }
}

fn xlsx_failure(error: rust_xlsxwriter::XlsxError) -> IpcError {
    io_failure(std::io::Error::other(error.to_string()))
}

/// CSV 行 → `.xlsx` 二进制。第一行作为表头加粗。
fn xlsx_bytes(content: &str, default_name: &str) -> Result<Vec<u8>, IpcError> {
    let rows = parse_csv_rows(content)?;
    let mut workbook = Workbook::new();
    {
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(sheet_name(default_name))
            .map_err(xlsx_failure)?;
        let header = Format::new().set_bold();
        for (row_index, row) in rows.iter().enumerate() {
            let row_number = u32::try_from(row_index)
                .map_err(|_| io_failure(std::io::Error::other("row index overflow")))?;
            for (column_index, cell) in row.iter().enumerate() {
                let column_number = u16::try_from(column_index)
                    .map_err(|_| io_failure(std::io::Error::other("column index overflow")))?;
                if row_index == 0 {
                    worksheet
                        .write_string_with_format(row_number, column_number, cell, &header)
                        .map_err(xlsx_failure)?;
                } else {
                    worksheet
                        .write_string(row_number, column_number, cell)
                        .map_err(xlsx_failure)?;
                }
            }
        }
    }
    workbook.save_to_buffer().map_err(xlsx_failure)
}

/// A4（8.27 × 11.69 英寸）、打印背景、不显示浏览器页眉页脚。
fn pdf_options() -> PrintToPdfOptions {
    PrintToPdfOptions {
        paper_width: Some(8.27),
        paper_height: Some(11.69),
        print_background: Some(true),
        display_header_footer: Some(false),
        ..PrintToPdfOptions::default()
    }
}

fn pdf_failure(error: impl std::fmt::Display) -> IpcError {
    io_failure(std::io::Error::other(error.to_string()))
}

/// HTML → PDF：交给系统 Chrome 的无头模式打印；目标内容走 `data:text/html;base64`。
fn pdf_bytes(html: &str) -> Result<Vec<u8>, IpcError> {
    let data_url = format!("data:text/html;base64,{}", BASE64.encode(html.as_bytes()));
    let browser = Browser::new(LaunchOptions::default()).map_err(pdf_failure)?;
    let tab = browser.new_tab().map_err(pdf_failure)?;
    tab.navigate_to(&data_url).map_err(pdf_failure)?;
    tab.wait_until_navigated().map_err(pdf_failure)?;
    tab.print_to_pdf(Some(pdf_options())).map_err(pdf_failure)
}

async fn export_bytes(
    format: ExportFormat,
    content: String,
    default_name: String,
    with_bom: bool,
) -> Result<Vec<u8>, IpcError> {
    match format {
        ExportFormat::Text => Ok(export_body(content, with_bom).into_bytes()),
        ExportFormat::Xlsx => xlsx_bytes(&content, &default_name),
        ExportFormat::Pdf => tokio::task::spawn_blocking(move || pdf_bytes(&content))
            .await
            .map_err(|error| io_failure(std::io::Error::other(error.to_string())))?,
    }
}

/// 组装最终写入的字节内容。CSV 需要 BOM，Excel 打开中文才不乱码；JSON 不需要。
pub(crate) fn export_body(content: String, with_bom: bool) -> String {
    if !with_bom || content.starts_with('\u{FEFF}') {
        return content;
    }
    let mut out = String::with_capacity(content.len() + 3);
    out.push('\u{FEFF}');
    out.push_str(&content);
    out
}

/// 弹出「另存为」对话框并写入文件。
///
/// 返回 `None` 表示用户取消（不是错误）；返回 `Some(path)` 表示已落盘。
#[tauri::command(rename_all = "snake_case")]
pub async fn export_write_file(
    app: AppHandle,
    state: State<'_, AppState>,
    default_name: String,
    content: String,
    with_bom: bool,
    format: Option<String>,
    // P2-10（2026-11-07 测试报告）：对话框标题由前端按当前语言传入；缺省回落 ASCII，
    // 不再把中文硬编码进壳层（AGENTS 规则 7）。
    title: Option<String>,
) -> Result<Option<String>, IpcError> {
    let format = parse_export_format(format.as_deref())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Export"))
        .set_file_name(&default_name)
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });
    // 对话框在主线程弹，回调把结果送回异步侧；这里只等结果，不阻塞主线程。
    //
    // `receiver.await` 失败 = sender 被 drop（回调没能把结果送回来），是真·内部错误；
    // **用户取消不是**，它走下面 `let Some(path) = picked else { return Ok(None) }`。
    // 没有哪个既有 code 语义相符，而契约的 44 个 code 是冻结的 ⇒ 仍用 `ipc/internal`，
    // 但 message 换成 Task 3 那种紧凑日志串（裁定 A-2）：该 code 的 params 被契约冻结成
    // `[]`，装不下 `reason` 键，所以这个 reason 只出现在兜底文案里。
    //
    // ⚠ 时态（Task 5b 复审 Minor 1）：**Task 7 建完词典之后**，`ipc/internal` 必然命中词典、
    // 这句话才真的只进日志；**在此之前**它会经前端 `describeError` → `client.ts` 的 `userMessage`
    // 原样弹进 toast。这与 Task 5 之后所有 code 的现状一致，是 Plan A 的既定过渡态（Task 9 收口）。
    // 别把下面这句读成「往 `internal()` 的 message 里塞什么都不会到用户眼前」。
    let picked = receiver
        .await
        .map_err(|_| IpcError::internal("ipc/internal reason=dialog_channel_closed"))?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path.into_path().map_err(path_failure)?;
    let bytes = export_bytes(format, content, default_name, with_bom).await?;
    tokio::fs::write(&path, bytes).await.map_err(io_failure)?;
    // 记住上次导出目录：设置页的 `app_environment.export_dir` 读这一段。
    if let Some(parent) = path.parent() {
        let repo = geo_store::SettingsRepo::new(state.pool.clone());
        match repo.get().await {
            Ok(mut settings) => {
                settings.storage.last_export_dir = Some(parent.display().to_string());
                if let Err(error) = repo.update(&settings).await {
                    tracing::warn!(reason = %error, "记录导出目录失败");
                }
            }
            Err(error) => tracing::warn!(reason = %error, "读取设置失败，导出目录未记录"),
        }
    }
    tracing::info!(path = %path.display(), "导出文件已写入");
    Ok(Some(path.display().to_string()))
}

/// `tokio::fs::write` 失败：`io::Error` 直接交给 `GeoError::Io`，由 `From<GeoError>`
/// 映射成 `io/failed` + `reason` = OS 原文（目录规则 4 的 raw passthrough）。
///
/// 为什么不在壳侧拼句子：`ipc/internal` 的 params 被契约冻结成 `[]`，改走它等于把
/// 「permission denied」这类**可操作**细节从用户视野里抹掉（裁定 A-1）。
fn io_failure(error: std::io::Error) -> IpcError {
    IpcError::from(GeoError::Io(error))
}

/// `FilePath::into_path()` 失败：它返回的不是 `io::Error`，用 `io::Error::other` 包一层
/// 再走 [`io_failure`] 同一条映射，库原文进 `reason`。
fn path_failure(error: impl std::fmt::Display) -> IpcError {
    io_failure(std::io::Error::other(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        export_body, io_failure, parse_csv_rows, parse_export_format, path_failure, pdf_options,
        sheet_name, xlsx_bytes, ExportFormat,
    };

    fn has_cjk(text: &str) -> bool {
        text.chars()
            .any(|character| ('\u{4e00}'..='\u{9fa5}').contains(&character))
    }

    #[test]
    fn csv_export_prepends_bom_and_json_does_not() {
        assert_eq!(export_body("a,b".to_string(), true), "\u{FEFF}a,b");
        assert_eq!(export_body("{}".to_string(), false), "{}");
    }

    #[test]
    fn bom_is_never_doubled() {
        assert_eq!(export_body("\u{FEFF}a,b".to_string(), true), "\u{FEFF}a,b");
    }

    /// 裁定 A-6 ①：写文件失败必须走 `io/failed`，把 OS 原文经 `reason` 还给用户。
    ///
    /// 走 `ipc/internal` 的话 `params` 是空的（契约把该 code 冻结成 `[]`），Task 7 建完
    /// 词典之后「permission denied」这类**可操作**信息就从用户视野里彻底消失——这是本
    /// micro-task 存在的首要理由，比「中文退出后端」这条纯洁性目标更要紧。
    #[test]
    fn write_failure_maps_to_io_failed_with_the_os_reason() {
        let ipc = io_failure(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "permission denied",
        ));
        assert_eq!(ipc.code, "io/failed");
        let reason = ipc.params.get("reason").expect("io/failed 带 reason");
        assert!(!reason.is_empty(), "{:?}", ipc.params);
        assert!(reason.contains("permission denied"), "{reason}");
        assert!(!has_cjk(reason), "reason 是 OS 原文，不得含 CJK：{reason}");
        // 兜底 message 是 Task 3 定的紧凑日志格式，同样不含自然语言
        assert!(!has_cjk(&ipc.message), "{}", ipc.message);
        assert_eq!(ipc.message, "io/failed reason=permission denied");
    }

    /// `FilePath::into_path()` 返回的不是 `io::Error`：包一层 `io::Error::other` 之后
    /// 走**同一条** `io/failed` 映射，库原文进 `reason`（目录规则 4 的 raw passthrough）。
    #[test]
    fn path_failure_wraps_a_non_io_error_into_the_same_shape() {
        let ipc = path_failure("invalid file path");
        assert_eq!(ipc.code, "io/failed");
        assert_eq!(ipc.params["reason"], "invalid file path");
        assert!(!has_cjk(&ipc.message), "{}", ipc.message);
    }
    #[test]
    fn export_format_defaults_to_text_and_accepts_xlsx_and_pdf() {
        assert_eq!(parse_export_format(None).unwrap(), ExportFormat::Text);
        assert_eq!(
            parse_export_format(Some("text")).unwrap(),
            ExportFormat::Text
        );
        assert_eq!(
            parse_export_format(Some("xlsx")).unwrap(),
            ExportFormat::Xlsx
        );
        assert_eq!(parse_export_format(Some("pdf")).unwrap(), ExportFormat::Pdf);
    }

    #[test]
    fn unknown_export_format_is_a_validation_failure_with_the_original_value() {
        let error = parse_export_format(Some("docx")).unwrap_err();
        assert_eq!(error.code, "validation/failed");
        assert_eq!(error.params["field"], "format");
        assert_eq!(error.params["reason"], "not_allowed");
        assert_eq!(error.params["value"], "docx");
        assert_eq!(
            error.message,
            "validation/failed field=format reason=not_allowed value=docx"
        );
    }

    #[test]
    fn csv_rows_keep_quoted_commas_and_allow_ragged_rows() {
        let rows = parse_csv_rows("\u{FEFF}name,note\nAcme,\"a,b\"\nshort\n").unwrap();
        assert_eq!(
            rows,
            vec![
                vec!["name".to_string(), "note".to_string()],
                vec!["Acme".to_string(), "a,b".to_string()],
                vec!["short".to_string()],
            ]
        );
    }

    #[test]
    fn sheet_name_drops_the_extension_and_stops_at_31_chars() {
        assert_eq!(
            sheet_name("geo-report-detailed-20260101-1200.xlsx"),
            "geo-report-detailed-20260101-12"
        );
        assert_eq!(sheet_name("short.csv"), "short");
        let long = "a".repeat(40) + ".xlsx";
        assert_eq!(sheet_name(&long).chars().count(), 31);
        assert_eq!(sheet_name(".xlsx"), "Sheet1");
    }

    #[test]
    fn xlsx_bytes_are_zip_payloads_not_text_or_bom() {
        let bytes = xlsx_bytes("head,value\ncoverage,55%\n", "report.xlsx").unwrap();
        assert_eq!(&bytes[..2], b"PK");
        assert_ne!(&bytes[..3], b"\xEF\xBB\xBF");
        assert!(bytes.len() > 100);
    }

    #[test]
    fn pdf_options_are_a4_with_background_and_no_header_footer() {
        let options = pdf_options();
        assert_eq!(options.paper_width, Some(8.27));
        assert_eq!(options.paper_height, Some(11.69));
        assert_eq!(options.print_background, Some(true));
        assert_eq!(options.display_header_footer, Some(false));
    }
}
