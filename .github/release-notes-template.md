稿得快 GEO 客户端 {{VERSION}}

## 安装

- **macOS（Apple Silicon，M1/M2/M3/M4）**：`gdk-geo_{{VERSION}}_aarch64.dmg`
- **macOS（Intel）**：`gdk-geo_{{VERSION}}_x64.dmg`
  - 不确定芯片：左上角  → 「关于本机」，看「芯片」一行
- **Windows（64 位）**：`gdk-geo_{{VERSION}}_x64-setup.exe`

## 校验完整性

下载 `SHA256SUMS.txt` 放到与安装包同一目录后执行：

```bash
shasum -a 256 -c SHA256SUMS.txt        # macOS
```

```bat
certutil -hashfile gdk-geo_{{VERSION}}_x64-setup.exe SHA256
```

Windows 侧把 `certutil` 输出的哈希与 `SHA256SUMS.txt` 里对应行手工比对。

## 关于系统安全提示

- **macOS**：已用 Developer ID Application 证书签名并通过 Apple 公证，正常情况下 Gatekeeper 直接放行。
  若仍提示无法打开，先确认下载的文件未被代理或杀软改写（比对上面的 SHA-256）。
- **Windows**：已用 Azure Artifact Signing 签名。SmartScreen 的信任度是**按证书逐步累积**的，
  新版本发布初期仍可能出现蓝色警告，点「更多信息 → 仍要运行」即可继续安装。
  这是 Microsoft 平台的机制，不代表安装包有问题。
- **Windows 11 且开启了「智能应用控制」（Smart App Control）**：该系统会完全阻止未知未签名应用，
  且无法为单个应用放行。本版本已签名，不受此限制。

## 数据与隐私

- 品牌档案、竞品清单、原始回答快照**只存本机** SQLite，不上传服务器。
- LLM / 搜索平台的 API Key **只存系统钥匙串**（macOS Keychain / Windows 凭据管理器），数据库里只留引用。
- 本应用**不含**遥测、埋点、使用行为上报与崩溃回传。
- 详见仓库 `docs/legal/privacy-policy.zh-CN.md`。

## 效果说明

本工具用于生成式引擎优化（GEO）分析。相关指标受各平台算法调整、采样时点与样本量影响，
存在固有不确定性；本软件**不承诺**任何搜索引擎或 AI 引擎的收录、排名、曝光或转化结果。
AI 生成的内容默认处于「待人工审核」状态，请在对外发布前自行复核。

## 许可

专有软件，见仓库 `LICENSE`。
