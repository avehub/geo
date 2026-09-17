//! 导出落盘：走系统「另存为」对话框，由 Rust 侧写文件。
//!
//! 为什么不用 WebView 的 `<a download href="blob:">`：macOS 上 Tauri 用的是
//! WKWebView，它**不实现** blob URL 的 `download` 属性，点击后静默无反应，
//! 用户只看到「已导出」的提示却拿不到文件（spec FR-B2 也因此指定用
//! `tauri-plugin-dialog` 选路径）。所以导出统一收口到本命令：
//! 对话框选路径 → `tokio::fs::write` → 把最终路径回给前端展示。

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
    let picked = receiver
        .await
        .map_err(|_| IpcError::internal("导出对话框被中断，请重试"))?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| IpcError::internal(format!("导出路径不可用：{error}")))?;
    tokio::fs::write(&path, export_body(content, with_bom))
        .await
        .map_err(|error| IpcError::internal(format!("写入 {} 失败：{error}", path.display())))?;
    tracing::info!(path = %path.display(), "导出文件已写入");
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::export_body;

    #[test]
    fn csv_export_prepends_bom_and_json_does_not() {
        assert_eq!(export_body("a,b".to_string(), true), "\u{FEFF}a,b");
        assert_eq!(export_body("{}".to_string(), false), "{}");
    }

    #[test]
    fn bom_is_never_doubled() {
        assert_eq!(export_body("\u{FEFF}a,b".to_string(), true), "\u{FEFF}a,b");
    }
}
