-- Migration: add credits_used to projects table
-- This column tracks how many credits each project has consumed.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_credits_used ON public.projects(credits_used);
