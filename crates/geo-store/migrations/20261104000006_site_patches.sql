-- M6.5 补丁台账（Plan C 第四切片第二段：手动补丁 CRUD + 三态状态机 + 事件历史）。
-- site_patch_generate 仍留在 demo-only；事件随补丁删除级联。
CREATE TABLE site_patches (
    id                       TEXT PRIMARY KEY NOT NULL,
    project_id               TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    action_id                TEXT,
    round_id                 TEXT NOT NULL DEFAULT '',
    kind                     TEXT NOT NULL,
    title                    TEXT NOT NULL,
    target_url               TEXT NOT NULL,
    target_hint              TEXT,
    body                     TEXT NOT NULL,
    published_body           TEXT,
    published_kind           TEXT,
    published_target_url     TEXT,
    published_channel_kind   TEXT,
    status                   TEXT NOT NULL DEFAULT 'draft',
    review_status            TEXT NOT NULL DEFAULT 'approved',
    channel_kind             TEXT NOT NULL,
    source                   TEXT NOT NULL DEFAULT 'manual',
    position                 INTEGER NOT NULL DEFAULT 0,
    published_at             TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);

CREATE INDEX idx_site_patches_project_position ON site_patches (project_id, position);

CREATE TABLE site_patch_events (
    id           TEXT PRIMARY KEY NOT NULL,
    patch_id     TEXT NOT NULL REFERENCES site_patches (id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    channel_kind TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_site_patch_events_patch ON site_patch_events (patch_id, created_at);
