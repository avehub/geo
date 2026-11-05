-- M5.5 站长数据指标（Plan C A2a）：关键词 / 页面指标、AI 汇总、平台独有留档。
-- 汇总仍在前端 compose 层；这里只存第一方事实的规范化结果。
CREATE TABLE search_metrics (
    id             TEXT PRIMARY KEY NOT NULL,
    project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_kind    TEXT NOT NULL,
    surface        TEXT NOT NULL,
    query          TEXT NOT NULL DEFAULT '',
    page_url       TEXT,
    impressions    INTEGER,
    clicks         INTEGER,
    ctr            REAL,
    citations      INTEGER,
    ai_clicks      INTEGER,
    period_start   TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    data_through   TEXT NOT NULL,
    imported_at    TEXT NOT NULL,
    completeness   TEXT NOT NULL,
    window_source  TEXT NOT NULL,
    mapping_version TEXT NOT NULL
);

CREATE INDEX idx_search_metrics_slot ON search_metrics (project_id, source_kind, period_start, period_end);
CREATE INDEX idx_search_metrics_query ON search_metrics (project_id, query);

CREATE TABLE search_ai_overviews (
    id             TEXT PRIMARY KEY NOT NULL,
    project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_kind    TEXT NOT NULL,
    citations      INTEGER,
    ai_impressions INTEGER,
    ai_clicks      INTEGER,
    ai_ctr         REAL,
    cited_pages    INTEGER,
    period_start   TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    data_through   TEXT NOT NULL,
    imported_at    TEXT NOT NULL,
    completeness   TEXT NOT NULL,
    window_source  TEXT NOT NULL,
    mapping_version TEXT NOT NULL
);

CREATE INDEX idx_search_ai_slot ON search_ai_overviews (project_id, source_kind, period_start, period_end);

CREATE TABLE search_native_extras (
    id          TEXT PRIMARY KEY NOT NULL,
    project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL,
    label       TEXT NOT NULL,
    value_json  TEXT,
    metric_id   TEXT,
    observed_at TEXT NOT NULL
);

CREATE INDEX idx_search_native_project ON search_native_extras (project_id, source_kind);
