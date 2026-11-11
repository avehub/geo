#!/usr/bin/env bash
#
# 发布前门禁：在打 tag / 触发 release.yml 之前跑一遍。
# 裁定见 docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md（DR-R9 / DR-R10 / DR-R11）。
#
# 用法：
#   scripts/release-check.sh                 常规检查（工作区密钥扫描）
#   scripts/release-check.sh --history       额外做全 git 历史 blob 扫描（慢）
#   scripts/release-check.sh --tag v0.1.0    额外校验 tag 与版本号一致
#   scripts/release-check.sh --allow-draft-legal   允许 docs/legal 仍有【待填】占位符（仅内测用）
#
# 退出码：0 全绿；1 有 FAIL。WARN 不影响退出码，但发布前应当人工确认。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILS=0
WARNS=0

if [[ -t 1 ]]; then
  G=$(tput setaf 2); Y=$(tput setaf 3); R=$(tput setaf 1); B=$(tput bold); D=$(tput dim); N=$(tput sgr0)
else
  G=""; Y=""; R=""; B=""; D=""; N=""
fi

pass() { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s⚠ WARN%s %s\n' "$Y" "$N" "$1"; WARNS=$((WARNS + 1)); }
fail() { printf '  %s✗ FAIL%s %s\n' "$R" "$N" "$1"; FAILS=$((FAILS + 1)); }
head_() { printf '\n%s%s%s\n' "$B" "$1" "$N"; }

DO_HISTORY=0
DO_TAG=""
ALLOW_DRAFT_LEGAL=0
for arg in "$@"; do
  case "$arg" in
    --history) DO_HISTORY=1 ;;
    --tag) : ;;  # 下一个位置参数（vX.Y.Z）会被下面的分支捕获
    v[0-9]*) DO_TAG="$arg" ;;
    --tag=*) DO_TAG="${arg#--tag=}" ;;
    --allow-draft-legal) ALLOW_DRAFT_LEGAL=1 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "未知参数：$arg" ;;
  esac
done
[[ -n "$DO_TAG" ]] && pass "将校验 tag：$DO_TAG"

# ── 1. 必备文件 ─────────────────────────────────────────────────────────
head_ "1. 必备文件"
for f in LICENSE README.md SECURITY.md CONTRIBUTING.md docs/README.md \
         apps/desktop/src-tauri/tauri.conf.json .github/workflows/release.yml; do
  [[ -e "$f" ]] && pass "$f" || fail "缺少 $f"
done
for f in docs/legal/privacy-policy.zh-CN.md docs/legal/terms-of-service.zh-CN.md; do
  [[ -e "$f" ]] && pass "$f" || fail "缺少 $f（隐私政策 / 用户协议，最小可发布集要求）"
done

# ── 2. 版本号一致性 ─────────────────────────────────────────────────────
head_ "2. 版本号单一真值源"
if VERSION_OUT="$(scripts/version.sh check 2>&1)"; then
  pass "$(printf '%s' "$VERSION_OUT" | tail -n1)"
else
  printf '%s\n' "$VERSION_OUT" | sed 's/^/    /'
  fail "三处版本号不一致或不是合法 semver"
fi
CUR_VERSION="$(scripts/version.sh get 2>/dev/null || echo unknown)"
if [[ -n "$DO_TAG" ]]; then
  if [[ "v$CUR_VERSION" == "$DO_TAG" ]]; then
    pass "tag $DO_TAG 与 tauri.conf.json 版本一致"
  else
    fail "tag $DO_TAG 与版本号 $CUR_VERSION 不一致（先 mise run version:set -- ${DO_TAG#v}）"
  fi
fi
if git rev-parse "v$CUR_VERSION" >/dev/null 2>&1; then
  warn "tag v$CUR_VERSION 已存在，重复发布需先递增版本号"
fi

# ── 3. .gitignore 覆盖 ──────────────────────────────────────────────────
head_ "3. .gitignore 覆盖敏感物"
for pat in '.superpowers/' '*.p12' '*.p8' '*.pem' '.env' 'secrets.*'; do
  if grep -qxF "$pat" .gitignore 2>/dev/null || grep -qxF "/${pat#/}" .gitignore 2>/dev/null; then
    pass ".gitignore 含 $pat"
  else
    fail ".gitignore 缺 $pat"
  fi
done

# ── 4. 不该被跟踪的东西 ─────────────────────────────────────────────────
head_ "4. 已跟踪文件审查"
if [[ -n "$(git ls-files .superpowers 2>/dev/null)" ]]; then
  fail ".superpowers/ 已被 git 跟踪（内部 SDD 简报不应入库）：$(git ls-files .superpowers | head -3 | tr '\n' ' ')"
else
  pass ".superpowers/ 未被跟踪"
fi
LEAKED_FILES="$(git ls-files '*.p12' '*.p8' '*.pem' '*.mobileprovision' '*.key' 'secrets.*' 2>/dev/null)"
if [[ -n "$LEAKED_FILES" ]]; then
  fail "仓库跟踪了疑似证书/私钥文件："
  printf '%s\n' "$LEAKED_FILES" | sed 's/^/      /'
else
  pass "无 .p12 / .p8 / .pem / .mobileprovision / .key / secrets.* 被跟踪"
fi
# 更新器私钥必须放仓库外（DR-R9）
if [[ -n "$(git ls-files '.tauri/*' 2>/dev/null)" ]]; then
  fail ".tauri/ 被跟踪：更新器私钥必须在仓库外（\$HOME/.tauri/）"
else
  pass "更新器私钥目录 .tauri/ 未被跟踪"
fi

# ── 5. 工作区密钥扫描 ───────────────────────────────────────────────────
head_ "5. 密钥扫描"
# 真实凭据的高置信特征
SECRET_RE='AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{32,}'
# 已知良性哨兵串（测试用假 Key，见发布规格 §1）：命中这些不算泄露
SAFE_RE='sk-SENTINEL-|sk-demo-0123456789abcdef|sk-echoed-by-the-gateway|sk-test-|sk-your-|sk-xxx|example\.com|placeholder|REDACTED|<YOUR_'
scan_paths() {
  # $1: 扫描根（工作区用 git ls-files；历史用 cat-file 管道）
  git ls-files -z \
    | grep -zvE '^(fixtures/|pnpm-lock\.yaml$|Cargo\.lock$)' \
    | xargs -0 grep -nIE "$SECRET_RE" 2>/dev/null \
    | grep -vE "$SAFE_RE" || true
}
WORKSPACE_HITS="$(scan_paths)"
if [[ -n "$WORKSPACE_HITS" ]]; then
  fail "工作区命中疑似真实凭据："
  printf '%s\n' "$WORKSPACE_HITS" | head -10 | sed 's/^/      /'
  printf '      %s（若确认是测试常量，把特征串加进 scripts/release-check.sh 的 SAFE_RE）%s\n' "$D" "$N"
else
  pass "工作区无疑似真实凭据（已排除 fixtures/ 与已知测试哨兵串）"
fi

if (( DO_HISTORY )); then
  printf '  %s扫描全 git 历史 blob（可能需要数十秒）…%s\n' "$D" "$N"
  HISTORY_HITS="$(
    git rev-list --all --objects | awk '{print $1}' | sort -u \
      | git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize)' \
      | awk '$2=="blob" && $3<2000000 {print $1}' \
      | git cat-file --batch 2>/dev/null \
      | grep -aoE "$SECRET_RE" | sort -u | grep -vE "$SAFE_RE" || true
  )"
  if [[ -n "$HISTORY_HITS" ]]; then
    fail "git 历史命中疑似真实凭据（公开前必须处置）："
    printf '%s\n' "$HISTORY_HITS" | head -10 | sed 's/^/      /'
    printf '      处置需 git filter-repo + force push，属 AGENTS 规则 10 的破坏性操作，须显式授权\n'
  else
    pass "全 git 历史无疑似真实凭据"
  fi
fi

# ── 6. 合规用语扫描（AGENTS 规则 6 / DR-R11）────────────────────────────
head_ "6. 绝对化用语扫描"
COMPLIANCE_RE='保证排名|保证收录|霸屏|排名第一|全网第一|销量第一|行业第一|最好的|100%有效|100%成功|guaranteed ranking|guaranteed #1'
# 元提及豁免：文档里**陈述这条禁令本身**（「禁用保证排名…」「不得承诺第一」）不是违规。
# 只在同一行出现禁令措辞时豁免；单独一句「我们保证排名第一」不会被放过。
META_RE='禁|不得|不可|不要使用|不使用|不承诺|避免|forbidden|do not use|prohibit'
SCAN_FILES=(LICENSE README.md SECURITY.md CONTRIBUTING.md docs/README.md)
while IFS= read -r f; do SCAN_FILES+=("$f"); done < <(find docs/legal -name '*.md' 2>/dev/null)
COMPLIANCE_HITS=""
for f in "${SCAN_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  h="$(grep -nE "$COMPLIANCE_RE" "$f" 2>/dev/null | grep -vE "$META_RE" || true)"
  [[ -n "$h" ]] && COMPLIANCE_HITS+="$(printf '%s\n' "$h" | sed "s|^|$f:|")"$'\n'
done
if [[ -n "$COMPLIANCE_HITS" ]]; then
  fail "对外文档出现绝对化用语（AGENTS 规则 6 禁止）："
  printf '%s' "$COMPLIANCE_HITS" | head -10 | sed 's/^/      /'
else
  pass "对外文档无绝对化用语（否定式表述与禁令元提及已豁免）"
fi

# ── 7. 法务文档占位符 ───────────────────────────────────────────────────
head_ "7. 法务文档占位符"
PLACEHOLDERS="$(grep -ohE '【待填：[^】]*】' docs/legal/*.md 2>/dev/null | sort -u || true)"
if [[ -n "$PLACEHOLDERS" ]]; then
  COUNT="$(printf '%s\n' "$PLACEHOLDERS" | grep -c . || true)"
  if (( ALLOW_DRAFT_LEGAL )); then
    warn "docs/legal 仍有 $COUNT 个【待填】占位符（--allow-draft-legal，仅内测可接受）"
  else
    fail "docs/legal 仍有 $COUNT 个【待填】占位符，法务复核未完成，不得对外发布："
    # COUNT 是**跨两份文件去重后**的不同项数；共用项在每份文件里各出现一次，出现总次数更多
    OCCUR="$(grep -ohE '【待填：[^】]*】' docs/legal/*.md 2>/dev/null | grep -c . || true)"
    printf '    （共 %s 处出现）\n' "$OCCUR"
    printf '%s\n' "$PLACEHOLDERS" | sed 's/^/      /'
  fi
else
  pass "docs/legal 无【待填】占位符"
fi
# SECURITY.md 里也有联系邮箱占位符
if grep -qE '【待填：' SECURITY.md 2>/dev/null; then
  fail "SECURITY.md 仍有【待填】占位符（安全联系邮箱必须补齐，否则漏洞无处可报）"
else
  pass "SECURITY.md 无【待填】占位符"
fi

# ── 8. 工作区洁净度 ─────────────────────────────────────────────────────
head_ "8. 工作区状态"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [[ "$DIRTY" == "0" ]]; then
  pass "工作区干净"
else
  warn "工作区有 $DIRTY 项未提交改动。tag 必须打在提交上，未提交的改动不会进发布产物"
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
[[ "$BRANCH" == "main" ]] && pass "当前在 main" || warn "当前在 $BRANCH（发布通常应从 main 打 tag）"

# ── 9. 发布流水线自检 ───────────────────────────────────────────────────
head_ "9. release.yml 与 Secrets 清单一致性"
if [[ -f .github/workflows/release.yml ]]; then
  SPEC="docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md"
  # secrets.* 与 vars.* 都必须在发布规格 §7 登记，防止清单与工作流漂移（DR-R9）
  USED_SECRETS="$(grep -oE 'secrets\.[A-Z0-9_]+' .github/workflows/release.yml | sed 's/^secrets\.//' | sort -u)"
  USED_VARS="$(grep -oE 'vars\.[A-Z0-9_]+' .github/workflows/release.yml | sed 's/^vars\.//' | sort -u)"
  MISSING=""
  # ⚠ 计数器不要叫 N —— 顶部的 N=$(tput sgr0) 是重置色码，重名会把色码覆盖成数字
  NSUM=0
  # GITHUB_TOKEN 由 Actions 自动注入，不是需要人工配置的凭据，不参与清单核对
  BUILTIN_ALLOW="GITHUB_TOKEN"
  for s in $USED_SECRETS $USED_VARS; do
    printf ' %s ' "$BUILTIN_ALLOW" | grep -qF " $s " && continue
    NSUM=$((NSUM + 1))
    if [[ -f "$SPEC" ]] && ! grep -qF "\`$s\`" "$SPEC"; then
      MISSING+="$s "
    fi
  done
  if [[ -n "$MISSING" ]]; then
    fail "release.yml 用到但发布规格 §7 未登记：$MISSING"
  elif [[ ! -f "$SPEC" ]]; then
    warn "找不到发布规格 $SPEC，无法核对 §7 清单"
  else
    pass "release.yml 的 $NSUM 个 secret/variable 全部登记在发布规格 §7"
  fi
else
  fail "缺少 .github/workflows/release.yml"
fi

# ── 汇总 ────────────────────────────────────────────────────────────────
printf '\n%s────────────────────────────────────────────%s\n' "$B" "$N"
if (( FAILS == 0 )); then
  printf '%s%s  release-check PASS%s%s（%d 项 WARN 需人工确认）%s\n' "$B" "$G" "$N" "$D" "$WARNS" "$N"
  exit 0
else
  printf '%s%s  release-check FAIL%s：%d 项未通过，%d 项 WARN\n' "$B" "$R" "$N" "$FAILS" "$WARNS"
  exit 1
fi
