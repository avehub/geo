//! 远程内容（数据面）的**纯函数**领域逻辑。
//!
//! 🔴 本模块不做 IO、不依赖其他 crate（AGENTS 规则 4）：不读文件、不发网络、
//! 不碰数据库。所有需要 IO 的部分（拉取、验签、落缓存）都在壳侧
//! `apps/desktop/src-tauri/src/services/remote_service.rs`。
//! 这样"判定逻辑"可以被穷举测试，而不会因为网络/磁盘的偶发状态变成 flaky。
//!
//! # 三条不变量（设计文档 §2.4）
//!
//! - **I-1 断网可用**：拿不到远程内容时回落 [`builtin_fallback`]，应用照常工作。
//! - **I-2 数据面纯净**：manifest 与产物里没有任何鉴权/埋点字段，本模块也不解析这类字段。
//! - **I-3 无后台轮询**：同步只在启动时与用户手动触发时发生（由壳侧保证，
//!   本模块只提供"该拉哪些"的判定 [`select_outdated`]）。
//!
//! # 防回滚（🔴 安全关键）
//!
//! [`is_acceptable`] 要求远程 `version` **不低于**本地已接受版本。
//! 没有这条，任何能篡改我方服务器/DNS 的人都可以把客户端的规则包
//! 降级到一个旧的、含已知缺陷的版本 —— 而 digest 与签名都会"校验通过"，
//! 因为那确实是旧版本的合法签名。签名证明"是我们发的"，
//! **版本号单调性**才证明"是最新的"。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::GeoError;

/// manifest.items 的闭合枚举。
///
/// 🔴 必须与后台仓 `packages/contracts` 的 `MANIFEST_ITEM_KEYS` 及
/// `manifest.schema.json` 的 `items.properties` **三方一致**。
/// 后台仓有 `scripts/sync-remote-contracts.sh` 做 digest 校验，
/// 本仓 `contracts/remote/` 是 vendor 来的快照。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ItemKey {
    Release,
    Engines,
    Providers,
    RateLimits,
    Rulepacks,
    Templates,
    Compliance,
    Legal,
    Privacy,
    Notices,
}

impl ItemKey {
    /// 全部取值（顺序与后台 `MANIFEST_ITEM_KEYS` 一致）。
    pub const ALL: [ItemKey; 10] = [
        Self::Release,
        Self::Engines,
        Self::Providers,
        Self::RateLimits,
        Self::Rulepacks,
        Self::Templates,
        Self::Compliance,
        Self::Legal,
        Self::Privacy,
        Self::Notices,
    ];

    /// manifest JSON 里的键名。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Engines => "engines",
            Self::Providers => "providers",
            Self::RateLimits => "rate_limits",
            Self::Rulepacks => "rulepacks",
            Self::Templates => "templates",
            Self::Compliance => "compliance",
            Self::Legal => "legal",
            Self::Privacy => "privacy",
            Self::Notices => "notices",
        }
    }

    /// 由键名解析；未知键返回 `None`（调用方应**忽略并记 warning**，不报错 —— 见
    /// [`parse_manifest`] 的前向兼容说明）。
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

/// manifest 里单个产物的描述。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestItem {
    /// 相对 `/client/v1/` 的路径。
    pub path: String,
    /// 🔴 **发布序号**（单调递增整数），不是语义化版本。防回滚就比这个。
    pub version: u64,
    /// SHA-256 十六进制小写。
    pub sha256: String,
    /// minisign 签名（多行文本）。公钥内置于客户端。
    pub signature: String,
}

/// 解析后的 manifest。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub schema_version: u64,
    pub generated_at: String,
    pub items: BTreeMap<ItemKey, ManifestItem>,
    /// 🔴 客户端不认识的键（新版本后台新增的产物种类）。
    ///    **忽略但不报错** —— 老客户端遇到新产物只当没看见，这是前向兼容的关键：
    ///    否则后台每加一种产物，所有未升级的客户端就集体拒绝整份 manifest。
    pub unknown_keys: Vec<String>,
}

/// 本地已接受的版本记录（来自 `remote_cache` 表）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalEntry {
    pub version: u64,
    pub sha256: String,
}

/// 本地状态：每项产物当前生效的版本与摘要。
pub type LocalVersions = BTreeMap<ItemKey, LocalEntry>;

/// 当前支持的 schema_version。
pub const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// 解析 manifest JSON。
///
/// # 错误
/// - 缺 `items.release` → `Validation { field: "items.release", reason: "required" }`
///   （release 是数据面入口，没有它整个 manifest 无意义）
/// - `schema_version` 大于 [`SUPPORTED_SCHEMA_VERSION`] → `Validation { reason: "out_of_range" }`
///   （🔴 只支持"新增可选字段"式的前向兼容；主版本号升高意味着破坏性变更，
///   老客户端必须明确拒绝而不是猜着解析）
///
/// 🔴 **错误信息里不含原始 JSON**：manifest 每项都带 minisign 签名，
/// 把整份 JSON 塞进错误消息会让签名进日志与 IPC 响应（AGENTS 规则 3：
/// 错误里不带 value）。serde 的原文也可能包含片段，所以统一收敛成固定文案 + 字段名。
pub fn parse_manifest(json: &str) -> Result<Manifest, GeoError> {
    // 用一个宽容的中间结构接收：未知 item key 要能被收集而不是直接报错
    #[derive(Deserialize)]
    struct Raw {
        schema_version: Option<u64>,
        generated_at: Option<String>,
        items: Option<BTreeMap<String, serde_json::Value>>,
    }

    let raw: Raw = serde_json::from_str(json).map_err(|_| {
        // 🔴 刻意丢弃 serde 的原文：它会把出问题的 JSON 片段带进 message
        GeoError::validation("manifest", "parse_failed")
    })?;

    let schema_version = raw
        .schema_version
        .ok_or_else(|| GeoError::validation("schema_version", "required"))?;
    if schema_version > SUPPORTED_SCHEMA_VERSION {
        let mut extra = BTreeMap::new();
        extra.insert(
            "expected".to_string(),
            format!("<={SUPPORTED_SCHEMA_VERSION}"),
        );
        extra.insert("value".to_string(), schema_version.to_string());
        return Err(GeoError::Validation {
            field: "schema_version".into(),
            reason: "out_of_range".into(),
            extra,
        });
    }

    let raw_items = raw
        .items
        .ok_or_else(|| GeoError::validation("items", "required"))?;
    if raw_items.is_empty() {
        return Err(GeoError::validation("items", "empty"));
    }

    let mut items = BTreeMap::new();
    let mut unknown_keys = Vec::new();
    for (key, value) in raw_items {
        let Some(item_key) = ItemKey::parse(&key) else {
            // 🔴 前向兼容：未知键忽略 + 记录，不报错
            unknown_keys.push(key);
            continue;
        };
        let item: ManifestItem = serde_json::from_value(value).map_err(|_| {
            // 同样不回显原文（含 signature）
            GeoError::validation(format!("items.{key}"), "invalid_format")
        })?;
        items.insert(item_key, item);
    }
    unknown_keys.sort();

    // 🔴 release 是入口项，缺了就没法工作
    if !items.contains_key(&ItemKey::Release) {
        return Err(GeoError::validation("items.release", "required"));
    }

    Ok(Manifest {
        schema_version,
        generated_at: raw.generated_at.unwrap_or_default(),
        items,
        unknown_keys,
    })
}

/// 🔴 防回滚判定：远程版本必须 **>=** 本地已接受版本。
///
/// `local` 为 `None` 表示本地还没有这一项（首次同步）→ 一律接受。
/// 相等也接受（幂等：digest 变了但版本没变的情况由 [`select_outdated`] 负责挑出来）。
///
/// 为什么这条不能省：签名只能证明"这份产物是我们签的"，
/// **不能**证明"它是最新的"。攻击者若控制了服务器或 DNS，
/// 完全可以回放一个**旧的、签名合法**的版本，把客户端降级到有已知缺陷的规则包上。
pub fn is_acceptable(remote_version: u64, local: Option<&LocalEntry>) -> bool {
    match local {
        None => true,
        Some(l) => remote_version >= l.version,
    }
}

/// 挑出需要重新拉取的项：版本变化 **或** digest 变化。
///
/// 🔴 两个条件都要看：
/// - 只看 version：后台重新发布同一版本号但内容修了（例如撤回一个规则包后
///   重建 index.json）就会漏掉
/// - 只看 digest：版本号涨了但内容碰巧相同（例如重复发布）会白拉一次
///
/// 同时会跳过 [`is_acceptable`] 判定为不可接受的项（防回滚）——
/// 返回的列表是"**该拉且允许拉**"的集合。
pub fn select_outdated(local: &LocalVersions, remote: &Manifest) -> Vec<ItemKey> {
    let mut out = Vec::new();
    for key in ItemKey::ALL {
        let Some(item) = remote.items.get(&key) else {
            // 远程没有这一项 → 视为"无远程更新"，继续用本地/内置版本（I-1）
            continue;
        };
        let cur = local.get(&key);
        if !is_acceptable(item.version, cur) {
            // 🔴 静默跳过而不是报错：远程比本地旧说明有人在回放旧 manifest，
            //    此时正确行为是"继续用本地版本"，把错误抛给用户只会造成困惑。
            //    壳侧应当把这件事记进 sync_log（reason=rolled_back）。
            continue;
        }
        let need = match cur {
            None => true,
            Some(l) => l.version != item.version || l.sha256 != item.sha256,
        };
        if need {
            out.push(key);
        }
    }
    out
}

/// 校验一段产物字节的 SHA-256 是否与 manifest 声明一致。
///
/// 🔴 纯函数：只比对，不做 IO。壳侧负责把字节取回来。
/// 十六进制比较**大小写不敏感**（后台产出小写，但历史数据/人工填写可能大写）。
pub fn digest_matches(bytes: &[u8], expected_sha256: &str) -> bool {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let actual = h.finalize();
    let hex: String = actual.iter().map(|b| format!("{b:02x}")).collect();
    hex.eq_ignore_ascii_case(expected_sha256.trim())
}

/// 用 minisign 公钥校验一段产物字节的签名。
///
/// 🔴 **fail closed**：公钥为空/解析不了、签名格式不认识、校验不过 —— 一律返回 `false`。
/// 验不了就是不通过，绝不能"跳过验签当作通过"（这正是 2026-11-17 后台
/// `_env.sh` 只读根 `.env` 导致 `MINISIGN_PUBLIC_KEY` 为空时暴露的那类缺陷）。
///
/// `public_key` 允许两种形态：单行 base64（环境变量里最自然的写法），
/// 或 `minisign.pub` 那种两行文件（`untrusted comment: …` + base64）。
///
/// `allow_legacy = true`：兼容 minisign 0.5 之前生成的、未做 BLAKE2b 预哈希的
/// `Ed` 签名。新签名是 `ED`（预哈希），两条路径都由上游库验证。
pub fn verify_signature(public_key: &str, data: &[u8], signature: &str) -> bool {
    let key_b64 = public_key
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("untrusted comment:"))
        .unwrap_or("");
    if key_b64.is_empty() || signature.trim().is_empty() {
        return false;
    }
    let Ok(key) = minisign_verify::PublicKey::from_base64(key_b64) else {
        return false;
    };
    let Ok(sig) = minisign_verify::Signature::decode(signature.trim()) else {
        return false;
    };
    key.verify(data, &sig, true).is_ok()
}

/// 内置兜底清单（编译期固化）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuiltinManifest {
    pub schema_version: u64,
    pub generated_at: String,
    pub items: BTreeMap<String, BuiltinEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuiltinEntry {
    pub file: String,
    pub version: u64,
    pub sha256: String,
}

const BUILTIN_MANIFEST: &str = include_str!("../data/remote-builtin/builtin-manifest.json");
const BUILTIN_RELEASE: &str = include_str!("../data/remote-builtin/release.json");
const BUILTIN_ENGINES: &str = include_str!("../data/remote-builtin/engines.json");
const BUILTIN_PROVIDERS: &str = include_str!("../data/remote-builtin/providers.json");
const BUILTIN_RATE_LIMITS: &str = include_str!("../data/remote-builtin/rate_limits.json");
const BUILTIN_RULEPACKS: &str = include_str!("../data/remote-builtin/rulepacks.json");
const BUILTIN_TEMPLATES: &str = include_str!("../data/remote-builtin/templates.json");
const BUILTIN_COMPLIANCE: &str = include_str!("../data/remote-builtin/compliance.json");
const BUILTIN_PRIVACY: &str = include_str!("../data/remote-builtin/privacy.json");

/// 🔴 内置兜底数据（I-1：断网/服务端全挂时应用照常工作）。
///
/// 用 `include_str!` 编译进二进制，**不是**运行时读文件：
/// 磁盘上的文件可能损坏、被删、权限不对，而"兜底"必须无条件可用。
///
/// 🔴 内置内容**不做验签**：它随二进制一起签名分发，可信度等同于代码本身；
/// 能改内置内容的人也能改内置公钥，验签在这里不提供任何额外保证。
/// 更重要的是，若对内置内容验签，一旦内置快照与公钥版本错配，
/// 就会连**兜底**都不可用 —— 那是自伤。
pub fn builtin_fallback(key: ItemKey) -> Option<&'static str> {
    match key {
        ItemKey::Release => Some(BUILTIN_RELEASE),
        ItemKey::Engines => Some(BUILTIN_ENGINES),
        ItemKey::Providers => Some(BUILTIN_PROVIDERS),
        ItemKey::RateLimits => Some(BUILTIN_RATE_LIMITS),
        ItemKey::Rulepacks => Some(BUILTIN_RULEPACKS),
        ItemKey::Templates => Some(BUILTIN_TEMPLATES),
        ItemKey::Compliance => Some(BUILTIN_COMPLIANCE),
        ItemKey::Privacy => Some(BUILTIN_PRIVACY),
        // 🔴 legal / notices 没有内置兜底：法务文档必须由服务端提供**已发布**版本，
        //    把一份可能过期的隐私政策编译进客户端，比"取不到"更危险
        //    （用户会读到一份我们已废止的口径）。取不到时 UI 应明确提示
        //    "无法获取最新政策"，而不是显示旧文本。
        ItemKey::Legal | ItemKey::Notices => None,
    }
}

/// 解析内置兜底清单（用于 UI 展示"当前用的是内置版本 vX"）。
pub fn builtin_manifest() -> Result<BuiltinManifest, GeoError> {
    serde_json::from_str(BUILTIN_MANIFEST)
        .map_err(|_| GeoError::validation("builtin_manifest", "parse_failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一份合法 manifest JSON（含 release）
    fn manifest_json(items: &[(&str, u64, &str)], schema_version: u64) -> String {
        let mut map = serde_json::Map::new();
        for (k, v, sha) in items {
            let mut o = serde_json::Map::new();
            o.insert("path".into(), format!("p/{k}.json").into());
            o.insert("version".into(), (*v).into());
            o.insert("sha256".into(), (*sha).into());
            o.insert("signature".into(), "untrusted comment: t\nSIG".into());
            map.insert((*k).to_string(), o.into());
        }
        let mut root = serde_json::Map::new();
        root.insert("schema_version".into(), schema_version.into());
        root.insert("generated_at".into(), "2026-11-17T00:00:00Z".into());
        root.insert("items".into(), map.into());
        serde_json::Value::Object(root).to_string()
    }

    const SHA_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn item_key_roundtrips_through_its_wire_name() {
        for k in ItemKey::ALL {
            assert_eq!(ItemKey::parse(k.as_str()), Some(k));
        }
        // 🔴 rate_limits 是那个曾经在后端存在、契约里缺失的键（后台仓已修）
        assert_eq!(ItemKey::parse("rate_limits"), Some(ItemKey::RateLimits));
        assert_eq!(ItemKey::parse("nonsense"), None);
        assert_eq!(ItemKey::ALL.len(), 10);
    }

    #[test]
    fn parses_a_valid_manifest() {
        let m = parse_manifest(&manifest_json(
            &[("release", 3, SHA_A), ("rulepacks", 7, SHA_B)],
            1,
        ))
        .expect("应解析成功");
        assert_eq!(m.schema_version, 1);
        assert_eq!(m.items.len(), 2);
        assert_eq!(m.items[&ItemKey::Release].version, 3);
        assert!(m.unknown_keys.is_empty());
    }

    // ---------- 计划要求的四条 ----------

    #[test]
    fn select_outdated_picks_only_items_whose_digest_or_version_changed() {
        let mut local = LocalVersions::new();
        local.insert(
            ItemKey::Release,
            LocalEntry {
                version: 3,
                sha256: SHA_A.into(),
            },
        );
        local.insert(
            ItemKey::Rulepacks,
            LocalEntry {
                version: 7,
                sha256: SHA_B.into(),
            },
        );

        let remote = parse_manifest(&manifest_json(
            &[
                ("release", 3, SHA_A),   // 完全相同 → 不挑
                ("rulepacks", 7, SHA_A), // 版本同、digest 变 → 挑
                ("engines", 1, SHA_A),   // 本地没有 → 挑
            ],
            1,
        ))
        .unwrap();

        let out = select_outdated(&local, &remote);
        assert!(out.contains(&ItemKey::Rulepacks), "digest 变化必须被挑出");
        assert!(out.contains(&ItemKey::Engines), "本地缺失必须被挑出");
        assert!(!out.contains(&ItemKey::Release), "完全相同的不该重拉");
    }

    #[test]
    fn is_acceptable_rejects_lower_versions() {
        let local = LocalEntry {
            version: 7,
            sha256: SHA_A.into(),
        };
        // 🔴 防回滚：远程 6 < 本地 7 → 拒绝
        assert!(!is_acceptable(6, Some(&local)));
        assert!(is_acceptable(7, Some(&local)), "相等要接受（幂等）");
        assert!(is_acceptable(8, Some(&local)));
        assert!(is_acceptable(1, None), "本地没有 → 首次同步一律接受");
    }

    #[test]
    fn rolled_back_items_are_excluded_from_select_outdated() {
        let mut local = LocalVersions::new();
        local.insert(
            ItemKey::Release,
            LocalEntry {
                version: 9,
                sha256: SHA_A.into(),
            },
        );
        // 远程回放了一个更旧的 release（签名依然合法 —— 这正是防回滚要挡的）
        let remote = parse_manifest(&manifest_json(&[("release", 3, SHA_B)], 1)).unwrap();
        assert!(select_outdated(&local, &remote).is_empty());
    }

    #[test]
    fn missing_release_errors_without_leaking_the_raw_json() {
        // manifest 里没有 release 项
        let json = manifest_json(&[("rulepacks", 7, SHA_A)], 1);
        let err = parse_manifest(&json).expect_err("缺 items.release 必须报错");
        let msg = format!("{err}");
        let params = err.params();
        // 🔴 错误里不得含原始 JSON（含 signature）
        assert!(!msg.contains("SIG"), "错误信息泄漏了签名内容：{msg}");
        assert!(!msg.contains(&json));
        assert!(!params.values().any(|v| v.contains("SIG")));
        match err {
            GeoError::Validation { field, reason, .. } => {
                assert_eq!(field, "items.release");
                assert_eq!(reason, "required");
            }
            other => panic!("期望 Validation，实际 {other:?}"),
        }
    }

    #[test]
    fn malformed_json_error_does_not_echo_the_payload() {
        let err = parse_manifest(
            "{\"schema_version\":1,\"items\":{\"release\":{\"signature\":\"SECRET-SIG\"}}}",
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(!msg.contains("SECRET-SIG"), "解析错误回显了原文：{msg}");
        assert!(!msg.contains("schema_version"));
    }

    #[test]
    fn unknown_item_keys_are_ignored_not_rejected() {
        // 🔴 前向兼容：后台将来新增产物种类时，未升级的客户端只忽略、不报错。
        //    若这里报错，后台每加一种产物就会让所有老客户端集体拒收整份 manifest。
        let mut raw = manifest_json(&[("release", 3, SHA_A)], 1);
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let mut obj = v.as_object().unwrap().clone();
        let mut future = serde_json::Map::new();
        future.insert("path".into(), "future/x.json".into());
        future.insert("version".into(), 1.into());
        future.insert("sha256".into(), SHA_B.into());
        future.insert("signature".into(), "untrusted comment: t\nSIG".into());
        obj.get_mut("items")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("some_future_kind".into(), future.into());
        raw = serde_json::Value::Object(obj).to_string();

        let m = parse_manifest(&raw).expect("未知键必须被忽略而不是报错");
        assert_eq!(m.unknown_keys, vec!["some_future_kind".to_string()]);
        assert_eq!(m.items.len(), 1, "未知键不得进入 items");
        assert!(m.items.contains_key(&ItemKey::Release));
    }

    #[test]
    fn higher_schema_version_is_rejected() {
        // 🔴 主版本升高 = 破坏性变更，老客户端必须明确拒绝而不是猜着解析
        let err = parse_manifest(&manifest_json(&[("release", 3, SHA_A)], 2)).unwrap_err();
        match err {
            GeoError::Validation {
                field,
                reason,
                extra,
            } => {
                assert_eq!(field, "schema_version");
                assert_eq!(reason, "out_of_range");
                assert_eq!(extra.get("value").map(String::as_str), Some("2"));
            }
            other => panic!("期望 out_of_range，实际 {other:?}"),
        }
    }

    #[test]
    fn digest_matches_is_case_insensitive_and_rejects_tampering() {
        let bytes = br#"{"hello":"world"}"#;
        let real = "d28eda58e8fc0a02b3b9b8e02b0b1a4f0b7d4d5e9d1c6a3f0e8b7a6d5c4b3a29";
        // 用真实计算值断言，而不是硬编码一个可能写错的常量
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(bytes);
        let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
        assert!(digest_matches(bytes, &hex));
        assert!(digest_matches(bytes, &hex.to_uppercase()), "大小写不敏感");
        assert!(!digest_matches(bytes, real), "不同内容不得通过");
        // 🔴 改一个字节必须失败
        let mut tampered = bytes.to_vec();
        let mid = tampered.len() / 2;
        tampered[mid] = tampered[mid].wrapping_add(1);
        assert!(!digest_matches(&tampered, &hex));
    }

    // ---------- 内置兜底（I-1）----------

    #[test]
    fn builtin_fallback_covers_every_key_except_legal_and_notices() {
        for k in ItemKey::ALL {
            match k {
                // 🔴 法务文档刻意**不**内置：把可能过期的隐私政策编译进客户端，
                //    比"取不到"更危险（用户会读到已废止的口径）
                ItemKey::Legal | ItemKey::Notices => {
                    assert!(builtin_fallback(k).is_none(), "{:?} 不应有内置兜底", k);
                }
                other => {
                    let s =
                        builtin_fallback(other).unwrap_or_else(|| panic!("{other:?} 缺内置兜底"));
                    assert!(!s.is_empty(), "{other:?} 内置兜底为空");
                    // 内置内容必须是合法 JSON，否则回落时解析会炸
                    serde_json::from_str::<serde_json::Value>(s)
                        .unwrap_or_else(|e| panic!("{other:?} 内置兜底不是合法 JSON: {e}"));
                }
            }
        }
    }

    #[test]
    fn builtin_manifest_is_parseable_and_consistent_with_fallbacks() {
        let bm = builtin_manifest().expect("内置清单必须可解析");
        assert_eq!(bm.schema_version, 1);
        assert!(!bm.items.is_empty());
        for (key, entry) in &bm.items {
            let ik = ItemKey::parse(key).unwrap_or_else(|| panic!("内置清单含未知键 {key}"));
            let body =
                builtin_fallback(ik).unwrap_or_else(|| panic!("{key} 在清单里但没有兜底内容"));
            // 🔴 内置清单记录的 sha256 必须与编译进来的字节一致：
            //    否则"重新生成快照时忘了更新清单"会静默产生不自洽的兜底数据。
            assert!(
                digest_matches(body.as_bytes(), &entry.sha256),
                "{key} 的内置 sha256 与实际内容不符（快照与清单不同步）"
            );
            assert!(entry.version >= 1, "{key} 内置版本必须 >= 1");
        }
    }

    #[test]
    fn builtin_snapshot_can_seed_local_versions_so_first_sync_does_not_downgrade() {
        // 🔴 内置版本必须能被当作"本地已接受版本"的起点，
        //    否则首次联网同步时，服务端若回放一个比内置更旧的 manifest，
        //    is_acceptable 会因为"本地无记录"而放行 → 降级。
        let bm = builtin_manifest().unwrap();
        let mut local = LocalVersions::new();
        for (key, entry) in &bm.items {
            if let Some(ik) = ItemKey::parse(key) {
                local.insert(
                    ik,
                    LocalEntry {
                        version: entry.version,
                        sha256: entry.sha256.clone(),
                    },
                );
            }
        }
        // 构造一个"比内置旧"的远程 manifest
        let release_v = bm.items.get("release").map(|e| e.version).unwrap_or(1);
        let older = release_v.saturating_sub(1).max(1);
        let remote = parse_manifest(&manifest_json(&[("release", older, SHA_A)], 1)).unwrap();
        if older < release_v {
            assert!(
                !select_outdated(&local, &remote).contains(&ItemKey::Release),
                "内置版本作为基线时，更旧的远程 release 必须被拒绝（防降级）"
            );
        }
    }

    // ------------------------------------------------------------------
    // minisign 验签（真实夹具：用 minisign CLI 现签，私钥已销毁）
    // ------------------------------------------------------------------

    const FIXTURE_PUB: &str = include_str!("../tests/fixtures/minisign/fixture.pub");
    const FIXTURE_SIG: &str = include_str!("../tests/fixtures/minisign/fixture.sig");
    const FIXTURE_PAYLOAD: &str = include_str!("../tests/fixtures/minisign/payload.txt");

    #[test]
    fn real_minisign_signature_verifies() {
        // 🔴 这条钉的是"真 CLI 产出的 4 行签名"能被我们解析并验过。
        //    只测自己造的 base64 没有意义：minisign 的签名文件有
        //    untrusted comment / trusted comment / global signature 三段，
        //    解析错一处就会全线拒收，且症状是"发布正常、客户端全静默回落"。
        assert!(verify_signature(
            FIXTURE_PUB,
            FIXTURE_PAYLOAD.as_bytes(),
            FIXTURE_SIG
        ));
    }

    #[test]
    fn minisign_rejects_tampered_payload_and_bad_inputs() {
        assert!(!verify_signature(
            FIXTURE_PUB,
            b"hello minisign fixture\ntampered",
            FIXTURE_SIG
        ));
        // 公钥为空 → fail closed
        assert!(!verify_signature(
            "",
            FIXTURE_PAYLOAD.as_bytes(),
            FIXTURE_SIG
        ));
        // 签名不是 minisign 格式 → fail closed
        assert!(!verify_signature(
            FIXTURE_PUB,
            FIXTURE_PAYLOAD.as_bytes(),
            "not a signature"
        ));
    }
}
