//! 元宝（腾讯）网页版浏览器自动化。
//!
//! 产品裁定允许“本地浏览器自动化 + 用户自己扫码登录”，但 **不代客户登录**：
//! 我们只打开 yuanbao.tencent.com，让用户在真实浏览器里扫码；登录态留在独立 profile。
//! 不注入账号密码、不绕验证码、不抓私有接口。
//!
//! 每次采样启动一次受控 Chrome（复用 profile），提交问题、等待回答、截取页面截图。
//! 这是 MVP 的“小样本可走查”实现；60 题批量采集时建议只把元宝作为补充引擎。

use std::path::{Path, PathBuf};
use std::time::Duration;

use headless_chrome::protocol::cdp::Page;
use headless_chrome::{Browser, LaunchOptions};

use geo_llm::SearchHit;

const YUANBAO_URL: &str = "https://yuanbao.tencent.com/chat";
const INPUT_SELECTOR: &str = r#"textarea, [contenteditable="true"], [role="textbox"]"#;
const LOGIN_WAIT: Duration = Duration::from_secs(180);
const ANSWER_WAIT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserError {
    /// 没找到输入框 / 登录超时。
    LoginRequired,
    /// 等回答超时。
    Timeout,
    /// 页面被风控/验证码挡住。
    Blocked,
    /// 页面打开了但没有可读回答。
    EmptyAnswer,
    /// 没找到 Chrome/Edge，或浏览器启动失败。
    Unavailable,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserAnswer {
    pub answer: String,
    pub model: String,
    pub screenshot_path: Option<String>,
    pub citations: Vec<SearchHit>,
}

/// 在阻塞线程里跑浏览器，避免拖住 Tauri async runtime。
///
/// `profile_base` 由调用方从 `AppState::browser_profile_dir` 传进来（app data dir 下），
/// 元宝的扫码登录态落在 `profile_base/yuanbao`：不再落临时目录（P3-06b）。
pub async fn ask_yuanbao(
    prompt: &str,
    screenshots_dir: &Path,
    profile_base: &Path,
) -> Result<BrowserAnswer, BrowserError> {
    let prompt = prompt.to_string();
    let screenshots_dir = screenshots_dir.to_path_buf();
    let profile_base = profile_base.to_path_buf();
    tokio::task::spawn_blocking(move || ask_blocking(&prompt, &screenshots_dir, &profile_base))
        .await
        .map_err(|_| BrowserError::Other)?
}

fn ask_blocking(
    prompt: &str,
    screenshots_dir: &Path,
    profile_base: &Path,
) -> Result<BrowserAnswer, BrowserError> {
    // 测试/CI 明确禁用浏览器：不启动真实 Chrome，也不等待扫码。
    if std::env::var_os("GEO_DISABLE_BROWSER").is_some() {
        return Err(BrowserError::Unavailable);
    }
    let profile = profile_dir(profile_base);
    let _ = std::fs::create_dir_all(&profile);
    let options = launch_options(&profile)?;
    let browser = Browser::new(options).map_err(|_| BrowserError::Unavailable)?;
    let tab = browser.new_tab().map_err(|_| BrowserError::Unavailable)?;
    tab.navigate_to(YUANBAO_URL)
        .map_err(|_| BrowserError::Unavailable)?;

    // 第一次使用会停在扫码页；这里给用户 3 分钟完成登录。
    let input = tab
        .wait_for_element_with_custom_timeout(INPUT_SELECTOR, LOGIN_WAIT)
        .map_err(|_| BrowserError::LoginRequired)?;
    let text = prompt.trim();
    if text.is_empty() {
        return Err(BrowserError::EmptyAnswer);
    }
    input.click().map_err(|_| BrowserError::Blocked)?;
    input.type_into(text).map_err(|_| BrowserError::Blocked)?;
    tab.press_key("Enter").map_err(|_| BrowserError::Blocked)?;

    let answer = wait_for_answer(&tab, text)?;
    let screenshot_path = capture_screenshot(&tab, screenshots_dir).ok().flatten();
    let citations = collect_citations(&tab);
    Ok(BrowserAnswer {
        answer,
        model: "yuanbao-web".to_string(),
        screenshot_path,
        citations,
    })
}

fn wait_for_answer(tab: &headless_chrome::Tab, prompt: &str) -> Result<String, BrowserError> {
    // 轮询最后一段回答文本。DOM 类名随版本变化，这里用“可见的长文本块”作为启发式。
    let deadline = std::time::Instant::now() + ANSWER_WAIT;
    let mut last = String::new();
    let mut stable_rounds = 0;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(2));
        if let Ok(object) = tab.evaluate(ANSWER_SCRIPT, false) {
            if let Some(value) = object.value {
                if let Some(text) = value.as_str() {
                    let text = text.trim().to_string();
                    if text.len() >= 20 && text != prompt {
                        if text == last {
                            stable_rounds += 1;
                            if stable_rounds >= 2 {
                                return Ok(text);
                            }
                        } else {
                            stable_rounds = 0;
                            last = text;
                        }
                    }
                }
            }
        }
        // 出现验证码/风控提示时尽快失败，不无限等。
        if let Ok(object) = tab.evaluate(
            "document.body.innerText.includes('验证') || document.body.innerText.includes('风险')",
            false,
        ) {
            if object
                .value
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
            {
                return Err(BrowserError::Blocked);
            }
        }
    }
    if last.is_empty() {
        Err(BrowserError::EmptyAnswer)
    } else {
        Err(BrowserError::Timeout)
    }
}

fn capture_screenshot(
    tab: &headless_chrome::Tab,
    screenshots_dir: &std::path::Path,
) -> Result<Option<String>, BrowserError> {
    let bytes = tab
        .capture_screenshot(Page::CaptureScreenshotFormatOption::Png, None, None, true)
        .map_err(|_| BrowserError::Other)?;
    std::fs::create_dir_all(screenshots_dir).map_err(|_| BrowserError::Other)?;
    let path = screenshots_dir.join(format!("yuanbao-{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&path, bytes).map_err(|_| BrowserError::Other)?;
    Ok(Some(path.display().to_string()))
}

fn collect_citations(tab: &headless_chrome::Tab) -> Vec<SearchHit> {
    let Ok(object) = tab.evaluate(CITATION_SCRIPT, false) else {
        return Vec::new();
    };
    let Some(value) = object.value else {
        return Vec::new();
    };
    let Some(rows) = value.as_array() else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    rows.iter()
        .filter_map(|row| {
            let title = row.get("title")?.as_str()?.trim().to_string();
            let url = row.get("url")?.as_str()?.trim().to_string();
            if title.is_empty() || !url.starts_with("http") || !seen.insert(url.clone()) {
                return None;
            }
            Some(SearchHit {
                title,
                url,
                snippet: String::new(),
                content: None,
                site_name: None,
                date: None,
                authority: None,
            })
        })
        .collect()
}

/// 元宝通道的独立 profile 目录：`base/yuanbao`。
///
/// 🔴 `base` 必须是 `AppState::browser_profile_dir`（app data dir 下），不是临时目录：
/// 扫码登录态要能跨重启复用、随应用一起被用户清理，临时目录两条都不满足（P3-06b）。
pub fn profile_dir(base: &Path) -> PathBuf {
    base.join("yuanbao")
}

/// 受控 Chrome 的启动选项（纯函数，便于测试钉住安全约束）。
///
/// 🔴 不关沙箱（P3-06a）：`LaunchOptions::sandbox` 默认就是 `true`，只有显式
/// `.sandbox(false)` 才会追加 `--no-sandbox --disable-setuid-sandbox`。元宝通道跑在
/// 用户桌面会话里（`headless(false)`，用户要扫码），不是 root，没有任何理由
/// 让一个要加载第三方网页的 Chrome 无沙箱运行。
fn launch_options(profile: &Path) -> Result<LaunchOptions<'static>, BrowserError> {
    LaunchOptions::default_builder()
        .headless(false)
        .window_size(Some((1280, 900)))
        .user_data_dir(Some(profile.to_path_buf()))
        .idle_browser_timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| BrowserError::Unavailable)
}

/// 取页面里最后一段“像回答”的长文本。类名不稳定，所以按文本长度与消息块双重启发。
const ANSWER_SCRIPT: &str = r#"
(() => {
  const nodes = Array.from(document.querySelectorAll(
    '[class*="message"], [class*="answer"], [class*="markdown"], [class*="chat-item"], [class*="content"]'
  ));
  const texts = nodes
    .map((node) => (node.innerText || '').trim())
    .filter((text) => text.length >= 20 && !text.includes('登录') && !text.includes('扫码'));
  return texts.length ? texts[texts.length - 1] : '';
})()
"#;

const CITATION_SCRIPT: &str = r#"
(() => Array.from(document.querySelectorAll('a[href^="http"]'))
  .map((a) => ({ title: (a.innerText || a.getAttribute('title') || '').trim(), url: a.href }))
  .filter((row) => row.title && row.url))()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// P3-06b：登录态落在 app data dir 之下（`AppState::browser_profile_dir`），
    /// 不再是可预测又可被系统清理的临时目录。
    #[test]
    fn profile_dir_lives_under_the_app_data_dir_not_temp() {
        let app_data = Path::new("/home/user/.local/share/com.gaodekuai.geo/browser-profile");
        let profile = profile_dir(app_data);
        assert_eq!(profile, app_data.join("yuanbao"));
        assert!(profile.starts_with(app_data), "{profile:?}");
        assert!(
            !profile.starts_with(std::env::temp_dir()),
            "元宝 profile 不得落临时目录：{profile:?}"
        );
    }

    /// P3-06a：`sandbox` 必须是 true，即启动参数里不会出现 `--no-sandbox`
    /// （headless_chrome 只在 `sandbox == false` 时追加 `--no-sandbox --disable-setuid-sandbox`）。
    #[test]
    fn launch_options_keep_the_chrome_sandbox_enabled() {
        let profile = Path::new("/data/browser-profile/yuanbao");
        let options = launch_options(profile).expect("启动选项可构造");
        assert!(options.sandbox, "元宝通道必须带沙箱运行");
        assert!(!options.headless, "用户要看得见窗口才能扫码登录");
        assert_eq!(options.user_data_dir, Some(profile.to_path_buf()));
    }
}
