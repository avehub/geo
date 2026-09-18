//! 导出落盘：走系统「另存为」对话框，由 Rust 侧写文件。
//!
//! 为什么不用 WebView 的 `<a download href="blob:">`：macOS 上 Tauri 用的是
//! WKWebView，它**不实现** blob URL 的 `download` 属性，点击后静默无反应，
//! 用户只看到「已导出」的提示却拿不到文件（spec FR-B2 也因此指定用
//! `tauri-plugin-dialog` 选路径）。所以导出统一收口到本命令：
//! 对话框选路径 → `tokio::fs::write` → 把最终路径回给前端展示。

use geo_domain::GeoError;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::IpcError;

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
    default_name: String,
    content: String,
    with_bom: bool,
) -> Result<Option<String>, IpcError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("导出")
        .set_file_name(&default_name)
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });
    // 对话框在主线程弹，回调把结果送回异步侧；这里只等结果，不阻塞主线程。
    //
    // `receiver.await` 失败 = sender 被 drop（回调没能把结果送回来），是真·内部错误；
    // **用户取消不是**，它走下面 `let Some(path) = picked else { return Ok(None) }`。
    // 没有哪个既有 code 语义相符，而契约的 43 个 code 是冻结的 ⇒ 仍用 `ipc/internal`，
    // 但 message 换成 Task 3 那种紧凑日志串（裁定 A-2）：该 code 的 params 被契约冻结成
    // `[]`，装不下 `reason` 键，所以这个 reason 只出现在兜底文案里；词典必然命中
    // `ipc/internal`，这句话实际上只进日志。
    let picked = receiver
        .await
        .map_err(|_| IpcError::internal("ipc/internal reason=dialog_channel_closed"))?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path.into_path().map_err(path_failure)?;
    tokio::fs::write(&path, export_body(content, with_bom))
        .await
        .map_err(io_failure)?;
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
    use super::{export_body, io_failure, path_failure};

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
}
