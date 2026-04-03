/**
 * Public site origin for Supabase email links (no trailing slash).
 * Use only from the browser (e.g. signup submit).
 *
 * 1. NEXT_PUBLIC_SITE_URL — set on Vercel to your canonical URL (e.g. https://cram-academy.vercel.app)
 * 2. window.location.origin — correct when users sign up from the same host (local or deployed)
 */
export function getBrowserSiteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ?? "";
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Where Supabase should send users after they confirm their email. */
export function getEmailConfirmationRedirectUrl(): string {
  const base = getBrowserSiteOrigin();
  if (!base) return "";
  return `${base}/login`;
}
