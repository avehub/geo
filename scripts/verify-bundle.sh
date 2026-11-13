#!/usr/bin/env bash
#
# 核验已构建的安装包：签名身份 / 公证状态 / staple 票据 / SHA-256。
# 对应发布规格 §6「发布前：干净机器实测」的第 3 条（可脚本化部分）。
#
# 用法：
#   scripts/verify-bundle.sh                      扫默认 bundle 目录
#   scripts/verify-bundle.sh <目录或文件…>        扫指定路径
#
# 默认目录：apps/desktop/src-tauri/target/release/bundle
#
# 退出码：0 全部产物核验通过；1 有产物未通过；2 用法/环境错误。
# ⚠ macOS 的签名与公证核验只能在 macOS 上跑；Windows 核验需要 signtool 或 PowerShell。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# cargo 的 target 目录由 **workspace 根**决定（本仓库根 Cargo.toml 有 [workspace]），
# 所以产物落在 <repo>/target/release/bundle/，**不是** apps/desktop/src-tauri/target/。
# 两个路径都试，兼容有人显式设了 CARGO_TARGET_DIR 或从子目录构建的情形。
BUNDLE_CANDIDATES=(
  "target/release/bundle"
  "apps/desktop/src-tauri/target/release/bundle"
)
[[ -n "${CARGO_TARGET_DIR:-}" ]] && BUNDLE_CANDIDATES=("$CARGO_TARGET_DIR/release/bundle" "${BUNDLE_CANDIDATES[@]}")
DEFAULT_BUNDLE=""
for c in "${BUNDLE_CANDIDATES[@]}"; do
  [[ -n "$c" && -d "$c" ]] && { DEFAULT_BUNDLE="$c"; break; }
done

if [[ -t 1 ]]; then
  G=$(tput setaf 2); Y=$(tput setaf 3); R=$(tput setaf 1); B=$(tput bold); D=$(tput dim); N=$(tput sgr0)
else
  G=""; Y=""; R=""; B=""; D=""; N=""
fi
FAILS=0; CHECKED=0

# stapler validate 会向 api.apple-cloudkit.com 做票据在线核验；
# 大陆网络到 CloudKit 间歇超时（实测 NSURLErrorDomain -1001），单次调用会误报
# 「票据未装订」。重试 + 退避，避免把网络抖动判成发布缺陷。
# ⚠ 只有 Command Line Tools（无完整 Xcode）的机器上，/usr/bin/stapler 是要求 Xcode 的
# 桩（stub），直接调用必报 "tool 'stapler' requires Xcode"；真工具要经 xcrun 解析到
# CLT 里。2026-11-13 实测：裸 stapler 让本机票据核验**必败**，xcrun stapler 正常。
if command -v xcrun >/dev/null 2>&1; then
  STAPLER=(xcrun stapler)
elif command -v stapler >/dev/null 2>&1; then
  STAPLER=(stapler)
else
  STAPLER=()
fi

stapler_validate() {
  local target="$1" i
  [[ ${#STAPLER[@]} -gt 0 ]] || return 2
  for i in 1 2 3 4; do
    if "${STAPLER[@]}" validate "$target" >/dev/null 2>&1; then return 0; fi
    sleep 6
  done
  return 1
}

pass() { printf '    %s✓%s %s\n' "$G" "$N" "$1"; }
fail() { printf '    %s✗%s %s\n' "$R" "$N" "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '    %s⚠%s %s\n' "$Y" "$N" "$1"; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else printf 'unknown'; fi
}

# ── macOS：.app 与 .dmg ─────────────────────────────────────────────────
verify_mac_app() {
  local app="$1" out auth
  CHECKED=$((CHECKED + 1))
  printf '\n  %s%s%s\n' "$B" "$app" "$N"

  command -v codesign >/dev/null 2>&1 || { warn "本机无 codesign，跳过（需在 macOS 上核验）"; return; }

  out="$(codesign -dv --verbose=4 "$app" 2>&1)"
  auth="$(printf '%s' "$out" | grep -E '^Authority=' | head -1 | sed 's/^Authority=//')"
  if [[ "$auth" == *"Developer ID Application"* ]]; then
    pass "签名身份：$auth"
  elif [[ -z "$auth" ]]; then
    fail "未签名（codesign 无 Authority 输出）"
  else
    fail "签名身份不是 Developer ID Application：$auth（站外分发必须用 Developer ID，Apple Development / Apple Distribution 都不行）"
  fi

  if printf '%s' "$out" | grep -qE 'flags=.*\bruntime\b'; then
    pass "hardened runtime 已启用"
  else
    fail "hardened runtime 未启用（公证的硬性前提）"
  fi

  teamid="$(printf '%s' "$out" | grep -E '^TeamIdentifier=' | head -1 | sed 's/^TeamIdentifier=//')"
  [[ -n "$teamid" && "$teamid" != "not set" ]] && pass "TeamIdentifier=$teamid" || fail "TeamIdentifier 缺失"

  if codesign --verify --deep --strict --verbose=2 "$app" >/dev/null 2>&1; then
    pass "codesign --verify --deep --strict 通过"
  else
    fail "codesign 校验失败：$(codesign --verify --deep --strict "$app" 2>&1 | head -3 | tr '\n' ' ')"
  fi

  if command -v spctl >/dev/null 2>&1; then
    # 本机若关掉了 Gatekeeper 评估，spctl 的 accepted 不是证据，必须提示。
    # ⚠ `spctl --status` 在 assessments disabled 时**退出码是 1**，脚本开了 pipefail，
    # 所以不能直接写 `spctl --status | grep -q …`（会被 pipefail 判成 false 而静默跳过）。
    local spctl_status; spctl_status="$(spctl --status 2>/dev/null || true)"
    if printf '%s' "$spctl_status" | grep -qi 'assessments disabled'; then
      warn "本机 spctl assessments disabled —— 下面的 Gatekeeper 结论**无效**，必须在干净机器上重跑（发布规格 §6）"
    fi
    local sp; sp="$(spctl -a -vvv -t install "$app" 2>&1)"
    if printf '%s' "$sp" | grep -q 'accepted'; then
      pass "Gatekeeper: $(printf '%s' "$sp" | tr '\n' ' ' | sed 's/  */ /g')"
      printf '%s' "$sp" | grep -qi 'Notarized Developer ID' \
        && pass "已公证（source=Notarized Developer ID）" \
        || fail "Gatekeeper 接受但未见 Notarized Developer ID —— 可能只签名未公证"
    else
      fail "Gatekeeper 拒绝：$(printf '%s' "$sp" | tr '\n' ' ')"
    fi
  fi

  if [[ ${#STAPLER[@]} -gt 0 ]]; then
    if stapler_validate "$app"; then
      pass "stapler validate 通过（公证票据已装订；含 CloudKit 在线核验，已带重试）"
    else
      fail "stapler validate 失败（4 次重试后）—— 公证票据未装订或 CloudKit 持续不可达；前者正式发布不可接受，后者换网络重跑"
    fi
  else
    warn "无 stapler / xcrun（Xcode CLT 未装？），跳过票据核验"
  fi

  printf '    %sSHA-256%s 见对应 .dmg；.app 目录本身不单独出校验值\n' "$D" "$N"
}

verify_mac_dmg() {
  local dmg="$1" sp
  CHECKED=$((CHECKED + 1))
  printf '\n  %s%s%s\n' "$B" "$dmg" "$N"
  printf '    %sSHA-256%s %s\n' "$D" "$N" "$(sha256_of "$dmg")"

  command -v codesign >/dev/null 2>&1 || { warn "本机无 codesign，跳过"; return; }
  if codesign -dv "$dmg" >/dev/null 2>&1; then
    pass "DMG 已签名：$(codesign -dv "$dmg" 2>&1 | grep -E '^Authority=' | head -1 | sed 's/^Authority=//')"
  else
    warn "DMG 本身未签名（Tauri 默认只签 .app；Gatekeeper 靠 .app 的公证票据放行，通常可接受）"
  fi
  if [[ ${#STAPLER[@]} -gt 0 ]]; then
    stapler_validate "$dmg" \
      && pass "DMG staple 票据有效（含 CloudKit 在线核验，已带重试）" \
      || fail "DMG staple 票据无效/缺失（4 次重试后；若 CloudKit 持续不可达请换网络重跑）"
  fi
  if command -v spctl >/dev/null 2>&1; then
    sp="$(spctl -a -vvv -t open --context context:primary-signature "$dmg" 2>&1 || true)"
    [[ -n "$sp" ]] && printf '    %sspctl: %s%s\n' "$D" "$(printf '%s' "$sp" | tr '\n' ' ')" "$N"
  fi
}

verify_win() {
  local f="$1"
  CHECKED=$((CHECKED + 1))
  printf '\n  %s%s%s\n' "$B" "$f" "$N"
  printf '    %sSHA-256%s %s\n' "$D" "$N" "$(sha256_of "$f")"
  if command -v signtool >/dev/null 2>&1; then
    if signtool verify /pa /v "$f" 2>&1 | grep -qi 'Successfully verified'; then
      pass "Authenticode 签名有效"
    else
      fail "signtool 校验未通过"
    fi
  elif command -v pwsh >/dev/null 2>&1; then
    local st; st="$(pwsh -NoProfile -Command "(Get-AuthenticodeSignature -FilePath '$f').Status" 2>/dev/null || echo unknown)"
    [[ "$st" == "Valid" ]] && pass "Authenticode 签名有效（PowerShell: $st）" \
                            || fail "Authenticode 状态：$st"
  else
    warn "本机无 signtool / pwsh，无法核验 Authenticode。请在 Windows 上跑，或装 Windows SDK"
    warn "SmartScreen 信誉是累积的：0.1 头几个版本仍可能弹警告，这是平台机制（发布规格 DR-R3）"
  fi
}

# ── 收集待核验产物 ──────────────────────────────────────────────────────
TARGETS=()
if (( $# )); then
  for a in "$@"; do [[ -e "$a" ]] || { printf 'verify-bundle.sh: 路径不存在：%s\n' "$a" >&2; exit 2; }; TARGETS+=("$a"); done
else
  [[ -n "$DEFAULT_BUNDLE" ]] || {
    printf 'verify-bundle.sh: 找不到 bundle 目录，已尝试：\n' >&2
    for c in "${BUNDLE_CANDIDATES[@]}"; do [[ -n "$c" ]] && printf '  %s%s%s\n' "$D" "$c" "$N" >&2; done
    printf '  先构建：cd apps/desktop && pnpm exec tauri build\n' >&2
    printf '  或指定路径：scripts/verify-bundle.sh <目录或文件…>\n' >&2
    exit 2
  }
  while IFS= read -r f; do TARGETS+=("$f"); done < <(
    find "$DEFAULT_BUNDLE" -maxdepth 3 \( -name '*.app' -o -name '*.dmg' -o -name '*.exe' -o -name '*.msi' \) 2>/dev/null | sort
  )
fi

if (( ${#TARGETS[@]} == 0 )); then
  printf 'verify-bundle.sh: 没有找到任何 .app / .dmg / .exe / .msi 产物\n' >&2
  exit 2
fi

printf '%s────────────────────────────────────────────%s\n' "$B" "$N"
printf '%s  核验 %d 个产物%s\n' "$B" "${#TARGETS[@]}" "$N"

for t in "${TARGETS[@]}"; do
  if [[ -d "$t" && "$t" == *.app ]]; then verify_mac_app "$t"
  elif [[ "$t" == *.dmg ]]; then verify_mac_dmg "$t"
  elif [[ "$t" == *.exe || "$t" == *.msi ]]; then verify_win "$t"
  elif [[ -d "$t" ]]; then
    while IFS= read -r f; do
      if [[ -d "$f" && "$f" == *.app ]]; then verify_mac_app "$f"
      elif [[ "$f" == *.dmg ]]; then verify_mac_dmg "$f"
      elif [[ "$f" == *.exe || "$f" == *.msi ]]; then verify_win "$f"
      fi
    done < <(find "$t" -maxdepth 3 \( -name '*.app' -o -name '*.dmg' -o -name '*.exe' -o -name '*.msi' \) 2>/dev/null | sort)
  else
    warn "跳过无法识别的产物：$t"
  fi
done

printf '\n%s────────────────────────────────────────────%s\n' "$B" "$N"
if (( FAILS == 0 && CHECKED > 0 )); then
  printf '%s%s  verify-bundle PASS%s（%d 个产物）\n' "$B" "$G" "$N" "$CHECKED"
  exit 0
elif (( CHECKED == 0 )); then
  printf '%s%s  没有可核验的产物%s\n' "$B" "$Y" "$N"
  exit 2
else
  printf '%s%s  verify-bundle FAIL%s：%d 项未通过（共 %d 个产物）\n' "$B" "$R" "$N" "$FAILS" "$CHECKED"
  exit 1
fi
