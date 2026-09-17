# AGENTS.md

本仓库是「稿得快 GEO 客户端」——Tauri 2 桌面应用（Rust 核 + React 前端），面向国内中小企业的生成式引擎优化工具。

## 必读上下文

- 产品定义：`docs/GEO客户端-MVP产品定义-v1.md`（唯一需求真值源）
- 架构设计：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`（执行时按计划的 task/step 顺序推进）

## 工具链与命令

版本由 mise 锁定，**不要用全局 node/cargo**，一律经 mise：

```bash
mise run doctor   # 打印工具链版本
mise run test     # cargo test --workspace + 前端 vitest
mise run lint     # cargo fmt --check + clippy -D warnings + 前端 lint
mise run check    # 提交前门禁（必须全绿才可声明完成）
mise run dev      # 启动原生桌面窗口
```

无 mise 激活时可用 `mise exec -- cargo test --workspace`。

## 硬性规则

1. **TDD**：先写失败测试，跑红，再写最小实现。没有失败测试就不写生产代码。
2. **测试禁止联网**：所有 HTTP/LLM 交互走 `fixtures/` 录制数据或 `wiremock`。CI 中不提供任何 API Key。
3. **密钥永不落库**：API Key 只存系统钥匙串（`SecretStore` trait），数据库仅存 `secret_ref` 字符串。日志与错误信息中不得出现 Key。
4. **crate 分层不可反向依赖**：`geo-domain` 不依赖任何其他 crate 且不做 IO；`geo-llm`/`geo-crawler`/`geo-store` 可依赖 `geo-domain`；`src-tauri` 依赖全部。
5. **选型约束**：HTTP 客户端用 `reqwest` + `rustls-tls`（禁用 `native-tls`，避免 openssl 依赖）；SQLite 用 sqlx 的 bundled 编译；迁移用 `sqlx::migrate!`，不引入 refinery。
6. **文案合规**：UI 与生成内容禁用"保证排名/霸屏/第一/最"等绝对化用语；生成内容默认 `PendingReview` 状态。
7. **UI 仅中文**（本轮不做 i18n）；所有面向用户的错误必须给出中文可读原因 + 稳定错误码。
8. **不要 git commit 之外的破坏性操作**：不 push、不改 remote、不 force、不删分支。

## 代码风格

- Rust：`rustfmt` 默认；clippy `-D warnings` 必须干净；错误统一用 `thiserror` 定义的 crate 级 `Error`，跨 crate 边界转成 `geo_domain::GeoError`。
- 公共类型放 `geo-domain`，序列化统一 `serde`，ID 统一 `uuid::Uuid`（v4），时间统一 `chrono::DateTime<Utc>`（SQLite 存 RFC3339 文本）。
- TypeScript：严格模式；IPC 调用集中在 `apps/desktop/ui/src/api/`，组件不直接 `invoke`。
- 文件保持聚焦：单文件超过约 400 行就考虑拆分。

## 提交规范

Conventional Commits（`feat:` / `fix:` / `test:` / `chore:` / `docs:`），一次提交对应计划里的一个 task，提交信息用中文或英文均可但需说明"做了什么 + 为什么"。
