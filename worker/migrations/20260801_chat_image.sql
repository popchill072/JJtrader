-- Migration: add image column to chat_messages for image sharing
ALTER TABLE chat_messages ADD COLUMN image TEXT DEFAULT NULL;
