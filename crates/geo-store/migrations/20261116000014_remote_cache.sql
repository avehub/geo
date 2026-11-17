-- 远程内容（数据面）本地缓存与同步日志。
--
-- 🔴 设计要点：
-- 1. `remote_cache` 以 item_key 为主键（一项一行，存"当前生效版本"）。
--    不做多版本留存：客户端只需要"现在该用哪份"，历史版本是后台的职责。
-- 2. `source` 区分 'remote'（服务端拉取并验签通过）与 'builtin'（编译期兜底快照）。
--    🔴 必须留这个字段：设置页要如实告诉用户"当前用的是远程版本还是内置版本"，
--       不能让用户误以为拿到的是最新内容（I-1 的可观测面）。
-- 3. 🔴 **不存任何密钥**（AGENTS 规则 3）：minisign 公钥是编译期常量，
--    私钥永远不进客户端。signature 列存的是**产物的签名**（公开信息，
--    随数据面一起分发），不是密钥材料。
-- 4. `remote_sync_log` 只增不改：它是"为什么我的内容没更新"的唯一排查依据。
--    status 用 CHECK 约束闭合取值，避免各处拼字符串漂移。

CREATE TABLE remote_cache (
    item_key    TEXT PRIMARY KEY NOT NULL,
    version     INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    signature   TEXT NOT NULL,
    body        BLOB NOT NULL,
    accepted_at TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('remote', 'builtin'))
);

CREATE TABLE remote_sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    -- ok            全部成功
    -- partial       部分项成功、部分失败（仍可用，degraded=1）
    -- rejected_digest     产物 sha256 与 manifest 声明不符（🔴 可能被篡改）
    -- rejected_signature  minisign 验签失败（🔴 可能被篡改）
    -- rolled_back        远程版本低于本地已接受版本（防回滚拒绝）
    -- unavailable        网络不可达/超时/DNS 失败/5xx（回落内置，不报错给用户）
    status        TEXT NOT NULL CHECK (status IN (
                      'ok', 'partial', 'rejected_digest', 'rejected_signature',
                      'rolled_back', 'unavailable'
                  )),
    changed_items TEXT NOT NULL DEFAULT '[]',
    degraded      INTEGER NOT NULL DEFAULT 0,
    -- 🔴 只存稳定错误码，不存上游响应体原文（可能含敏感信息，且会让日志膨胀）
    error_code    TEXT
);

CREATE INDEX idx_remote_sync_log_started ON remote_sync_log (started_at DESC);
