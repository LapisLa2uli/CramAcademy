-- Migration: Add question_sets table and link questions to sets
-- A question set groups questions under a shared context/passage (like AP Lang MCQs).

-- 1. Create question_sets table
CREATE TABLE IF NOT EXISTS public.question_sets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    context_text TEXT NOT NULL DEFAULT '',
    context_image_url TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add FK and ordering columns on questions
ALTER TABLE public.questions
    ADD COLUMN IF NOT EXISTS question_set_id UUID REFERENCES public.question_sets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS position_in_set SMALLINT;

-- 3. Index for efficient set lookups
CREATE INDEX IF NOT EXISTS idx_questions_question_set_id ON public.questions(question_set_id);

-- 4. RLS on question_sets
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;

-- Creator can do everything with their own sets
CREATE POLICY "Users can manage own question sets"
    ON public.question_sets
    FOR ALL
    USING (creator_id = auth.uid())
    WITH CHECK (creator_id = auth.uid());

-- Staff (moderator/admin) can read all sets
CREATE POLICY "Staff can read all question sets"
    ON public.question_sets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('moderator', 'admin')
        )
    );

-- Anyone can read sets that have at least one validated community question
CREATE POLICY "Public can read community question sets"
    ON public.question_sets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.questions
            WHERE questions.question_set_id = question_sets.id
              AND questions.validated = true
              AND questions.pool = 'community'
        )
    );
