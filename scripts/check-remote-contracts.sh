#!/usr/bin/env bash
# ============================================================================
# 🔴 校验 vendor 进来的远程契约快照**自洽**（Task 9 / CI 门禁）。
#
# contracts/remote/ 是从后台仓 gdk_geo_admin/packages/contracts 拷来的快照。
# 客户端把 schema `include_str!` 编译进二进制，所以这份快照就是客户端眼中的
# "数据面长什么样"的唯一依据。
#
# 本脚本能在**只有本仓**的环境下跑（CI runner 通常拿不到兄弟仓），检查三件事：
#   ① digests.json 里每份 schema 的 SHA-256 与实际文件一致
#      —— 抓"部分同步"：只拷了 schema 没拷 digests，或反之
#      🔴 只比 `schemas` 映射，不比整个文件的字节：无关字段
#      （例如曾存在的 generated_at 日期戳）会让内容相同的文件天天报漂移。
#   ② 没有 digests.json 未登记的孤儿 schema
#      —— 抓"后台删了某个 schema，本仓还留着旧的"（客户端会 include_str! 到旧契约）
#   ③ 🔴 manifest.schema.json 的 items.properties 必须含 `rate_limits`
#      —— 回归钉：该键曾只在后台代码里存在、契约里缺失，导致线上 manifest
#      违反 additionalProperties:false，客户端整份拒收 → 远程更新静默失效
#
# 跨仓漂移（后台改了 schema 但没重新同步）需要在两仓都在的机器上跑
# 后台仓的 `scripts/sync-remote-contracts.sh`；本脚本抓不到那种情况，
# 但能抓住所有"同步做了一半"的情况。
# ============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/contracts/remote"
P=0; F=0
ok(){ printf '  ✅ %s\n' "$*"; P=$((P+1)); }
no(){ printf '  ❌ %s\n' "$*"; F=$((F+1)); }

if [[ ! -d "$DIR/schemas" ]]; then
  no "找不到 $DIR/schemas —— 还没 vendor 契约快照"
  echo "     修法：在后台仓跑 bash scripts/sync-remote-contracts.sh --write"
  exit 1
fi

echo "[check-remote-contracts] $DIR"

# ---------- ① ② digest 自洽 + 无孤儿 ----------
python3 - "$DIR" <<'PY'
import hashlib, json, os, sys
d = sys.argv[1]
recorded = json.load(open(os.path.join(d, 'digests.json'), encoding='utf-8')).get('schemas', {})
actual = {}
for f in sorted(os.listdir(os.path.join(d, 'schemas'))):
    if f.endswith('.schema.json'):
        actual[f] = hashlib.sha256(open(os.path.join(d,'schemas',f),'rb').read()).hexdigest()
bad = 0
for k, v in sorted(actual.items()):
    if recorded.get(k) != v:
        print(f'  ❌ {k}: digest 与 digests.json 不符（同步只做了一半？）')
        bad += 1
for k in sorted(recorded):
    if k not in actual:
        print(f'  ❌ digests.json 登记了 {k}，但 schemas/ 下没有该文件')
        bad += 1
if bad == 0:
    print(f'  ✅ {len(actual)} 份 schema 的 digest 全部自洽，无孤儿文件')
sys.exit(1 if bad else 0)
PY
[[ $? -eq 0 ]] && P=$((P+1)) || F=$((F+1))

# ---------- ③ manifest schema 的关键 item key ----------
python3 - "$DIR/schemas/manifest.schema.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1], encoding='utf-8'))
items = s['properties']['items']
keys = set(items['properties'].keys())
bad = 0
if items.get('additionalProperties') is not False:
    print('  ❌ items.additionalProperties 必须是 false（否则"闭合枚举"无意义）')
    bad += 1
# 🔴 回归钉：rate_limits 曾在契约里缺失，导致线上 manifest 非法、客户端整份拒收
for required_key in ('release', 'engines', 'providers', 'rate_limits', 'rulepacks',
                     'templates', 'compliance', 'legal', 'privacy', 'notices'):
    if required_key not in keys:
        print(f'  ❌ manifest.schema.json 缺少 items.{required_key}')
        bad += 1
if bad == 0:
    print(f'  ✅ manifest.schema.json 含全部 10 个 item key（含 rate_limits），additionalProperties=false')
sys.exit(1 if bad else 0)
PY
[[ $? -eq 0 ]] && P=$((P+1)) || F=$((F+1))

# ---------- ④ 🔴 与编译进二进制的内置兜底快照对齐 ----------
BUILTIN="$ROOT/crates/geo-domain/data/remote-builtin/builtin-manifest.json"
if [[ -f "$BUILTIN" ]]; then
  python3 - "$BUILTIN" "$DIR/schemas/manifest.schema.json" <<'PY'
import json, sys
bm = json.load(open(sys.argv[1], encoding='utf-8'))
schema_keys = set(json.load(open(sys.argv[2], encoding='utf-8'))['properties']['items']['properties'].keys())
bad = [k for k in bm.get('items', {}) if k not in schema_keys]
if bad:
    print(f'  ❌ 内置兜底快照含 schema 不认识的 item key：{bad}')
    sys.exit(1)
print(f"  ✅ 内置兜底快照的 {len(bm.get('items', {}))} 个 item key 全部在 schema 允许范围内")
PY
  [[ $? -eq 0 ]] && P=$((P+1)) || F=$((F+1))
fi

printf '\n════ %d 通过 / %d 失败 ════\n' $P $F
[[ $F -eq 0 ]]
