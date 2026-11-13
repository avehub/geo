#!/usr/bin/env bash
#
# 渲染 Microsoft Store 包清单：把 msix/AppxManifest.xml 模板里的 {{VERSION}}
# 替换成 MSIX 要求的四段版本号（X.Y.Z → X.Y.Z.0），写到 <outdir>/AppxManifest.xml。
# 只做纯文本渲染，跨平台可测；makeappx pack 只在 Windows runner 上做（release.yml 的 msix job）。
#
# 用法：scripts/msix-manifest.sh <X.Y.Z> <outdir>
# 裁定：docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md（DR-R3 修订）

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "用法：scripts/msix-manifest.sh <X.Y.Z> <outdir>" >&2
  exit 2
fi

VERSION="$1"
OUTDIR="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/apps/desktop/src-tauri/msix/AppxManifest.xml"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "错误：版本必须是 X.Y.Z（收到：$VERSION）。先 mise run version:set -- X.Y.Z" >&2
  exit 2
fi
[[ -f "$TPL" ]] || { echo "错误：缺少清单模板 $TPL" >&2; exit 2; }

mkdir -p "$OUTDIR"
# MSIX 的 Identity/Version 是四段；仓库真值源是三段 semver，这里补 .0
sed "s/{{VERSION}}/${VERSION}.0/g" "$TPL" > "$OUTDIR/AppxManifest.xml"

if grep -q "{{" "$OUTDIR/AppxManifest.xml"; then
  echo "错误：渲染后仍有未替换的占位符" >&2
  exit 1
fi
echo "已渲染 $OUTDIR/AppxManifest.xml（Version=${VERSION}.0）"
