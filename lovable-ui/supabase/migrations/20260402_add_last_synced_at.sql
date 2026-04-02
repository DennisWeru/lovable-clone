-- Add last_synced_at column to projects table
ALTER TABLE IF EXISTS public.projects 
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Enable public read for projects if not already enabled (sanity check)
-- ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
