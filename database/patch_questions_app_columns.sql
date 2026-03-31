-- Fix PostgREST PGRST204: "Could not find the 'question_image_url' column..."
-- Run in Supabase → SQL Editor once (safe to re-run).
-- After running, wait a few seconds for the API schema cache to refresh (or reload the project).

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS course_level TEXT,
  ADD COLUMN IF NOT EXISTS grade_level SMALLINT,
  ADD COLUMN IF NOT EXISTS question_image_url TEXT;

ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_grade_level_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_grade_level_check
  CHECK (grade_level IS NULL OR (grade_level >= 1 AND grade_level <= 12));
