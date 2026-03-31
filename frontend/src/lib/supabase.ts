import { createClient } from "@supabase/supabase-js";

/**
 * Trim and strip accidental quotes. Pass the value from a direct
 * `process.env.NEXT_PUBLIC_*` reference — Next.js only inlines those at build
 * time when the key is a static string; `process.env[dynamicName]` stays empty
 * in the browser bundle.
 */
function normalizeEnvValue(raw: string | undefined): string {
  if (raw == null || raw === "") return "";
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/** Must use literal property access so Next.js embeds values in client chunks. */
const rawSupabaseUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
const rawSupabaseAnonKey = normalizeEnvValue(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * createClient() throws if url/key are empty; use placeholders only so the app can load
 * when .env.local is missing — real calls are gated by getSupabaseConfigError().
 */
const supabaseUrl =
  rawSupabaseUrl || "https://configure-env-local.supabase.co";
const supabaseAnonKey =
  rawSupabaseAnonKey ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.placeholder";

/**
 * Returns a user-facing message if Supabase env is missing or obviously wrong.
 */
export function getSupabaseConfigError(): string | null {
  if (!rawSupabaseUrl || !rawSupabaseAnonKey) {
    return (
      "Supabase is not configured. Copy frontend/.env.local.example to .env.local, " +
      "set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from " +
      "Supabase → Project Settings → API, then stop and restart npm run dev."
    );
  }
  if (!/^https?:\/\//i.test(rawSupabaseUrl)) {
    return "NEXT_PUBLIC_SUPABASE_URL must start with https:// (or http:// for local dev).";
  }
  return null;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
