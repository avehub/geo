#!/usr/bin/env bash
#
# Windows Store MSIX 主通道的发布工程测试（2026-11-13 裁定，见发布规格 DR-R3 修订）。
# 覆盖两件事：
#   1) scripts/msix-manifest.sh 的清单渲染（版本四段化、占位符清零、Store 标识逐字一致）；
#   2) release.yml 的 Windows 链路确实已从 Azure Artifact Signing 切到 Store MSIX
#      （Azure 在中国大陆主体下拿不到公共信任，见规格 DR-R3 修订的事实依据）。
#
# 用法：scripts/tests/msix-manifest.test.sh   （退出码 0 = 全绿）

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FAILS=0
ok()   { printf '  ✓ %s\n' "$1"; }
bad()  { printf '  ✗ FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }

MANIFEST_TPL="apps/desktop/src-tauri/msix/AppxManifest.xml"
GEN="scripts/msix-manifest.sh"
WORKFLOW=".github/workflows/release.yml"
ICONS="apps/desktop/src-tauri/icons"

# Partner Center「产品标识」页的逐字值（2026-11-13 实测，卖家 ID 97279770 / 个人帐户）。
# 清单里这三个值错一个字符都会认证失败，所以在这里钉死。
PKG_NAME="F73A5A8D.GEO"
PKG_PUBLISHER="CN=CB52BB16-C062-4464-AAA0-CAEA878E6358"
PKG_PUB_DISPLAY="众友合"

echo "── msix 清单模板 ──"
[[ -f "$MANIFEST_TPL" ]] && ok "模板存在：$MANIFEST_TPL" || bad "缺少 $MANIFEST_TPL"
if [[ -f "$MANIFEST_TPL" ]]; then
  grep -qF "Name=\"$PKG_NAME\"" "$MANIFEST_TPL" && ok "Identity/Name = $PKG_NAME" || bad "Identity/Name 与 Partner Center 不一致"
  grep -qF "Publisher=\"$PKG_PUBLISHER\"" "$MANIFEST_TPL" && ok "Identity/Publisher 逐字一致" || bad "Identity/Publisher 与 Partner Center 不一致"
  grep -qF ">$PKG_PUB_DISPLAY<" "$MANIFEST_TPL" && ok "PublisherDisplayName = $PKG_PUB_DISPLAY" || bad "PublisherDisplayName 与 Partner Center 不一致"
  grep -q "runFullTrust" "$MANIFEST_TPL" && ok "声明 runFullTrust（Win32 full-trust 必需）" || bad "缺少 rescap:runFullTrust"
fi

echo "── msix 商店图标资产 ──"
for a in Square44x44Logo.png Square150x150Logo.png StoreLogo.png; do
  [[ -f "$ICONS/$a" ]] && ok "$a" || bad "缺少 $ICONS/$a"
done

echo "── msix-manifest.sh 渲染 ──"
if [[ -x "$GEN" || -f "$GEN" ]]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  if bash "$GEN" 0.1.0 "$TMP" >/dev/null 2>&1; then
    ok "渲染 0.1.0 成功"
    grep -qF 'Version="0.1.0.0"' "$TMP/AppxManifest.xml" && ok "版本四段化 0.1.0 → 0.1.0.0" || bad "Version 未四段化"
    grep -q "{{" "$TMP/AppxManifest.xml" && bad "渲染后仍有未替换占位符" || ok "无残留占位符"
  else
    bad "渲染 0.1.0 失败"
  fi
  bash "$GEN" not-a-version "$TMP" >/dev/null 2>&1 && bad "非法版本未被拒绝" || ok "非法版本被拒绝"
  bash "$GEN" 0.1.0 >/dev/null 2>&1 && bad "缺 outdir 参数未被拒绝" || ok "缺参被拒绝"
else
  bad "缺少 $GEN"
fi

echo "── release.yml 的 Windows 链路 ──"
if [[ -f "$WORKFLOW" ]]; then
  grep -q "makeappx" "$WORKFLOW" && ok "release.yml 有 makeappx 打包步骤" || bad "release.yml 没有 makeappx 打包步骤"
  grep -qi "msix:" "$WORKFLOW" && ok "release.yml 有 msix job" || bad "release.yml 没有 msix job"
  grep -q "artifact-signing-cli" "$WORKFLOW" && bad "release.yml 仍引用 artifact-signing-cli（Azure 路线已废弃）" || ok "不再引用 artifact-signing-cli"
  grep -q "AZURE_" "$WORKFLOW" && bad "release.yml 仍引用 AZURE_*（中国大陆主体无公共信任资格）" || ok "不再引用 AZURE_*"
  grep -qE 'name: store-msix' "$WORKFLOW" && ok "msix 产物 artifact 名带 store-msix 前缀（与 checksums 的 bundle-* 模式隔离）" || bad "msix artifact 名未与 checksums 的 bundle-* 模式隔离"
else
  bad "缺少 $WORKFLOW"
fi

printf '\n'
if (( FAILS == 0 )); then echo "msix-manifest.test PASS"; exit 0; else echo "msix-manifest.test FAIL：$FAILS 项"; exit 1; fi
