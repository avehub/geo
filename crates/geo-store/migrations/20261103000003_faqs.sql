-- M1.5 FAQ 素材库（Plan C 第二个纵向切片：faq_list/add/update/delete）。
-- `faq_generate` 仍留在 demo-only 清单；真后端从空表开始。
CREATE TABLE faqs (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    question        TEXT NOT NULL,
    answer_markdown TEXT NOT NULL,
    category        TEXT,
    intent          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'approved',
    source          TEXT NOT NULL DEFAULT 'manual',
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_faqs_project_position ON faqs (project_id, position);
