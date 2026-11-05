-- M5.5 站长数据（Plan C 第五切片第一段）：数据源 + 优化机会。
-- 指标 / AI 汇总 / C 类留档 / 自建索引 / 流量分布仍待导入与采集族落地。
CREATE TABLE search_sources (
    id                TEXT PRIMARY KEY NOT NULL,
    project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    auth_mode         TEXT NOT NULL,
    ingest_modes      TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL,
    region            TEXT NOT NULL,
    "group"           TEXT NOT NULL,
    binding           TEXT NOT NULL DEFAULT '{}',
    credentials_state TEXT NOT NULL,
    secret_ref        TEXT,
    data_through      TEXT,
    checked_at        TEXT,
    check_detail      TEXT,
    note              TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (project_id, kind)
);

CREATE INDEX idx_search_sources_project ON search_sources (project_id, kind);

CREATE TABLE search_opportunities (
    id                    TEXT PRIMARY KEY NOT NULL,
    project_id            TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    rule_id               INTEGER NOT NULL,
    title_key             TEXT NOT NULL,
    basis                 TEXT NOT NULL,
    evidence_metric_ids   TEXT NOT NULL DEFAULT '[]',
    prescription_category TEXT NOT NULL,
    impact                TEXT NOT NULL,
    difficulty            TEXT NOT NULL,
    confidence            REAL NOT NULL,
    status                TEXT NOT NULL DEFAULT 'new',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE INDEX idx_search_opportunities_project ON search_opportunities (project_id, status);
