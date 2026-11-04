-- M1.2b 知识库（Plan C 第三个纵向切片：kb_board + 条目 CRUD + verify）。
-- kb_generate 仍留在 demo-only 清单。删除条目**不删**修订留痕（DR-119）。
CREATE TABLE kb_entries (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    module          TEXT NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body_markdown   TEXT NOT NULL DEFAULT '',
    url             TEXT,
    mime            TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'approved',
    source          TEXT NOT NULL DEFAULT 'manual',
    scenario        TEXT,
    verified_at     TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_kb_entries_project_position ON kb_entries (project_id, position);

CREATE TABLE kb_entry_revisions (
    id          TEXT PRIMARY KEY NOT NULL,
    entry_id    TEXT NOT NULL,
    project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    field_path  TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    status      TEXT NOT NULL,
    note        TEXT,
    edited_at   TEXT NOT NULL
);

CREATE INDEX idx_kb_revisions_project_edited ON kb_entry_revisions (project_id, edited_at DESC);
