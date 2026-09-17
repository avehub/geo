# 稿得快 GEO 客户端（gdk_auto_article）

面向国内中小企业的**生成式引擎优化（GEO）桌面工具**：在自己电脑上，用 15 分钟看清"豆包 / DeepSeek / Kimi / 元宝 里搜我的品类，有没有我、排第几、说错了什么"，并直接拿到可执行、可复测的 GEO 改造清单。

产品定义见 [`docs/GEO客户端-MVP产品定义-v1.md`](docs/GEO客户端-MVP产品定义-v1.md)。

## 交付分期

| 期 | 范围 | 状态 |
|---|---|---|
| **P0-A** | 工程基座 + M1 项目与品牌档案 + M2 Prompt 智能题库 | 进行中 |
| P0-B | M3 多引擎采集 + M4 解析与事实核查 | 未开始 |
| P0-C | M5 诊断与竞品对标 + M6 GEO 行动中心 | 未开始 |
| P0-D | M7 报告与分享 + M8 打包/签名/授权 | 未开始 |

设计文档：`docs/superpowers/specs/`，实施计划：`docs/superpowers/plans/`。

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
mise run dev          # 启动原生桌面窗口（Tauri dev）
mise run web          # 仅前端（浏览器 http://localhost:1420）
mise run check        # 提交前门禁：fmt + clippy + cargo test + lint + vitest + build
scripts/record-fixtures.sh check   # 离线自检 fixtures（不需要 Key、不联网）
```

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
scripts/         图标生成与 fixture 录制/自检脚本
brand/           图标源图（icon-source.png）
docker/          CI 一致性镜像（dev.Dockerfile）
.github/         GitHub Actions：ci.yml（rust + ui 两个 job，跑在上面的镜像里）
```

数据不出本地：品牌档案、竞品清单、原始回答快照全部存于本机 SQLite，API Key 存系统钥匙串。

## 合规红线（产品级约束）

不承诺排名、不刷量、不伪造信源、不绕过验证码与登录风控；生成内容默认进入"待人工审核"；全产品文案禁用"保证排名 / 霸屏 / 第一"等绝对化用语。
