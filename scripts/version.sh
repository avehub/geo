#!/usr/bin/env bash
#
# 版本号单一真值源工具（AGENTS.md 之外的发布工程约定）。
# 裁定见 docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md DR-R6。
#
# 真值源：apps/desktop/src-tauri/tauri.conf.json 的 "version"
# 同步到：Cargo.toml 的 [workspace.package].version
#         apps/desktop/ui/package.json 的 "version"
#         Cargo.lock（经 cargo metadata 刷新）
#
# 用法：
#   scripts/version.sh get            打印当前版本
#   scripts/version.sh check          校验三处一致，不一致退出 1
#   scripts/version.sh set 0.1.1      同步写入三处并刷新 Cargo.lock
#   scripts/version.sh next patch|minor|major   打印递增后的版本号（不写入）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CONF="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
CARGO_TOML="$ROOT/Cargo.toml"
UI_PKG="$ROOT/apps/desktop/ui/package.json"

die() { printf 'version.sh: %s\n' "$1" >&2; exit 1; }

[[ -f "$TAURI_CONF" ]] || die "找不到 $TAURI_CONF"
[[ -f "$CARGO_TOML"  ]] || die "找不到 $CARGO_TOML"
[[ -f "$UI_PKG"      ]] || die "找不到 $UI_PKG"

command -v python3 >/dev/null 2>&1 || die "需要 python3"

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'

read_tauri() {
  python3 - "$TAURI_CONF" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])
PY
}

read_cargo() {
  # 只取 [workspace.package] 段里的 version，不误抓依赖版本
  python3 - "$CARGO_TOML" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^\[workspace\.package\]\s*$(.*?)(?=^\[|\Z)", text, re.S | re.M)
if not m:
    sys.exit("[workspace.package] 段不存在")
v = re.search(r'^version\s*=\s*"([^"]+)"', m.group(1), re.M)
print(v.group(1) if v else "")
PY
}

read_ui() {
  python3 - "$UI_PKG" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])
PY
}

write_all() {
  local v="$1"
  python3 - "$TAURI_CONF" "$CARGO_TOML" "$UI_PKG" "$v" <<'PY'
import json, re, sys, io

tauri_path, cargo_path, ui_path, version = sys.argv[1:5]

# 1) tauri.conf.json —— 保留原缩进与键序，只替换顶层 "version"
with io.open(tauri_path, encoding="utf-8") as f:
    conf = json.load(f)
conf["version"] = version
with io.open(tauri_path, "w", encoding="utf-8") as f:
    json.dump(conf, f, ensure_ascii=False, indent=2)
    f.write("\n")

# 2) Cargo.toml —— 只改 [workspace.package] 段内的 version 行
with io.open(cargo_path, encoding="utf-8") as f:
    text = f.read()
m = re.search(r"(^\[workspace\.package\]\s*$)(.*?)(?=^\[|\Z)", text, re.S | re.M)
if not m:
    sys.exit("Cargo.toml 缺少 [workspace.package] 段")
seg = m.group(2)
new_seg, n = re.subn(r'^version\s*=\s*"[^"]+"', 'version = "%s"' % version, seg, count=1, flags=re.M)
if n != 1:
    sys.exit("[workspace.package] 段内没有 version 键")
text = text[: m.start(2)] + new_seg + text[m.end(2):]
with io.open(cargo_path, "w", encoding="utf-8") as f:
    f.write(text)

# 3) ui/package.json
with io.open(ui_path, encoding="utf-8") as f:
    pkg = json.load(f)
pkg["version"] = version
with io.open(ui_path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
}

refresh_lock() {
  # 让 Cargo.lock 里 workspace 成员的 version 跟上；纯版本变更无需联网
  if command -v cargo >/dev/null 2>&1; then
    ( cd "$ROOT" && cargo metadata --format-version 1 --offline >/dev/null 2>&1 ) \
      || ( cd "$ROOT" && cargo metadata --format-version 1 >/dev/null ) \
      || printf 'version.sh: 警告 —— Cargo.lock 刷新失败，请手动跑 cargo metadata\n' >&2
  else
    printf 'version.sh: 警告 —— 未找到 cargo，Cargo.lock 未刷新\n' >&2
  fi
}

cmd_get() { read_tauri; }

cmd_check() {
  local t c u ok=0
  t="$(read_tauri)"; c="$(read_cargo)"; u="$(read_ui)"
  printf '%-42s %s\n' "tauri.conf.json" "$t"
  printf '%-42s %s\n' "Cargo.toml [workspace.package]" "$c"
  printf '%-42s %s\n' "ui/package.json" "$u"
  [[ "$t" == "$c" ]] || { printf 'MISMATCH: tauri.conf.json != Cargo.toml\n' >&2; ok=1; }
  [[ "$t" == "$u" ]] || { printf 'MISMATCH: tauri.conf.json != ui/package.json\n' >&2; ok=1; }
  [[ "$t" =~ $SEMVER_RE ]] || { printf 'INVALID semver: %s\n' "$t" >&2; ok=1; }
  if (( ok )); then
    printf 'version.sh check: FAIL\n' >&2
  else
    printf 'version.sh check: OK (%s)\n' "$t"
  fi
  return $ok
}

cmd_set() {
  local v="${1:-}"
  [[ -n "$v" ]] || die "用法：scripts/version.sh set <X.Y.Z>"
  v="${v#v}"                       # 容忍 `v0.1.1` 写法
  [[ "$v" =~ $SEMVER_RE ]] || die "不是合法 semver：$v"
  local before; before="$(read_tauri)"
  write_all "$v"
  refresh_lock
  printf 'version.sh: %s → %s\n' "$before" "$v"
  cmd_check >/dev/null || die "写入后自检失败"
  printf 'version.sh: 三处已同步为 %s\n' "$v"
  printf '  下一步：git add -A && git commit -m "chore(release): %s"\n' "$v"
  printf '         git tag v%s\n' "$v"
}

cmd_next() {
  local kind="${1:-patch}" cur major minor patch
  cur="$(read_tauri)"
  IFS=. read -r major minor patch <<<"${cur%%-*}"
  case "$kind" in
    patch) printf '%s.%s.%s\n' "$major" "$minor" $((patch + 1)) ;;
    minor) printf '%s.%s.0\n' "$major" $((minor + 1)) ;;
    major) printf '%s.0.0\n' $((major + 1)) ;;
    *) die "kind 只能是 patch / minor / major" ;;
  esac
}

case "${1:-}" in
  get)   cmd_get ;;
  check) cmd_check ;;
  set)   shift; cmd_set "$@" ;;
  next)  shift; cmd_next "$@" ;;
  ""|-h|--help|help)
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
  *) die "未知子命令：$1（可用：get / check / set / next / help）" ;;
esac
