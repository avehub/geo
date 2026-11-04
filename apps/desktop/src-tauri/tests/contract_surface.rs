//! Plan C 前置契约门禁（`contracts/` 下的两份共享清单）。
//!
//! 1. `ipc-command-surface.json`：`generate_handler![]` 必须与 `rust_registered` **逐条相等**；
//!    前端侧的同一份断言在 `apps/desktop/ui/src/api/client.command-surface.test.ts`。
//!    两侧合起来才有完整语义：Rust 注册 == rust_registered，IPC 清单 == rust_registered ∪ pending。
//! 2. `search-import-reasons.json`：导入 reason 目录。Rust 导入服务落地后，这里的
//!    `EXPECTED_REASONS` 必须替换成枚举的 serde 值集合，而不是继续手写常量。
//!
//! 🔴 用 `include_str!`：清单缺了或路径错了在**编译期**就炸掉，不会出现「测试没跑但看起来绿」。

use serde_json::Value;

const COMMAND_SURFACE: &str = include_str!("../../../../contracts/ipc-command-surface.json");
const SEARCH_REASONS: &str = include_str!("../../../../contracts/search-import-reasons.json");
const IPC_MOD: &str = include_str!("../src/ipc/mod.rs");

/// 从 `generate_handler![]` 源码里按出现顺序提取命令名（`module::command,` → `command`）。
fn registered_commands() -> Vec<String> {
    let block = IPC_MOD
        .split("generate_handler![")
        .nth(1)
        .expect("ipc/mod.rs 里找不到 generate_handler![")
        .split(']')
        .next()
        .expect("generate_handler![ 没有闭合的 ]");

    block
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("//") {
                return None;
            }
            let name = line.trim_end_matches(',').rsplit("::").next()?.trim();
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

#[test]
fn command_surface_matches_generate_handler() {
    let surface: Value = serde_json::from_str(COMMAND_SURFACE).expect("命令面契约不是合法 JSON");
    let declared: Vec<String> = surface["rust_registered"]
        .as_array()
        .expect("rust_registered 必须是数组")
        .iter()
        .map(|entry| entry.as_str().expect("命令名必须是字符串").to_string())
        .collect();

    assert_eq!(
        registered_commands(),
        declared,
        "generate_handler![] 与 contracts/ipc-command-surface.json 的 rust_registered 不一致：\
         新增 / 删除命令时必须同一次提交更新清单"
    );
    assert_eq!(declared.len(), 60, "Rust 已注册命令数应与当前基线一致");

    let pending = surface["pending"].as_array().expect("pending 必须是数组");
    assert!(
        !pending.is_empty(),
        "pending 不应为空（demo-only 命令仍存在）"
    );

    let mut pending_names = Vec::new();
    for entry in pending {
        let command = entry["command"]
            .as_str()
            .expect("pending.command 必须是字符串");
        let ledger = entry["ledger"]
            .as_str()
            .expect("pending.ledger 必须是字符串");
        assert!(
            ledger.starts_with("E-") && ledger[2..].chars().all(|c| c.is_ascii_digit()),
            "{command} 的台账编号形状不对：{ledger}"
        );
        pending_names.push(command.to_string());
    }

    let mut unique = pending_names.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), pending_names.len(), "pending 里有重复命令");

    for command in &declared {
        assert!(
            !pending_names.contains(command),
            "{command} 同时出现在 rust_registered 与 pending"
        );
    }
}

#[test]
fn search_import_reason_catalog_is_well_formed() {
    let catalog: Value = serde_json::from_str(SEARCH_REASONS).expect("reason 契约不是合法 JSON");
    let entries = catalog["reasons"].as_array().expect("reasons 必须是数组");
    assert!(!entries.is_empty(), "reasons 不应为空");

    let mut seen = Vec::new();
    for entry in entries {
        let reason = entry["reason"].as_str().expect("reason 必须是字符串");
        let note = entry["note"].as_str().expect("note 必须是字符串");
        assert!(!note.trim().is_empty(), "{reason} 缺说明");
        assert!(entry["params"].is_array(), "{reason} 的 params 必须是数组");
        seen.push(reason.to_string());
    }

    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), seen.len(), "reasons 里有重复项");

    // 🔴 导入服务落地前的临时钉法：换成 Rust 枚举后，改用枚举 serde 值集合与本清单比较。
    let expected = [
        "empty",
        "unknown_field",
        "missing_header",
        "invalid_format",
        "required",
        "not_allowed",
    ];
    let mut expected = expected
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    expected.sort();
    assert_eq!(unique, expected, "reason 集合与导入服务约定的六个值不一致");
}
