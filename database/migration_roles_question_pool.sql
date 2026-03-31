-- Roles (user / moderator / admin) and question pool (personal / community_pending / community).
-- Run in Supabase SQL Editor once. Safe to re-run for idempotent parts.

-- ---------------------------------------------------------------------------
-- Profiles: role
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'moderator', 'admin'));

-- ---------------------------------------------------------------------------
-- Questions: pool (new submissions use personal; upload-to-community → pending)
-- ---------------------------------------------------------------------------
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS pool TEXT;

-- Existing rows: treat validated as published community; else awaiting moderation
UPDATE public.questions
SET pool = CASE
  WHEN validated = true THEN 'community'
  ELSE 'community_pending'
END
WHERE pool IS NULL;

ALTER TABLE public.questions ALTER COLUMN pool SET DEFAULT 'personal';
ALTER TABLE public.questions ALTER COLUMN pool SET NOT NULL;

ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_pool_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_pool_check CHECK (pool IN ('personal', 'community_pending', 'community'));

CREATE INDEX IF NOT EXISTS idx_questions_pool ON public.questions(pool);
CREATE INDEX IF NOT EXISTS idx_questions_creator_pool ON public.questions(creator_id, pool);

-- ---------------------------------------------------------------------------
-- Signup: default role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'user');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- RLS: published community questions; staff policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read validated questions" ON public.questions;

CREATE POLICY "Anyone can read published community questions"
  ON public.questions FOR SELECT
  USING (validated = true AND pool = 'community');

DROP POLICY IF EXISTS "Authenticated users can insert questions" ON public.questions;
CREATE POLICY "Users insert as creator with personal pool"
  ON public.questions FOR INSERT
  WITH CHECK (auth.uid() = creator_id AND pool = 'personal');

DROP POLICY IF EXISTS "Staff read all questions" ON public.questions;
CREATE POLICY "Staff read all questions"
  ON public.questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users update own personal questions" ON public.questions;
CREATE POLICY "Users update own personal questions"
  ON public.questions FOR UPDATE
  USING (auth.uid() = creator_id AND pool = 'personal')
  WITH CHECK (auth.uid() = creator_id AND pool = 'personal'  );

DROP POLICY IF EXISTS "Staff update questions" ON public.questions;
CREATE POLICY "Staff update questions"
  ON public.questions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users delete own personal questions" ON public.questions;
CREATE POLICY "Users delete own personal questions"
  ON public.questions FOR DELETE
  USING (auth.uid() = creator_id AND pool = 'personal'  );

DROP POLICY IF EXISTS "Staff delete questions" ON public.questions;
CREATE POLICY "Staff delete questions"
  ON public.questions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
    )
  );

-- Promote your first account (replace UUID) or run from Table Editor:
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
