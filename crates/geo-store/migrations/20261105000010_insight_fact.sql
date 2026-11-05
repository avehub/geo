-- M4 回答解析与事实核查读模型（Plan C M3–M7 读路径第二段）。
CREATE TABLE answer_insights (
    id               TEXT PRIMARY KEY NOT NULL,
    round_id         TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    record_id        TEXT NOT NULL,
    prompt_id        TEXT NOT NULL,
    prompt_text      TEXT NOT NULL,
    engine           TEXT NOT NULL,
    mentions         TEXT NOT NULL DEFAULT '[]',
    self_mentioned   INTEGER NOT NULL DEFAULT 0,
    self_rank        INTEGER,
    self_sentiment   TEXT,
    answer_shape     TEXT NOT NULL,
    source_types     TEXT NOT NULL DEFAULT '{}',
    confidence       REAL NOT NULL,
    needs_review     INTEGER NOT NULL DEFAULT 0,
    risks            TEXT NOT NULL DEFAULT '[]',
    corrected_fields TEXT NOT NULL DEFAULT '[]',
    reviewed_at      TEXT
);

CREATE INDEX idx_answer_insights_round ON answer_insights (round_id, id);

CREATE TABLE fact_check_issues (
    id                 TEXT PRIMARY KEY NOT NULL,
    round_id           TEXT NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    record_id          TEXT NOT NULL,
    prompt_id          TEXT NOT NULL,
    prompt_text        TEXT NOT NULL,
    engine             TEXT NOT NULL,
    kind               TEXT NOT NULL,
    field_path         TEXT NOT NULL,
    answer_excerpt     TEXT NOT NULL,
    entity_value       TEXT NOT NULL,
    confidence         REAL NOT NULL,
    status             TEXT NOT NULL,
    correction_channel TEXT NOT NULL,
    note               TEXT,
    resolved_at        TEXT
);

CREATE INDEX idx_fact_issues_round ON fact_check_issues (round_id, kind, id);

CREATE TABLE fact_check_summaries (
    round_id             TEXT PRIMARY KEY NOT NULL REFERENCES collection_rounds (id) ON DELETE CASCADE,
    by_kind              TEXT NOT NULL,
    checked_answers      INTEGER NOT NULL DEFAULT 0,
    fact_accuracy        REAL NOT NULL DEFAULT 0,
    false_positive_count INTEGER NOT NULL DEFAULT 0
);
