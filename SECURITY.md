# 安全与漏洞报告

## 报告渠道

**请不要用公开 issue 报告安全漏洞。**

| 情形 | 渠道 |
|---|---|
| 安全漏洞（可被利用的缺陷、密钥泄露、越权、注入等） | 邮箱 `gaodekuai@163.com`，标题以 `[SECURITY]` 开头 |
| 普通缺陷、功能问题 | GitHub Issues（仓库公开后启用） |
| 许可与商务 | 见 `LICENSE` 与 `README.md` |

报告时请尽量提供：受影响版本、复现步骤、影响面评估、是否已公开。
我们会在收到后 **3 个工作日内**给出首次响应，并在处置完成后同步结论。
我们支持协调披露（coordinated disclosure）：请给出合理的修复窗口，
我们不会因善意研究行为追究责任。

## 本项目的安全不变量

以下条款是硬性约束（见 `AGENTS.md`），修改代码时不得削弱，也是安全评审的重点：

1. **密钥永不落库**（AGENTS 规则 3）
   LLM / 搜索 / 站长平台的 API Key **只**存操作系统钥匙串
   （macOS Keychain、Windows 凭据管理器），经 `SecretStore` trait 访问
   （`crates/geo-store/`）。SQLite 里只允许存 `secret_ref` 字符串。
   **日志与错误信息中不得出现 Key 明文。**
   评审任何涉及凭据的改动时，先确认这条没被绕过。

2. **测试禁止联网**（AGENTS 规则 2）
   所有 HTTP / LLM 交互走 `fixtures/` 录制数据或 `wiremock`。
   CI 中不提供任何 API Key。因此 CI 日志里出现形如真实 Key 的字符串
   一律视为**泄露事故**，须立即轮换该凭据。

3. **第三方平台只走官方通道**（AGENTS 规则 11）
   不实现「代客户登录第三方平台」：不模拟登录、不抓私有后台接口、
   不绕过验证码或风控。取数只允许 ①官方 OAuth / API ②客户自己导出的文件
   ③客户自己复制粘贴（`paste_parse`）④客户手工填报。
   需要浏览器自动化的场景（如元宝采集），必须由**用户本人扫码登录**，
   应用不接触、不保存其账号密码。

4. **数据不出本地**
   品牌档案、竞品清单、原始回答快照全部存于本机 SQLite；
   报告导出到用户自选目录。无遥测、无使用行为上报、无崩溃回传。

5. **发布凭据只进 Secrets**
   代码签名证书、公证凭据、更新器私钥一律只存 GitHub Actions Secrets
   与本机钥匙串，永不入仓。`.gitignore` 已覆盖 `*.pem` / `*.p12` / `*.p8`
   / `secrets.*` / `.env*`。完整清单见
   `docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md` §7。

## 已知风险面

| 面 | 说明 | 缓解 |
|---|---|---|
| `tauri.conf.json` 的 `security.csp` 当前为 `null` | 未启用 CSP | 0.2 收口：结合 `assetProtocol.scope` 给出白名单式 CSP |
| `assetProtocol` scope 含 `$APPDATA/**`、`$APPLOCALDATA/**` | 范围较宽 | 已限制在应用自有数据目录，不含任意路径 |
| `headless_chrome` 依赖会拉起本地 Chrome | 子进程在 hardened runtime 下受 library validation 约束 | 公证后必须在干净机器实测该链路，见发布规格 §8 风险 5 |

## 支持版本

| 版本 | 状态 |
|---|---|
| `0.1.x` | 预览版，接受安全报告 |
| `< 0.1` | 不支持，请升级 |
