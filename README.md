# 稿得快 GEO 客户端（gdk_auto_article）

面向国内中小企业的**生成式引擎优化（GEO）桌面工具**：在自己电脑上，用 15 分钟看清"豆包 / DeepSeek / Kimi / 元宝 里搜我的品类，有没有我、排第几、说错了什么"，并直接拿到可执行、可复测的 GEO 改造清单。

产品定义见 [`docs/GEO客户端-MVP产品定义-v1.md`](docs/GEO客户端-MVP产品定义-v1.md)。

## 交付分期

| 期 | 范围 | 状态 |
|---|---|---|
| **P0-A** | 工程基座 + M1 项目与品牌档案 + M2 Prompt 智能题库 | 进行中 |
| P0-B | M3 多引擎采集 + M4 解析与事实核查 | 未开始 |
| P0-C | M5 诊断与竞品对标 + M6 GEO 行动中心 | 未开始 |
| P0-D | M7 报告与分享 + M8 打包/签名/授权 | 进行中（发布工程见下） |

设计文档：`docs/superpowers/specs/`，实施计划：`docs/superpowers/plans/`；当前状态与里程碑以 `docs/superpowers/current-state.md` 为准。
**不知道改哪块前该读哪份文档 → 先看 [`docs/README.md`](docs/README.md)（文档分级索引）。**

## 前置依赖

工具链由 [mise](https://mise.jdx.dev/) 管理，版本锁在 [`.mise.toml`](.mise.toml) 与 [`rust-toolchain.toml`](rust-toolchain.toml)：

```bash
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc && exec zsh
mise install          # 在本仓库根目录执行，自动装 node 24.21.0 / pnpm 12.4.2 / rust 1.98.1
mise run doctor
```

macOS 侧无需 Homebrew 依赖：Xcode Command Line Tools 足够（HTTP 用 rustls，SQLite 走 bundled 编译）。

## 快速开始

```bash
mise run install      # 安装前端依赖
mise run dev          # 启动原生桌面窗口（Tauri dev，真后端）
mise run web          # demo 模式：仅前端（浏览器 http://localhost:1420）
mise run demo:preview # demo 模式的构建产物（vite build + preview，http://localhost:4173）
mise run check        # 提交前门禁：fmt + clippy + cargo test + lint + vitest + build
scripts/record-fixtures.sh check   # 离线自检 fixtures（不需要 Key、不联网）

# 发布工程（只在宿主机跑，要访问钥匙串 / gh / codesign，不进 docker 镜像）
mise run version:get          # 当前版本（真值源：apps/desktop/src-tauri/tauri.conf.json）
mise run version:set -- 0.1.1 # 同步三处版本号并刷新 Cargo.lock
mise run signing:wizard       # 交互式配置签名凭据（Apple Developer ID / 公证 / Azure Artifact Signing）
mise run release:check        # 发布前门禁：文件齐备 / 版本一致 / 密钥不落仓 / 合规用语
mise run release:verify       # 核验产物的签名身份 / 公证 / staple 票据 / SHA-256
```

### 三个入口：真后端 / demo 模式 / 构建产物

`mise run web` 与 `mise run demo:preview` 跑的都是 **demo 模式**：界面与交互是真的，数据来自
`apps/desktop/ui/src/demo/` 这个**纯前端假后端**（`src/demo/seed/**` 的静态语料 + 一份内存库），
**不连 Rust、不联网、不调用任何 LLM**。因此有四件事必须先说清楚：

- **静态数据**：项目、竞品、实体卡、题库都是预置语料，不是抓取或生成出来的。
- **刷新即重置**：内存库随页面重载重新播种——新建的项目、写入的 API Key、生成的题库都不会留下。
- **不代表真实算法结果**：去重率、字段完整率、样本量分级等领域算法是 Rust 纯函数（AGENTS 规则 9），
  demo 里只呈现预置静态值。例如把题库删到 5 条，样本量分级也**不会**重算。
- **不写系统钥匙串**：demo 模式下 API Key 只留在内存里，落不了 macOS Keychain。

页面顶部有一条 **demo 横幅**提示当前处于演示模式；真 Tauri 窗口（`mise run dev`）没有这条横幅。

`demo:preview` 与 `web` 的区别只在**产物形态**：`web` 是 `vite dev`（未打包、带 HMR），
`demo:preview` 先 `vite build` 再用 `vite preview` 起静态服务器（端口 4173），
验的是产品负责人真正会拿到的那份构建产物（含中文语料是否被正确打进包）。

#### demo 验收清单（三个入口都要走一遍）

| 入口 | 期望 |
|---|---|
| `mise run dev` | 真 Tauri 窗口：**无** demo 横幅；IPC 正常（项目列表读的是本机 SQLite，不是种子数据）；API Key 写进系统钥匙串 |
| `mise run web` | 浏览器 <http://localhost:1420>：**有** demo 横幅；纯前端、无 Rust 参与；刷新即重置 |
| `mise run demo:preview` | 浏览器 <http://localhost:4173>：与 `web` 同样的 demo 行为，但跑的是 `apps/desktop/ui/dist/` 构建产物 |

⚠ 前两个入口需要**真人走查**（原生窗口与真实钥匙串都在自动化门禁之外）；`mise run check`
覆盖的是 fmt / clippy / cargo test / eslint / vitest / build，不含"点开窗口看一眼"。

### 容器内复现门禁（可选）

日常开发不用 Docker（Tauri 需要原生窗口）。只有想和 CI 完全一致地复现门禁时才用：

```bash
docker compose build                    # 首次约 5-10 分钟
docker compose run --rm dev             # = mise run install && mise run check
docker compose run --rm dev bash        # 进交互 shell
```

源码 bind mount 进 `/work`，`target/`、`node_modules/`、cargo registry、pnpm store 全在命名卷里，
不会污染宿主机。建议给 Docker 分配 ≥12 GB 内存（链接 Tauri 测试二进制时单个 ld 峰值很高）；
配额不足会被 OOM kill（`ld terminated with signal 9`），可用
`docker compose run --rm dev bash -lc 'CARGO_BUILD_JOBS=2 mise run check'` 降并行绕过。
CI（`.github/workflows/ci.yml`）用的就是同一个镜像；仓库加 remote 后自动生效。

## 发布与分发

> 完整裁定与步骤：[`docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md`](docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md)

**最小可发布集**：`LICENSE` + 签名公证 + 隐私政策 + 干净的公开仓库。自动更新与 Linux 推到 0.2。

| 平台 | 签名方案 | 状态 |
|---|---|---|
| macOS（Apple Silicon / Intel） | Developer ID Application 证书 + Apple 公证 + staple 票据 | 流水线就绪，待配凭据 |
| Windows x64（NSIS） | Azure Artifact Signing（原 Trusted Signing）+ `artifact-signing-cli` | 流水线就绪，待 Azure 组织验证 |
| Linux | — | 0.2 |

版本号只有**一个真值源**（`tauri.conf.json`），另两处（`Cargo.toml` workspace、`ui/package.json`）
由 `mise run version:set` 同步，不要手改。

发布产物由 [`.github/workflows/release.yml`](.github/workflows/release.yml) 在 **tag（`v*`）推送**时构建：
`preflight`（门禁）→ `create-release`（draft）→ `build`（三平台矩阵，签名 + 公证）→ `checksums`
（`SHA256SUMS.txt` + 三平台产物齐全才转正式发布）。
`ci.yml` 里那个 `workflow_dispatch` 的 bundle job 只是**未签名打包冒烟**，不出可分发产物。

### 关于系统安全提示（对客户如实说明）

- **macOS**：Developer ID 签名 + 公证后，Gatekeeper 正常放行。
- **Windows**：SmartScreen 的信任度**按证书逐步累积**，新版本发布初期仍可能出现警告。
  这是 Microsoft 平台机制——2024 年起连 EV 证书都不再有即时信誉。**不得对客户承诺「无警告」。**
- **Windows 11 开启「智能应用控制」（Smart App Control）** 的机器会**完全阻止**未签名应用，
  且无法为单个应用放行。所以 Windows 侧**不签名等于对一部分客户不可用**。

### 首次配置发布凭据

```bash
mise run signing:wizard     # 8 个 stage，逐步带你建证书、导 .p12、取 App Store Connect API Key、配 Azure
```

向导把值写到 **仓库外**的 `~/.config/gdk-geo/signing.env`（`chmod 600`），并通过 `gh` 写入
GitHub Secrets / Variables。证书、私钥、base64 **永不入仓**（`.gitignore` 已覆盖
`*.p12` / `*.p8` / `*.cer` / `*.mobileprovision` / `.tauri/` / `.superpowers/`）。
Secrets 与 Variables 的**唯一权威清单**见发布规格 §7；`mise run release:check` 会反向核对
`release.yml` 用到的每一项是否都登记在表里。

⚠ 两个前置条件不满足就全线阻塞：① 必须是**付费** Apple Developer Program（免费账号无法公证）；
② 你必须是账号的 **Account Holder**（只有这个角色能创建 Developer ID Application 证书）。

## 架构

```
crates/
  geo-domain/    纯领域模型与规则（无 IO）：项目、实体卡、prompt 集、去重、样本量纪律、合规词库
  geo-llm/       OpenAI 兼容 LLM 客户端：Provider 预设、重试、用量与成本记账、fixture 回放传输
  geo-crawler/   站点抓取与正文提取：robots、编码（GBK/UTF-8）、页面分类
  geo-store/     sqlx(SQLite) 仓储 + 迁移 + 系统钥匙串密钥存储
apps/desktop/
  src-tauri/     Tauri 2 壳：invoke 命令层 + service 编排
  ui/            React 19 + Vite + antd v5 + Tailwind + ECharts
fixtures/        离线测试用录制数据（HTTP 页面、LLM 响应）
scripts/         图标生成、fixture 录制/自检、版本同步、发布门禁、产物核验、签名向导
brand/           图标源图（icon-source.png）
docker/          CI 一致性镜像（dev.Dockerfile）
.github/         GitHub Actions：ci.yml（门禁，跑在上面的镜像里）+ release.yml（tag 触发的签名发布）
docs/legal/      隐私政策与用户协议草稿（发布前须法务复核）
```

数据不出本地：品牌档案、竞品清单、原始回答快照全部存于本机 SQLite，API Key 存系统钥匙串。

## 合规红线（产品级约束）

不承诺排名、不刷量、不伪造信源、不绕过验证码与登录风控；生成内容默认进入"待人工审核"；全产品文案禁用"保证排名 / 霸屏 / 第一"等绝对化用语。

数据侧的三条硬约束（详见 [`SECURITY.md`](SECURITY.md)）：**密钥永不落库**（API Key 只存系统钥匙串，
数据库仅存 `secret_ref`）、**测试禁止联网**（走 `fixtures/` 或 `wiremock`）、
**第三方平台只走官方通道**（不模拟登录、不抓私有后台接口、不绕验证码与风控）。

## 许可证

**专有软件，保留所有权利**（见 [`LICENSE`](LICENSE)）。本仓库公开可读，用于让客户审计数据流向与
处理逻辑；公开可读**不构成**著作权许可的授予。未获授权不得复制、分发、修改或用于对外提供同类商业服务。

第三方开源组件依其各自原始许可证（Apache-2.0 / MIT / BSD 等）提供，不受上述限制约束，
清单见 `Cargo.lock` 与 `apps/desktop/ui/pnpm-lock.yaml`。

## 安全

**请不要用公开 issue 报告安全漏洞。** 报告渠道、本项目的安全不变量与已知风险面见 [`SECURITY.md`](SECURITY.md)。

## 贡献

环境准备、开发纪律（TDD / demo 优先 / 命令面共享契约 / UI 双语 / 文案合规）、提交规范与验收要求
见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。硬性规则以 [`AGENTS.md`](AGENTS.md) 为准。
