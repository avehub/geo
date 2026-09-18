# 一致性开发 / CI 镜像。
#
# 定位：**不是**日常开发主路径。macOS 上请用宿主机 mise（`mise run dev` 才能出原生窗口，
# 容器内没有 GUI，跑不了 Tauri dev）。本镜像只服务两件事：
#   1. GitHub Actions（`.github/workflows/ci.yml`）里跑门禁；
#   2. 需要与 CI 完全一致地复现门禁时：`docker compose run --rm dev`。
#
# 版本必须与 `.mise.toml` / `rust-toolchain.toml` 保持一致（改一处要同步改另一处）。
# 镜像里不放仓库代码：源码由 `docker-compose.yml` bind mount 到 `/work`，
# 构建产物走命名卷，因此 build context 只需要 `docker/` 目录。

FROM debian:trixie-slim

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=12.4.2
ARG RUST_VERSION=1.98.1

ENV DEBIAN_FRONTEND=noninteractive

# Tauri 2 在 Linux 侧的编译/链接依赖：webkit2gtk-4.1 + libsoup-3 + librsvg。
# 故意不装 libssl-dev / cmake：HTTP 走 rustls(ring)，SQLite 由 sqlx bundled 编译（AGENTS.md 规则 5）。
# python3 供 scripts/make-icon.py 与 scripts/record-fixtures.sh 使用。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      xz-utils \
      file \
      patchelf \
      pkg-config \
      build-essential \
      python3 \
      libgtk-3-dev \
      libjavascriptcoregtk-4.1-dev \
      libwebkit2gtk-4.1-dev \
      libsoup-3.0-dev \
      librsvg2-dev \
      libayatana-appindicator3-dev \
 && rm -rf /var/lib/apt/lists/*

# 工具链交给 mise 管理，和宿主机同一套版本来源，避免"容器一套、本地一套"。
RUN curl -fsSL https://mise.run | sh

ENV MISE_YES=1 \
    MISE_TRUSTED_CONFIG_PATHS=/work \
    PATH=/root/.local/bin:/root/.local/share/mise/shims:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Debian 的 /etc/profile 会重置 PATH，login shell（bash -lc）需要在这里补回来。
RUN printf '%s\n' \
      'export PATH="/root/.local/bin:/root/.local/share/mise/shims:/root/.cargo/bin:$PATH"' \
      'eval "$(/root/.local/bin/mise activate bash)"' \
      > /etc/profile.d/mise.sh \
 && chmod 0644 /etc/profile.d/mise.sh

# rustup 由 mise 首次安装 rust 时自动引导；rustfmt/clippy 是门禁必需组件。
RUN mise use --global "node@${NODE_VERSION}" "pnpm@${PNPM_VERSION}" "rust@${RUST_VERSION}" \
 && mise reshim \
 && rustup component add rustfmt clippy \
 && mise --version \
 && node -v && pnpm -v && rustc --version && cargo --version \
 && cargo clippy --version && cargo fmt --version

WORKDIR /work

# 默认跑全量门禁；要交互 shell 用：docker compose run --rm dev bash
CMD ["bash", "-lc", "mise run install && mise run check"]
