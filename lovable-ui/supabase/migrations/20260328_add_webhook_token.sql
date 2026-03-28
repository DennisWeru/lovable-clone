-- Migration: add webhook_token to projects table
-- Run this in your Supabase SQL editor.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_token TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_webhook_token ON projects(webhook_token);
