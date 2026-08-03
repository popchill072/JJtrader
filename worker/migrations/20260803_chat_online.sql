-- Migration: track online status for chat (last seen timestamp)
ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen);
