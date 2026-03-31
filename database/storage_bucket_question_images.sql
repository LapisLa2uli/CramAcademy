-- Fix "Bucket not found" when uploading question images.
-- Run in Supabase → SQL Editor (entire script once).

-- 1) Create bucket (skip if it already exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2) Policies (safe to re-run)
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
