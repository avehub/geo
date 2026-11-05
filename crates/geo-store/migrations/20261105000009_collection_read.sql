-- M3 多引擎采集读模型（Plan C M3–M7 读路径第一段）。
-- 写路径（collection_start / task_retry）仍 demo-only；本迁移只建读取所需的表。
CREATE TABLE collection_rounds (
    id                  TEXT PRIMARY KEY NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    prompt_set_id       TEXT NOT NULL,
    prompt_set_label    TEXT NOT NULL,
    prompt_set_version  INTEGER NOT NULL,
    label               TEXT NOT NULL,
    round_index         INTEGER NOT NULL,
    status              TEXT NOT NULL,
    engine_scope        TEXT NOT NULL DEFAULT '[]',
    repeat_count        INTEGER NOT NULL DEFAULT 1,
    planned_queries     INTEGER NOT NULL DEFAULT 0,
    completed_queries   INTEGER NOT NULL DEFAULT 0,
    failed_queries      INTEGER NOT NULL DEFAULT 0,
    success_rate        REAL NOT NULL DEFAULT 0,
    started_at          TEXT,
    finished_at         TEXT,
    metric_spec_version TEXT NOT NULL,
    sample_size_grade   TEXT NOT NULL,
    notes               TEXT
);

CREATE INDEX idx_collection_rounds_project ON collection_rounds (project_id, round_index);

CREATE TABLE collection_engine_runs (
    round_id          TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    engine            TEXT NOT NULL,
    channel           TEXT NOT NULL,
    model             TEXT NOT NULL,
    planned           INTEGER NOT NULL DEFAULT 0,
    succeeded         INTEGER NOT NULL DEFAULT 0,
    failed            INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms    INTEGER NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (round_id, engine)
);

CREATE TABLE collection_tasks (
    id             TEXT PRIMARY KEY NOT NULL,
    round_id       TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    prompt_id      TEXT NOT NULL,
    prompt_text    TEXT NOT NULL,
    intent         TEXT NOT NULL,
    engine         TEXT NOT NULL,
    channel        TEXT NOT NULL,
    status         TEXT NOT NULL,
    attempt        INTEGER NOT NULL DEFAULT 1,
    failure_reason TEXT,
    record_id      TEXT,
    queued_at      TEXT NOT NULL,
    finished_at    TEXT,
    latency_ms     INTEGER
);

CREATE INDEX idx_collection_tasks_round ON collection_tasks (round_id, queued_at);

CREATE TABLE collection_records (
    id                TEXT PRIMARY KEY NOT NULL,
    round_id          TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    prompt_id         TEXT NOT NULL,
    prompt_text       TEXT NOT NULL,
    intent            TEXT NOT NULL,
    engine            TEXT NOT NULL,
    model             TEXT NOT NULL,
    channel           TEXT NOT NULL,
    status            TEXT NOT NULL,
    failure_reason    TEXT,
    mentioned         INTEGER NOT NULL DEFAULT 0,
    rank              INTEGER,
    sentiment         TEXT,
    citation_count    INTEGER NOT NULL DEFAULT 0,
    collected_at      TEXT NOT NULL,
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    repeat_index      INTEGER NOT NULL DEFAULT 1,
    answer_text       TEXT NOT NULL DEFAULT '',
    screenshot_path   TEXT
);

CREATE INDEX idx_collection_records_round ON collection_records (round_id, collected_at DESC);

CREATE TABLE collection_citations (
    record_id   TEXT NOT NULL REFERENCES collection_records (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    url         TEXT NOT NULL,
    domain      TEXT NOT NULL,
    title       TEXT,
    source_type TEXT NOT NULL,
    PRIMARY KEY (record_id, position)
);
