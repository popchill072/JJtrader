-- Migration: add chat profile (display name + avatar) to users
ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL;
