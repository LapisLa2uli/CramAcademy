-- CramAcademy Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Users (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    contribution_points INT NOT NULL DEFAULT 0,
    equipped_theme TEXT NOT NULL DEFAULT 'default',
    equipped_frame TEXT NOT NULL DEFAULT 'none',
    unlocked_themes TEXT[] NOT NULL DEFAULT '{}',
    unlocked_frames TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_username_unique ON public.profiles (username);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role, username)
    VALUES (
        NEW.id,
        NEW.email,
        'user',
        'crammer_' || md5(replace(NEW.id::text, '-', ''))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Questions
-- ============================================================
CREATE TYPE question_type AS ENUM ('mcq', 'frq');
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

CREATE TABLE public.questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type question_type NOT NULL,
    subject TEXT NOT NULL,
    difficulty difficulty_level NOT NULL DEFAULT 'medium',
    course_level TEXT,            -- e.g. S, S+, H, H+ (track / level)
    grade_level SMALLINT CHECK (grade_level IS NULL OR (grade_level >= 1 AND grade_level <= 12)),
    content TEXT NOT NULL DEFAULT '',
    latex_enabled BOOLEAN NOT NULL DEFAULT false,
    question_image_url TEXT,      -- optional stem image (public Storage URL)
    options JSONB,                -- MCQ: [{"label":"A","text":"...","image_url":"..."},...]
    answer TEXT NOT NULL,         -- correct answer or model solution
    explanation TEXT,             -- MCQ explanation text (LaTeX supported)
    explanation_image_url TEXT,   -- optional explanation image URL
    rubric JSONB,                 -- grading rubric for FRQs
    tags TEXT[] DEFAULT '{}',
    creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    validated BOOLEAN NOT NULL DEFAULT false,
    pool TEXT NOT NULL DEFAULT 'personal' CHECK (pool IN ('personal', 'community_pending', 'community')),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published community questions"
    ON public.questions FOR SELECT
    USING (validated = true AND pool = 'community');

CREATE POLICY "Users can read own questions"
    ON public.questions FOR SELECT
    USING (auth.uid() = creator_id);

CREATE POLICY "Staff read all questions"
    ON public.questions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
        )
    );

CREATE POLICY "Users insert as creator with personal pool"
    ON public.questions FOR INSERT
    WITH CHECK (auth.uid() = creator_id AND pool = 'personal');

CREATE POLICY "Users update own personal questions"
    ON public.questions FOR UPDATE
    USING (auth.uid() = creator_id AND pool = 'personal')
    WITH CHECK (auth.uid() = creator_id AND pool = 'personal');

CREATE POLICY "Staff update questions"
    ON public.questions FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
        )
    );

CREATE POLICY "Users delete own personal questions"
    ON public.questions FOR DELETE
    USING (auth.uid() = creator_id AND pool = 'personal');

CREATE POLICY "Staff delete questions"
    ON public.questions FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role IN ('moderator', 'admin')
        )
    );

CREATE INDEX idx_questions_subject ON public.questions(subject);
CREATE INDEX idx_questions_difficulty ON public.questions(difficulty);
CREATE INDEX idx_questions_type ON public.questions(type);
CREATE INDEX idx_questions_course_level ON public.questions(course_level);
CREATE INDEX idx_questions_grade_level ON public.questions(grade_level);
CREATE INDEX idx_questions_pool ON public.questions(pool);
CREATE INDEX idx_questions_creator_pool ON public.questions(creator_id, pool);

-- ============================================================
-- Contribution grants (points when a question is published)
-- ============================================================
CREATE TABLE public.contribution_grants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    points INT NOT NULL CHECK (points > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (question_id)
);

CREATE INDEX idx_contribution_grants_user ON public.contribution_grants(user_id);
CREATE INDEX idx_contribution_grants_created ON public.contribution_grants(created_at);

ALTER TABLE public.contribution_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own contribution grants"
    ON public.contribution_grants FOR SELECT
    USING (auth.uid() = user_id);

-- ============================================================
-- Tests
-- ============================================================
CREATE TABLE public.tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT,
    difficulty difficulty_level,
    course_level TEXT,
    grade_level SMALLINT,
    time_limit_seconds INT NOT NULL DEFAULT 3600,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tests"
    ON public.tests FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- Test Questions (join table)
-- ============================================================
CREATE TABLE public.test_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    position INT NOT NULL,
    UNIQUE (test_id, question_id)
);

ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own test questions"
    ON public.test_questions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tests
            WHERE tests.id = test_questions.test_id
              AND tests.user_id = auth.uid()
        )
    );

-- ============================================================
-- Submissions
-- ============================================================
CREATE TABLE public.submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN,
    score NUMERIC(5,2),
    feedback TEXT,
    justification TEXT,
    graded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own submissions"
    ON public.submissions FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX idx_submissions_test ON public.submissions(test_id);

-- ============================================================
-- Protests
-- ============================================================
CREATE TYPE protest_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TABLE public.protests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_argument TEXT NOT NULL,
    original_score NUMERIC(5,2),
    new_score NUMERIC(5,2),
    resolution TEXT,
    status protest_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

ALTER TABLE public.protests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own protests"
    ON public.protests FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- Storage: question images (MCQ options + question stem)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "question-images public read"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'question-images');

CREATE POLICY "question-images authenticated upload"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'question-images');

CREATE POLICY "question-images authenticated update own"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "question-images authenticated delete own"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);
