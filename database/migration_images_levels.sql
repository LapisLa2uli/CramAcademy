-- Run in Supabase SQL Editor if you already applied schema.sql (additive migration).

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS course_level TEXT,
  ADD COLUMN IF NOT EXISTS grade_level SMALLINT,
  ADD COLUMN IF NOT EXISTS question_image_url TEXT;

ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_grade_level_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_grade_level_check
  CHECK (grade_level IS NULL OR (grade_level >= 1 AND grade_level <= 12));

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS course_level TEXT,
  ADD COLUMN IF NOT EXISTS grade_level SMALLINT;

CREATE INDEX IF NOT EXISTS idx_questions_course_level ON public.questions(course_level);
CREATE INDEX IF NOT EXISTS idx_questions_grade_level ON public.questions(grade_level);

-- Storage bucket (limits can be set in Dashboard → Storage → Policies)
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "question-images public read" ON storage.objects;
DROP POLICY IF EXISTS "question-images authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "question-images authenticated update own" ON storage.objects;
DROP POLICY IF EXISTS "question-images authenticated delete own" ON storage.objects;

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
