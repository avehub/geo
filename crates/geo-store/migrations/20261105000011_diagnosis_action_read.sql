-- M5 诊断四视图 + M6 行动看板的读快照（Plan C M3–M7 读路径）。
-- 诊断快照按轮次不可变；行动看板按项目保存整份快照。写路径落地时再决定是否拆表。
CREATE TABLE diagnosis_snapshots (
    round_id TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    kind     TEXT NOT NULL,
    payload  TEXT NOT NULL,
    PRIMARY KEY (round_id, kind)
);

CREATE TABLE action_boards (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
