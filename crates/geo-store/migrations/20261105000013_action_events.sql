-- M6 闭环归因：处方状态变更事件账本。
-- 每次人工翻状态追加一行；重建看板不清账，归因按「基线轮结束 → 复测轮结束」的窗口取 Done 事件。

CREATE TABLE action_events (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    action_id  TEXT NOT NULL,
    round_id   TEXT NOT NULL,
    category   TEXT NOT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL,
    at         TEXT NOT NULL
);

CREATE INDEX idx_action_events_project ON action_events (project_id, at);
CREATE INDEX idx_action_events_action ON action_events (action_id, at);
