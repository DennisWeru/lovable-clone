-- Migration: create project_messages table
-- Run this in your Supabase SQL editor.

CREATE TABLE IF NOT EXISTS project_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- 'user' | 'claude_message' | 'tool_use' | 'progress'
  content     TEXT,
  metadata    JSONB,         -- tool name, input, etc. for tool_use rows
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast per-project lookups
CREATE INDEX IF NOT EXISTS idx_project_messages_project_id
  ON project_messages(project_id, created_at ASC);

ALTER TABLE project_messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages that belong to their own projects
DROP POLICY IF EXISTS "Users can read their own project messages" ON project_messages;

CREATE POLICY "Users can read their own project messages"
  ON project_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_messages.project_id
        AND projects.user_id = auth.uid()
    )
  );

-- Only service role (admin client) can insert/update/delete
-- (we write from the server using createAdminClient, never from the browser)
