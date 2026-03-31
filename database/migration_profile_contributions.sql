-- Profile fields, contribution grants, rejection reasons. Run once in Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS contribution_points INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS equipped_theme TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS equipped_frame TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS unlocked_themes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unlocked_frames TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE TABLE IF NOT EXISTS public.contribution_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  points INT NOT NULL CHECK (points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id)
);

CREATE INDEX IF NOT EXISTS idx_contribution_grants_user ON public.contribution_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_contribution_grants_created ON public.contribution_grants(created_at);

ALTER TABLE public.contribution_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own contribution grants"
  ON public.contribution_grants FOR SELECT
  USING (auth.uid() = user_id);

-- Service role bypasses RLS for inserts from API
