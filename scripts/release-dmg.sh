#!/usr/bin/env bash
#
# 本地一键出包：签名 DMG + 公证 + staple（Apple Silicon 宿主机）。
# 用法：
#   scripts/release-dmg.sh              真跑全链路（需 ~/.config/gdk-geo/signing.env）
#   scripts/release-dmg.sh --dry-run    只打印执行序列，不碰钥匙串 / 构建 / 网络
#
# 序列为 2026-11-12 实测闭环（发布规格 §4.6 / §8.1）：
#   1/5 临时钥匙串导入 Developer ID p12（login 钥匙串里没有私钥）
#   2/5 tauri build --bundles dmg（签 app + 出 dmg + 签 dmg；不传 APPLE_API_* 即跳过内置公证）
#   3/5 从 DMG 取出 .app → 公证 app zip → staple app（tauri 打 dmg 会移走 bundle/macos 下的 app）
#   4/5 用已装订 app 重打 DMG（hdiutil）+ codesign 签 DMG
#   5/5 公证 DMG → staple DMG → 双 stapler validate + sha256
#
# ⚠ 公证上传走 notarytool（tauri 内置客户端在本机网络下 connectTimeout）；
#    S3 multipart 上传在大陆网络间歇被掐断，故带 6 次退避重试。
set -uo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json;print(json.load(open('apps/desktop/src-tauri/tauri.conf.json'))['version'])")"
APP="target/release/bundle/macos/gdk-geo.app"
DMG="target/release/bundle/dmg/gdk-geo_${VERSION}_aarch64.dmg"
CFG="${GDK_SIGNING_ENV:-$HOME/.config/gdk-geo/signing.env}"

step() { printf '\n== %s ==\n' "$*"; }
run() { if [[ $DRY -eq 1 ]]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }

submit_wait() { # $1=file $2=label
  local f="$1" label="$2" i
  for i in 1 2 3 4 5 6; do
    if [[ $DRY -eq 1 ]]; then printf '   [dry-run] notarytool submit %s --wait (retry %s/6)\n' "$label" "$i"; return 0; fi
    echo "   notarytool submit $label attempt $i ..."
    if xcrun notarytool submit "$f" --key "$KEYPATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait; then return 0; fi
    sleep 20
  done
  return 1
}

step "1/5 临时钥匙串"
if [[ $DRY -eq 1 ]]; then
  echo "   [dry-run] source $CFG; create temp keychain; import developer-id.p12 + G2; set-key-partition-list"
else
  [[ -f "$CFG" ]] || { echo "缺少 $CFG（先跑 mise run signing:wizard）" >&2; exit 2; }
  set -a; source "$CFG"; set +a
  KEYPATH="$CFG/AuthKey_${APPLE_API_KEY}.p8"
  KC="$HOME/Library/Keychains/gdk-release-dmg.keychain-db"
  ORIG_LIST="$(security list-keychains -d user | tr -d '"' | tr '\n' ' ' | sed 's/ *$//')"
  cleanup() { security list-keychains -d user -s $ORIG_LIST >/dev/null 2>&1; security delete-keychain "$KC" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  KCP="$(openssl rand -hex 16)"
  security delete-keychain "$KC" >/dev/null 2>&1 || true
  security create-keychain -p "$KCP" "$KC"
  security set-keychain-settings -lut 21600 "$KC"
  security unlock-keychain -p "$KCP" "$KC"
  security import "$CFG/developer-id.p12" -k "$KC" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
  security import "$CFG/DeveloperIDG2CA.cer" -k "$KC" || true
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCP" "$KC" >/dev/null
  security list-keychains -d user -s "$KC" $ORIG_LIST
  unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_API_KEY_CONTENT
fi

step "2/5 tauri build --bundles dmg（签名，跳过内置公证）"
run env -u APPLE_API_ISSUER -u APPLE_API_KEY -u APPLE_API_KEY_PATH \
  bash -c "cd apps/desktop && ./ui/node_modules/.bin/tauri build --bundles dmg"

step "3/5 取 app → 公证 app → staple app"
if [[ $DRY -eq 1 ]]; then
  echo "   [dry-run] hdiutil attach $DMG; cp -R app -> $APP; detach"
  echo "   [dry-run] ditto -c -k --keepParent app app.zip"
  submit_wait app.zip app
  echo "   [dry-run] xcrun stapler staple $APP"
else
  MNT="/tmp/gdk-release-dmg-mnt-$$"
  mkdir -p "$MNT"
  hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -readonly >/dev/null
  cp -R "$MNT/gdk-geo.app" "$APP"
  hdiutil detach "$MNT" >/dev/null
  W="/tmp/gdk-release-dmg-$$"
  mkdir -p "$W"
  ditto -c -k --keepParent "$APP" "$W/app.zip"
  submit_wait "$W/app.zip" app || { echo "app 公证失败" >&2; exit 1; }
  xcrun stapler staple "$APP"
fi

step "4/5 重打 DMG + 签 DMG"
if [[ $DRY -eq 1 ]]; then
  echo "   [dry-run] stage(stapled app + Applications symlink); hdiutil create -ov -format UDZO $DMG"
  echo "   [dry-run] codesign --sign \"\$APPLE_SIGNING_IDENTITY\" --force $DMG"
else
  S="/tmp/gdk-release-dmg-stage-$$"
  mkdir -p "$S"
  cp -R "$APP" "$S/gdk-geo.app"
  ln -s /Applications "$S/Applications"
  hdiutil create -volname "gdk-geo" -srcfolder "$S" -ov -format UDZO "$DMG" >/dev/null
  codesign --sign "$APPLE_SIGNING_IDENTITY" --force "$DMG"
fi

step "5/5 公证 DMG → staple → 双 validate + sha256"
submit_wait "$DMG" dmg || { echo "dmg 公证失败" >&2; exit 1; }
run xcrun stapler staple "$DMG"
run xcrun stapler validate "$APP"
run xcrun stapler validate "$DMG"
run shasum -a 256 "$DMG"
echo
echo "完成：$DMG"
