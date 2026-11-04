-- M6.5 站点档案与下发通道（Plan C 第四切片的档案 / 通道部分）。
-- 补丁台账与自检结论仍留在 demo-only；本迁移只建档案与通道两张表。
CREATE TABLE site_profiles (
    id          TEXT NOT NULL,
    project_id  TEXT PRIMARY KEY NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    domain      TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL,
    ownership   TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE site_channels (
    id                TEXT PRIMARY KEY NOT NULL,
    project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    status            TEXT NOT NULL,
    endpoint          TEXT,
    username          TEXT,
    note              TEXT,
    credentials_state TEXT NOT NULL,
    secret_ref        TEXT,
    checked_at        TEXT,
    check_detail      TEXT,
    updated_at        TEXT NOT NULL,
    UNIQUE (project_id, kind)
);

CREATE INDEX idx_site_channels_project ON site_channels (project_id, kind);
