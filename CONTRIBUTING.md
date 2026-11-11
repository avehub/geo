# 贡献指南

## 先读这三份

| 文档 | 作用 |
|---|---|
| `AGENTS.md` | **硬性规则 1–11**、crate 分层、工具链命令、提交规范。所有改动的前提 |
| `docs/README.md` | 文档分级索引：改哪块代码前该读哪份 spec |
| `docs/superpowers/current-state.md` | 当前真实状态与命令面数量。改 demo / 命令面 / 各业务模块前必读 |

需求真值源是 `docs/GEO客户端-MVP产品定义-v1.md`；设计与裁定在 `docs/superpowers/specs/`；
实施计划在 `docs/superpowers/plans/`。**不要在 `current-state.md` 里写「计划中」当成「已实现」。**

## 许可

本仓库是**专有软件**（见 `LICENSE`）。公开可读不等于授予著作权许可。
提交 Pull Request 即表示您同意您的贡献按 `LICENSE` 条款授权给著作权人。
未签署贡献者协议前，外部代码贡献默认不被接受；
欢迎先开 issue 讨论，或提交缺陷报告（安全问题走 `SECURITY.md` 的私密渠道）。

## 环境

工具链版本由 [mise](https://mise.jdx.dev/) 锁定在 `.mise.toml` 与 `rust-toolchain.toml`。
**不要用全局 node / cargo**，一律经 mise，否则版本漂移会让门禁结果不可比。

```bash
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc && exec zsh
mise install          # 仓库根目录执行：node 24.21.0 / pnpm 12.4.2 / rust 1.98.1
mise run doctor       # 打印版本，确认生效
mise run install      # 安装前端依赖
```

macOS 侧无需 Homebrew：HTTP 用 `reqwest` + `rustls`（禁 `native-tls`，避免 openssl 依赖），
SQLite 走 sqlx 的 bundled 编译。Xcode Command Line Tools 足够。

## 常用命令

```bash
mise run dev            # 原生桌面窗口（真后端）
mise run web            # demo 模式：纯前端 + 静态数据（http://localhost:1420）
mise run demo:preview   # demo 的构建产物形态（vite build + preview，:4173）
mise run test           # cargo test --workspace + 前端 vitest
mise run lint           # cargo fmt --check + clippy -D warnings + 前端 lint
mise run check          # 提交前门禁（必须全绿才可声明完成）

# 发布工程
mise run version:get    # 当前版本（真值源：tauri.conf.json）
mise run version:check  # 校验三处版本号一致
mise run release:check  # 发布前门禁（版本/密钥/ignore/合规用语/tag 一致性）
```

⚠ **Tauri 的两套工作目录**：`tauri` CLI 只在当前目录及子目录找 `tauri.conf.json`。
配置在 `apps/desktop/src-tauri/`、前端在 `apps/desktop/ui/`，两者是兄弟目录，
所以 CLI 必须在 `apps/desktop` 下跑（`mise run dev` 已用 `dir` 固定）；
在 `ui/` 里跑会直接 panic。而 `beforeDevCommand` / `beforeBuildCommand` 是在**前端目录**里跑的，
所以钩子写 `pnpm run dev`，加 `--dir ui` 反而报错。改构建配置前务必重读 `AGENTS.md` 对应章节。

## 开发纪律

1. **TDD**：先写失败测试，跑红，再写最小实现。没有失败测试就不写生产代码。
2. **测试禁止联网**：走 `fixtures/` 或 `wiremock`。CI 不提供任何 API Key。
3. **demo 优先**：界面 / 交互 / 文案 / 信息架构的改动先在 `mise run web` 里定稿，
   产品负责人确认后再落桌面端与 Rust。demo 后端在 `apps/desktop/ui/src/demo/`。
4. **命令面是共享契约**：`apps/desktop/ui/src/api/client.ts` 的 `IPC_COMMANDS` 是单一清单，
   增减命令时前端清单与 demo 后端必须同步（`Record<IpcCommand, DemoHandler>` 编译期强制）。
   命令名 / 参数 / DTO 由**单一 owner** 定稿后再并行各域实现，不要抢改。
5. **UI 双语**：默认 `zh-CN`，支持 `en-US`。所有面向用户的文案必须经
   `apps/desktop/ui/src/i18n` 词典，**不得在组件里硬编码自然语言**。
   后端错误只返回稳定错误码 + 语言中立的 `params`，文案由前端按当前语言渲染。
   同一功能的 `zh-CN` 与 `en-US` 不拆给两个人。
6. **文案合规**：UI 与生成内容禁用「保证排名 / 霸屏 / 第一 / 最」等绝对化用语，
   英文同理（禁 `guaranteed ranking` / `#1` / `best` / `100%`）。
   生成内容默认 `PendingReview`。
7. **crate 分层不可反向依赖**：`geo-domain` 不依赖任何其他 crate 且不做 IO；
   `geo-llm` / `geo-crawler` / `geo-store` 可依赖 `geo-domain`；`src-tauri` 依赖全部。
8. **demo 的能力边界**：去重率、字段完整率、样本量分级等领域算法是 Rust 纯函数，
   demo 里只呈现预置静态值，**不要**在 demo 里「顺手实现」算法。
9. **文件保持聚焦**：新增 / 大改生产代码优先控制在约 400 行内，超过先拆职责。
   既有超限文件不因这条被顺手重构。

## 提交规范

Conventional Commits：`feat:` / `fix:` / `test:` / `chore:` / `docs:`。
一次提交对应计划里的一个 task，提交信息说明「做了什么 + 为什么」，中英文均可。

**禁止的破坏性操作**：不 `push --force`、不改 remote、不删分支。
分支前缀统一 `codex/`。

## 门禁与验收

`mise run check` 全绿只是**必要条件**，不是充分条件。它覆盖
fmt / clippy / cargo test / eslint / vitest / build，**不含**「点开窗口看一眼」。
涉及界面的改动必须额外做真人走查：

| 入口 | 期望 |
|---|---|
| `mise run dev` | 真 Tauri 窗口，**无** demo 横幅，IPC 读本机 SQLite，Key 写进系统钥匙串 |
| `mise run web` | 浏览器有 demo 横幅，纯前端，刷新即重置 |
| `mise run demo:preview` | 与 `web` 同样的 demo 行为，但跑的是构建产物 |

子任务自述「完成」不算验证；失败必须报告原因、影响面与未完成项，
**不得静默降级、伪造通过或把失败藏进汇总**。

## 并行子任务

多文件 / 跨 crate / 前后端的改动，先按 `AGENTS.md`「并行子任务（最多 4 个）」输出
拆解表（子任务、输入 → 产出、依赖、写集），再动代码。**写集有交集就串行**——
包括测试文件、共享守卫清单、i18n namespace、迁移号、命令清单。
