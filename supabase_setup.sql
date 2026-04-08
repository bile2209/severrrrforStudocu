-- Chay script nay trong Supabase SQL Editor
-- Dashboard -> SQL Editor -> New query -> Paste -> Run

CREATE TABLE IF NOT EXISTS license_keys (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'standard',
    note        TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    machine_id  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    last_used   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index de verify nhanh
CREATE INDEX IF NOT EXISTS idx_license_keys_key ON license_keys(key);

-- Row Level Security (tat di vi server dung service key)
ALTER TABLE license_keys DISABLE ROW LEVEL SECURITY;
