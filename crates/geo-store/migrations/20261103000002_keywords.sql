-- M1.5 关键词素材库（Plan C 第一个纵向切片：keyword_list/add/update/delete）。
-- 真后端从空表开始，不迁移 demo 种子；`keyword_generate` 仍留在 demo-only 清单。
CREATE TABLE keywords (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    kind            TEXT NOT NULL,
    intent          TEXT NOT NULL,
    monthly_volume  INTEGER,
    difficulty      INTEGER,
    priority        INTEGER NOT NULL DEFAULT 3,
    status          TEXT NOT NULL DEFAULT 'approved',
    note            TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_keywords_project_position ON keywords (project_id, position);
