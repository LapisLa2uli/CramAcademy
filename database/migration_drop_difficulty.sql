-- Remove difficulty from questions and tests (run after prior migrations).
-- Safe to re-run: uses IF EXISTS guards.

DROP INDEX IF EXISTS public.idx_questions_difficulty;

ALTER TABLE public.questions DROP COLUMN IF EXISTS difficulty;
ALTER TABLE public.tests DROP COLUMN IF EXISTS difficulty;

DROP TYPE IF EXISTS difficulty_level;
