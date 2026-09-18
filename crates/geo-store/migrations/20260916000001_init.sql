-- P0-A 初始 schema（spec 3.1）。
-- 约定：ID = UUIDv4 文本；时间 = RFC3339 UTC 文本（固定纳秒精度，保证按文本排序即按时间排序）；
-- JSON 列 = serde_json 序列化文本；枚举列 = snake_case 序列化值。
-- 所有 project_id / set_id 建索引；外键一律 ON DELETE CASCADE。

CREATE TABLE projects (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    brand_name      TEXT NOT NULL,
    aliases         TEXT NOT NULL DEFAULT '[]',
    website         TEXT,
    region          TEXT NOT NULL DEFAULT '',
    language        TEXT NOT NULL DEFAULT 'zh_cn',
    industry        TEXT NOT NULL DEFAULT 'b2b_manufacturing',
    industry_label  TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'active',
    archived_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_updated_at ON projects (updated_at DESC);

CREATE TABLE entity_cards (
    project_id   TEXT PRIMARY KEY NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    fields       TEXT NOT NULL,
    field_status TEXT NOT NULL DEFAULT '{}',
    source       TEXT NOT NULL DEFAULT '{}',
    completeness REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE entity_card_revisions (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    field_path TEXT NOT NULL,
    old_value  TEXT,
    new_value  TEXT,
    status     TEXT NOT NULL DEFAULT 'pending',
    note       TEXT,
    edited_at  TEXT NOT NULL
);

CREATE INDEX idx_entity_card_revisions_project_id
    ON entity_card_revisions (project_id, edited_at DESC);

CREATE TABLE competitors (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    aliases    TEXT NOT NULL DEFAULT '[]',
    website    TEXT,
    note       TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_competitors_project_id ON competitors (project_id, position);

CREATE TABLE project_assets (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'owned_page',
    url        TEXT NOT NULL,
    title      TEXT,
    note       TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_project_assets_project_id ON project_assets (project_id, created_at);

CREATE TABLE prompt_sets (
    id                  TEXT PRIMARY KEY NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    label               TEXT NOT NULL DEFAULT '',
    item_count          INTEGER NOT NULL DEFAULT 0,
    content_hash        TEXT NOT NULL DEFAULT '',
    engine_scope        TEXT NOT NULL DEFAULT '[]',
    metric_spec_version TEXT NOT NULL DEFAULT 'geo-metrics-v1',
    sample_size_grade   TEXT NOT NULL DEFAULT 'insufficient',
    created_at          TEXT NOT NULL,
    notes               TEXT
);

CREATE INDEX idx_prompt_sets_project_id ON prompt_sets (project_id, version DESC);

CREATE TABLE prompt_items (
    id             TEXT PRIMARY KEY NOT NULL,
    set_id         TEXT NOT NULL REFERENCES prompt_sets (id) ON DELETE CASCADE,
    text           TEXT NOT NULL,
    intent         TEXT NOT NULL,
    weight         INTEGER NOT NULL DEFAULT 3,
    group_name     TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    source         TEXT NOT NULL DEFAULT 'template',
    competitor_ids TEXT NOT NULL DEFAULT '[]',
    repeat_count   INTEGER NOT NULL DEFAULT 1,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE INDEX idx_prompt_items_set_id ON prompt_items (set_id, position);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
