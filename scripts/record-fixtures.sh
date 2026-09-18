#!/usr/bin/env bash
#
# fixture 录制与自检脚本（spec FR-L5）。
#
# 两类用途：
#   1. `check`：**离线**自检 `fixtures/`，不需要 API Key、不联网，可随时跑；
#   2. `http` / `llm`：有 Key、有授权站点时**手动重录**夹具。
#
# 本脚本不参与测试、不进 CI 门禁（CI 只跑 `bash -n` 语法校验）。
# 硬性约束：录制到的真实内容**必须先脱敏/虚构化**再入库（见 `http` 子命令的输出提示），
# API Key 只从环境变量读取，永不写进文件、日志或命令行参数。

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
HTTP_DIR="$REPO_ROOT/fixtures/http"
LLM_DIR="$REPO_ROOT/fixtures/llm"
ADLAW_TERMS="$REPO_ROOT/crates/geo-domain/data/adlaw_terms.txt"
FINGERPRINT_FILE="$LLM_DIR/prompts.sha256"
DESKTOP_SRC="$REPO_ROOT/apps/desktop/src-tauri/src/services"

DEFAULT_BASE_URL="${GEO_LLM_BASE_URL:-https://api.deepseek.com/v1}"
DEFAULT_MODEL="${GEO_LLM_MODEL:-deepseek-chat}"
DEFAULT_TEMPERATURE="${GEO_LLM_TEMPERATURE:-0.2}"
DEFAULT_TIMEOUT="${GEO_LLM_TIMEOUT:-120}"

# 系统提示词的唯一真值源是 Rust 代码；这里只登记「在哪个文件的哪个常量」。
prompt_source_file() {
  case "$1" in
    entity_card) echo "$DESKTOP_SRC/entity_card_service.rs" ;;
    expand) echo "$DESKTOP_SRC/prompt_service.rs" ;;
    rewrite) echo "$DESKTOP_SRC/prompt_service.rs" ;;
    *) return 1 ;;
  esac
}

prompt_source_const() {
  case "$1" in
    entity_card) echo "EXTRACTION_SYSTEM" ;;
    expand) echo "EXPANSION_SYSTEM" ;;
    rewrite) echo "REWRITE_SYSTEM" ;;
    *) return 1 ;;
  esac
}

PROMPT_KINDS=(entity_card expand rewrite)

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

info() { printf '· %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }

need_python() {
  command -v python3 >/dev/null 2>&1 || die "需要 python3（脚本用它解析 Rust 字符串常量与 JSON）"
}

# python3 助手：Rust 字符串常量抽取、请求体拼装、fixture key、JSON 校验与合规扫描。
geo_py() {
  python3 - "$@" <<'PY'
import hashlib
import json
import sys


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def extract_rust_const(source, name):
    """抽取 `const NAME: &str = "....";` 并按 Rust 字面量规则反转义。"""
    marker = "const %s: &str" % name
    start = source.find(marker)
    if start < 0:
        raise SystemExit("在源码里找不到常量 %s" % name)
    quote = source.find('"', start)
    if quote < 0:
        raise SystemExit("常量 %s 没有起始引号" % name)
    out = []
    index = quote + 1
    while index < len(source):
        char = source[index]
        if char == '"':
            return "".join(out)
        if char == "\\" and index + 1 < len(source):
            nxt = source[index + 1]
            if nxt == "\n":  # 行续接：吃掉换行与下一行的前导空白
                index += 2
                while index < len(source) and source[index] in " \t":
                    index += 1
                continue
            mapping = {"n": "\n", "t": "\t", "r": "\r", "0": "\0", "\\": "\\", '"': '"', "'": "'"}
            if nxt in mapping:
                out.append(mapping[nxt])
                index += 2
                continue
            if nxt == "u" and source[index + 2 : index + 3] == "{":
                end = source.find("}", index)
                out.append(chr(int(source[index + 3 : end], 16)))
                index = end + 1
                continue
            raise SystemExit("无法解析的转义：\\%s" % nxt)
        out.append(char)
        index += 1
    raise SystemExit("常量 %s 的字符串没有结束引号" % name)


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def walk_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from walk_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_strings(value)


def load_terms(path):
    terms = []
    for line in read(path).decode("utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            terms.append(line)
    return terms


def fixture_bodies(payload):
    """按 fixtures/llm/README.md 的约定展开成响应体列表。"""
    if isinstance(payload, dict) and isinstance(payload.get("responses"), list):
        return payload["responses"]
    return [payload]


def response_content(body):
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise SystemExit("响应缺少 choices[0]")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise SystemExit("choices[0].message 不是对象")
    content = message.get("content")
    if not isinstance(content, str):
        raise SystemExit("choices[0].message.content 必须是字符串（业务 JSON 放在字符串里）")
    return content


command = sys.argv[1]

if command == "extract":
    source = read(sys.argv[2]).decode("utf-8")
    sys.stdout.write(extract_rust_const(source, sys.argv[3]))
elif command == "fingerprint":
    source = read(sys.argv[2]).decode("utf-8")
    sys.stdout.write(sha256_text(extract_rust_const(source, sys.argv[3])))
elif command == "body":
    model, temperature, user_file, system_file, json_object = sys.argv[2:7]
    messages = []
    if system_file != "-":
        messages.append({"role": "system", "content": read(system_file).decode("utf-8")})
    messages.append({"role": "user", "content": read(user_file).decode("utf-8")})
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
    }
    if json_object == "true":
        payload["response_format"] = {"type": "json_object"}
    # 与 geo-llm 的 WireChatRequest 保持一致：紧凑分隔符 + 字段顺序，
    # 这样 fixture_key = sha256(url + body) 才能和 Rust 侧算出来的完全相同。
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
elif command == "key":
    url = sys.argv[2]
    body = read(sys.argv[3]).decode("utf-8")
    sys.stdout.write(hashlib.sha256((url + body).encode("utf-8")).hexdigest()[:16])
elif command == "validate-llm":
    path = sys.argv[2]
    try:
        payload = json.loads(read(path).decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise SystemExit("%s 不是合法 JSON：%s" % (path, error))
    for body in fixture_bodies(payload):
        response_content(body)
elif command == "compliance":
    path, terms_path = sys.argv[2], sys.argv[3]
    payload = json.loads(read(path).decode("utf-8"))
    terms = load_terms(terms_path)
    hits = []
    for body in fixture_bodies(payload):
        content = response_content(body)
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            parsed = content
        for text in walk_strings(parsed):
            for term in terms:
                if term in text:
                    hits.append(term)
    sys.stdout.write("\n".join(sorted(set(hits))))
elif command == "is-utf8":
    try:
        read(sys.argv[2]).decode("utf-8")
    except UnicodeDecodeError:
        sys.exit(1)
else:
    raise SystemExit("未知的助手命令：%s" % command)
PY
}

current_fingerprint() {
  local kind="$1"
  geo_py fingerprint "$(prompt_source_file "$kind")" "$(prompt_source_const "$kind")"
}

# 读回指纹文件里某个提示词的 sha256（不存在则输出空）。
recorded_fingerprint() {
  local kind="$1"
  [[ -f "$FINGERPRINT_FILE" ]] || return 0
  awk -v want="$kind" '$1 == want { print $2; exit }' "$FINGERPRINT_FILE"
}

cmd_check() {
  local update=0
  [[ "${1:-}" == "--update" ]] && update=1
  need_python
  local failed=0

  info "检查 HTTP 夹具（$HTTP_DIR）"
  local required_http=(index.html about.html products.html faq.html contact.html gbk-page.html robots.txt admin.html)
  for name in "${required_http[@]}"; do
    [[ -f "$HTTP_DIR/$name" ]] || { warn "缺少 fixtures/http/$name"; failed=1; }
  done
  if grep -q '^Disallow: /admin' "$HTTP_DIR/robots.txt" 2>/dev/null; then
    ok "robots.txt 禁止 /admin"
  else
    warn "robots.txt 里没有 'Disallow: /admin'，抓取测试会失效"; failed=1
  fi
  if grep -q 'SCRIPT_CANARY_9f3a_must_not_leak' "$HTTP_DIR/index.html" 2>/dev/null; then
    ok "index.html 保留 script canary"
  else
    warn "index.html 缺少 script canary（正文提取测试会失效）"; failed=1
  fi
  if grep -q 'ADMIN_CANARY_7b2e' "$HTTP_DIR/admin.html" 2>/dev/null; then
    ok "admin.html 保留 canary"
  else
    warn "admin.html 缺少 canary（robots 拦截测试会失效）"; failed=1
  fi
  if geo_py is-utf8 "$HTTP_DIR/gbk-page.html"; then
    warn "gbk-page.html 现在是合法 UTF-8，编码探测测试会失效（应为 GBK 字节）"; failed=1
  else
    ok "gbk-page.html 不是合法 UTF-8（GBK 字节，符合预期）"
  fi

  info "检查 LLM 夹具（$LLM_DIR）"
  local fixture
  for fixture in "$LLM_DIR"/*.json; do
    [[ -e "$fixture" ]] || continue
    local base
    base=$(basename "$fixture")
    if geo_py validate-llm "$fixture" >/dev/null 2>&1; then
      ok "$base 结构合法（choices[0].message.content 为字符串）"
    else
      warn "$base 结构不合法：$(geo_py validate-llm "$fixture" 2>&1 || true)"; failed=1
    fi
    local hits
    hits=$(geo_py compliance "$fixture" "$ADLAW_TERMS" 2>/dev/null || true)
    if [[ -n "$hits" ]]; then
      warn "$base 命中绝对化用语：$(echo "$hits" | tr '\n' ' ')"; failed=1
    else
      ok "$base 未命中绝对化用语"
    fi
  done

  info "检查系统提示词指纹（$FINGERPRINT_FILE）"
  local kind actual recorded
  local updated_file=""
  for kind in "${PROMPT_KINDS[@]}"; do
    actual=$(current_fingerprint "$kind")
    recorded=$(recorded_fingerprint "$kind")
    updated_file+="$(printf '%s %s\n' "$kind" "$actual")"$'\n'
    if [[ $update -eq 1 ]]; then
      continue
    fi
    if [[ -z "$recorded" ]]; then
      warn "指纹缺失：$kind（跑 check --update 生成）"; failed=1
    elif [[ "$recorded" != "$actual" ]]; then
      warn "提示词已改动但 fixture 未重录：$kind"; failed=1
    else
      ok "提示词未漂移：$kind"
    fi
  done

  if [[ $update -eq 1 ]]; then
    {
      echo "# 录制 fixture 时所用系统提示词的 sha256 指纹（由 scripts/record-fixtures.sh 维护）。"
      echo "# 改了提示词请重录 fixture，再跑：scripts/record-fixtures.sh check --update"
      printf '%s' "$updated_file"
    } > "$FINGERPRINT_FILE"
    ok "已写入指纹文件"
  fi

  if [[ $failed -ne 0 ]]; then
    die "自检未通过（见上面的 ! 行）"
  fi
  ok "fixtures 自检通过"
}

cmd_system_prompt() {
  local kind="${1:-}"
  [[ -n "$kind" ]] || die "用法：system-prompt <${PROMPT_KINDS[*]}>"
  need_python
  prompt_source_file "$kind" >/dev/null || die "未知提示词：$kind（可选：${PROMPT_KINDS[*]}）"
  geo_py extract "$(prompt_source_file "$kind")" "$(prompt_source_const "$kind")"
  echo
}

cmd_llm() {
  need_python
  local name="" prompt_file="" body_file="" system_kind="" system_file="" json_object="true"
  local model="$DEFAULT_MODEL" base_url="$DEFAULT_BASE_URL" temperature="$DEFAULT_TEMPERATURE"
  local save_key_copy=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="${2:-}"; shift 2 ;;
      --prompt-file) prompt_file="${2:-}"; shift 2 ;;
      --body-file) body_file="${2:-}"; shift 2 ;;
      --system) system_kind="${2:-}"; shift 2 ;;
      --system-file) system_file="${2:-}"; shift 2 ;;
      --model) model="${2:-}"; shift 2 ;;
      --base-url) base_url="${2:-}"; shift 2 ;;
      --temperature) temperature="${2:-}"; shift 2 ;;
      --no-json) json_object="false"; shift ;;
      --save-key-copy) save_key_copy=1; shift ;;
      *) die "llm：未知参数 $1（用 help 看用法）" ;;
    esac
  done

  [[ -n "$name" ]] || die "llm：必须给 --name（例如 entity_card / prompt_expand）"
  [[ -n "${GEO_LLM_API_KEY:-}" ]] || die "llm：请先 export GEO_LLM_API_KEY=...（不要写在命令行里）"

  local url="${base_url%/}/chat/completions"
  local out="$LLM_DIR/$name.json"
  local tmp_body tmp_cfg tmp_out
  tmp_body=$(mktemp) && tmp_cfg=$(mktemp) && tmp_out=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp_body' '$tmp_cfg' '$tmp_out'" EXIT
  chmod 600 "$tmp_cfg"

  if [[ -n "$body_file" ]]; then
    info "使用给定请求体：$body_file"
    cp "$body_file" "$tmp_body"
  else
    [[ -n "$prompt_file" ]] || die "llm：需要 --prompt-file 或 --body-file"
    local resolved_system="-"
    if [[ -n "$system_kind" ]]; then
      local system_tmp
      system_tmp=$(mktemp)
      cmd_system_prompt "$system_kind" > "$system_tmp"
      resolved_system="$system_tmp"
    elif [[ -n "$system_file" ]]; then
      resolved_system="$system_file"
    fi
    geo_py body "$model" "$temperature" "$prompt_file" "$resolved_system" "$json_object" > "$tmp_body"
  fi

  # Key 只经 --config 临时文件传递，不进 argv（避免出现在 ps 输出里）
  printf 'header = "Authorization: Bearer %s"\n' "$GEO_LLM_API_KEY" > "$tmp_cfg"
  info "POST $url（model=$model）"
  local status
  status=$(curl -sS --config "$tmp_cfg" \
    --header 'Content-Type: application/json' \
    --data-binary "@$tmp_body" \
    --max-time "$DEFAULT_TIMEOUT" \
    --output "$tmp_out" --write-out '%{http_code}' "$url")
  if [[ "$status" != "200" ]]; then
    cat "$tmp_out" >&2
    die "上游返回 HTTP $status，未写入 fixture"
  fi

  if grep -qF "$GEO_LLM_API_KEY" "$tmp_out"; then
    die "响应里出现了 API Key，已拒绝写入（请检查上游网关）"
  fi

  geo_py validate-llm "$tmp_out" >/dev/null || die "响应不是合法的 chat.completion 结构，未写入"
  cp "$tmp_out" "$out"
  ok "已写入 fixtures/llm/$name.json"

  local key
  key=$(geo_py key "$url" "$tmp_body")
  info "fixture_key = $key（= sha256(url + body) 前 16 位，与 geo_llm::fixture_key 同口径）"
  if [[ $save_key_copy -eq 1 ]]; then
    cp "$tmp_out" "$LLM_DIR/$key.json"
    ok "同时写入 fixtures/llm/$key.json，可被 FixtureTransport::from_dir 直接命中"
  fi

  local hits
  hits=$(geo_py compliance "$out" "$ADLAW_TERMS" || true)
  if [[ -n "$hits" ]]; then
    warn "录制内容命中绝对化用语：$(echo "$hits" | tr '\n' ' ')；请人工改写后再入库（check 会拦下）"
  fi
  warn "提醒：真实模型输出可能带真实企业信息，入库前必须虚构化（见 fixtures/llm/README.md）"
  info "下一步：mise exec -- cargo test --workspace && scripts/record-fixtures.sh check"
}

cmd_http() {
  need_python
  local base_url="" out_dir="$HTTP_DIR"
  local paths=("/" "/about.html" "/products.html" "/faq.html" "/contact.html" "/robots.txt")

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-url) base_url="${2:-}"; shift 2 ;;
      --out) out_dir="${2:-}"; shift 2 ;;
      --paths) read -r -a paths <<< "${2:-}"; shift 2 ;;
      *) die "http：未知参数 $1（用 help 看用法）" ;;
    esac
  done

  [[ -n "$base_url" ]] || die "http：必须给 --base-url（只能录你有权抓取的站点）"
  mkdir -p "$out_dir"

  local path file name status
  for path in "${paths[@]}"; do
    name=$(printf '%s' "$path" | sed -e 's#^/##' -e 's#/#_#g')
    [[ -n "$name" ]] || name="index.html"
    [[ "$name" == *.html || "$name" == *.txt ]] || name="$name.html"
    file="$out_dir/$name"
    status=$(curl -sSL --max-time 30 --output "$file" --write-out '%{http_code}' "${base_url%/}/$path" || echo "000")
    if [[ "$status" == "200" ]]; then
      if geo_py is-utf8 "$file"; then
        ok "$path → $name（UTF-8）"
      else
        ok "$path → $name（非 UTF-8，保留原始字节，适合当编码夹具）"
      fi
    else
      rm -f "$file"
      warn "$path 返回 HTTP $status，已跳过"
    fi
  done

  warn "录制的是真实站点内容：入库前必须替换品牌名/联系方式/资质编号为虚构样本，"
  warn "并保留 fixtures/http/README.md 里记录的 canary 与 robots 约束，否则测试会失效。"
  info "下一步：mise exec -- cargo test -p geo-crawler && scripts/record-fixtures.sh check"
}

cmd_help() {
  cat <<'USAGE'
用法：scripts/record-fixtures.sh <子命令> [参数]

离线自检（不需要 Key、不联网）：
  check [--update]              校验 fixtures/ 结构、GBK 字节、合规词与提示词指纹
                                --update：改过系统提示词并重录后，刷新指纹文件

读取当前提示词（真值源是 Rust 代码，不在此脚本里复制一份）：
  system-prompt <entity_card|expand|rewrite>

重录 LLM 响应（需要 GEO_LLM_API_KEY）：
  llm --name <fixture 名> --prompt-file <用户消息文件> [--system <entity_card|expand|rewrite>]
      [--system-file <文件>] [--body-file <完整请求体>] [--model deepseek-chat]
      [--base-url https://api.deepseek.com/v1] [--temperature 0.2] [--no-json] [--save-key-copy]

重录站点页面（只能录你有权抓取的站点）：
  http --base-url <https://example.com> [--out fixtures/http] [--paths "/ /about.html ..."]

环境变量：
  GEO_LLM_API_KEY   必填（llm 子命令）。只从环境读取，脚本不写盘、不打印。
  GEO_LLM_BASE_URL  默认 https://api.deepseek.com/v1（OpenAI 兼容）
  GEO_LLM_MODEL     默认 deepseek-chat
  GEO_LLM_TEMPERATURE 默认 0.2
  GEO_LLM_TIMEOUT   单次请求超时秒数，默认 120

示例：
  export GEO_LLM_API_KEY=...
  printf '品牌：宏宇泵业\n官网正文：…' > /tmp/entity-prompt.txt
  scripts/record-fixtures.sh llm --name entity_card \
    --system entity_card --prompt-file /tmp/entity-prompt.txt --save-key-copy
  scripts/record-fixtures.sh check
USAGE
}

main() {
  local sub="${1:-help}"
  [[ $# -gt 0 ]] && shift
  case "$sub" in
    check) cmd_check "$@" ;;
    system-prompt) cmd_system_prompt "$@" ;;
    llm) cmd_llm "$@" ;;
    http) cmd_http "$@" ;;
    help|-h|--help) cmd_help ;;
    *) cmd_help; die "未知子命令：$sub" ;;
  esac
}

main "$@"
