-- MCQ explanations (text + optional image). Run once in Supabase SQL Editor.

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS explanation_image_url TEXT;
