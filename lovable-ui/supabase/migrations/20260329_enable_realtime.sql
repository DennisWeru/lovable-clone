-- Migration: enable realtime for project_messages table
-- Run this in your Supabase SQL editor or via CLI.

-- Enable Realtime for the project_messages table
-- This allows `postgres_changes` subscriptions to work for this table.
ALTER PUBLICATION supabase_realtime ADD TABLE project_messages;

-- Also ensure projects is in the publication if we want to track status changes there
-- ALTER PUBLICATION supabase_realtime ADD TABLE projects;
