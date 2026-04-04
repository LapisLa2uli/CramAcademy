-- Migration: Centralized subjects list managed by admins.
-- Each subject can have its own list of levels (replaces the old course_level system).
-- Questions get a subject_id FK pointing to this table.

-- 1. Create subjects table
CREATE TABLE IF NOT EXISTS public.subjects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    levels      TEXT[] NOT NULL DEFAULT '{}',
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add subject_id FK to questions (nullable — old questions won't have it yet)
ALTER TABLE public.questions
    ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_subject_id ON public.questions(subject_id);

-- 3. Clear the old free-text subject column on all existing questions
-- (moderators will re-assign via the new subject picker)
UPDATE public.questions SET subject = '' WHERE subject IS NOT NULL AND subject != '';

-- 4. RLS on subjects — everyone can read; only admins can write
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read subjects"
    ON public.subjects
    FOR SELECT
    USING (true);

CREATE POLICY "Admins can manage subjects"
    ON public.subjects
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 5. Seed some default subjects (admin can edit later)
INSERT INTO public.subjects (name, levels, position) VALUES
    ('Mathematics',       ARRAY['S', 'S+', 'H', 'H+'], 0),
    ('Physics',           ARRAY['S', 'S+', 'H', 'H+'], 1),
    ('Chemistry',         ARRAY['S', 'S+', 'H', 'H+'], 2),
    ('Biology',           ARRAY['S', 'S+', 'H', 'H+'], 3),
    ('Computer Science',  ARRAY['S', 'H'],              4),
    ('English',           ARRAY['S', 'H'],              5),
    ('History',           ARRAY['S', 'H'],              6)
ON CONFLICT (name) DO NOTHING;
