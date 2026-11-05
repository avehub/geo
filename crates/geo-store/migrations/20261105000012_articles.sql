-- Article Studio：方向 → 模板 → 排期 → 文章（M6，Plan C）。
-- 时间一律 RFC3339 UTC 文本；枚举存 serde snake_case 值；集合存 JSON 文本。

CREATE TABLE article_directions (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_article_directions_project ON article_directions (project_id, created_at, id);

CREATE TABLE article_templates (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    direction_id    TEXT NOT NULL REFERENCES article_directions (id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    slots           TEXT NOT NULL,
    bindings        TEXT NOT NULL,
    kb_modules      TEXT NOT NULL,
    style           TEXT NOT NULL DEFAULT '',
    length          INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_article_templates_project ON article_templates (project_id, created_at, id);
CREATE INDEX idx_article_templates_direction ON article_templates (direction_id);

CREATE TABLE article_schedules (
    id           TEXT PRIMARY KEY NOT NULL,
    project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    template_id  TEXT NOT NULL REFERENCES article_templates (id) ON DELETE CASCADE,
    freq         TEXT NOT NULL,
    time         TEXT NOT NULL,
    weekday      INTEGER,
    enabled      INTEGER NOT NULL,
    next_run_at  TEXT,
    last_run_at  TEXT,
    run_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_article_schedules_project ON article_schedules (project_id, enabled, next_run_at, id);

CREATE TABLE articles (
    id            TEXT PRIMARY KEY NOT NULL,
    project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    direction_id  TEXT NOT NULL,
    template_id   TEXT NOT NULL,
    schedule_id   TEXT,
    source        TEXT NOT NULL,
    title         TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    status        TEXT NOT NULL,
    word_count    INTEGER NOT NULL,
    generated_at  TEXT NOT NULL
);

CREATE INDEX idx_articles_project ON articles (project_id, generated_at DESC, id);
