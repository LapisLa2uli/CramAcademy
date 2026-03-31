-- Usernames and optional profile photos. Run after migration_profile_contributions.sql if applicable.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Deterministic unique handle per user (stable, collision-free)
UPDATE public.profiles
SET username = 'crammer_' || md5(replace(id::text, '-', ''))
WHERE username IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;

DROP INDEX IF EXISTS profiles_username_unique;
CREATE UNIQUE INDEX profiles_username_unique ON public.profiles (username);

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
