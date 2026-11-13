#!/usr/bin/env bash
# 守护 release-dmg.sh 的执行序列：dry-run 必须按
# 签名构建 → app 公证 → app staple → 重打 DMG → 签 DMG → DMG 公证 → DMG staple → 双 validate
# 的顺序出现，缺一即红（顺序错会把未装订的 app 打进 DMG，Gatekeeper 离线首启会失败）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$ROOT/scripts/release-dmg.sh"

bash -n "$S"
OUT="$("$S" --dry-run)"

line_of() { grep -n "$1" <<<"$OUT" | head -1 | cut -d: -f1; }
L_BUILD="$(line_of 'tauri build --bundles dmg')"
L_APPNOT="$(line_of 'notarytool submit app --wait')"
L_APPSTAPLE="$(line_of 'stapler staple target/release/bundle/macos')"
L_HDIUTIL="$(line_of 'hdiutil create -ov -format UDZO')"
L_DMGSIGN="$(line_of 'codesign --sign')"
L_DMGNOT="$(line_of 'notarytool submit dmg --wait')"
L_DMGSTAPLE="$(line_of 'stapler staple target/release/bundle/dmg')"
L_VALIDATE="$(line_of 'stapler validate target/release/bundle/dmg')"

for v in L_BUILD L_APPNOT L_APPSTAPLE L_HDIUTIL L_DMGSIGN L_DMGNOT L_DMGSTAPLE L_VALIDATE; do
  [[ -n "${!v}" ]] || { echo "FAIL: dry-run 缺少步骤 $v"; exit 1; }
done
[[ $L_BUILD -lt $L_APPNOT && $L_APPNOT -lt $L_APPSTAPLE && $L_APPSTAPLE -lt $L_HDIUTIL \
   && $L_HDIUTIL -lt $L_DMGSIGN && $L_DMGSIGN -lt $L_DMGNOT && $L_DMGNOT -lt $L_DMGSTAPLE \
   && $L_DMGSTAPLE -lt $L_VALIDATE ]] \
  || { echo "FAIL: 步骤顺序不对（build=$L_BUILD appnot=$L_APPNOT appstaple=$L_APPSTAPLE hdiutil=$L_HDIUTIL dmgsign=$L_DMGSIGN dmgnot=$L_DMGNOT dmgstaple=$L_DMGSTAPLE validate=$L_VALIDATE）"; exit 1; }

# 版本必须从 tauri.conf.json 单一真值源解析出来（否则 DMG 文件名会缺版本号）
grep -qE 'gdk-geo_[0-9]+\.[0-9]+\.[0-9]+_aarch64\.dmg' <<<"$OUT" || { echo "FAIL: dry-run 未解析出带版本号的 DMG 路径"; exit 1; }

# dry-run 不得真碰钥匙串 / 网络：输出里不允许出现非 [dry-run] 的执行痕迹
grep -qE '^\s+\[dry-run\]' <<<"$OUT" || { echo "FAIL: dry-run 无计划输出"; exit 1; }

echo "release-dmg.test.sh PASS"
