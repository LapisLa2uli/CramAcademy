-- Remove display_name; the app uses username as the only public name.
-- Run once in Supabase SQL Editor if your DB still has this column.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS display_name;
