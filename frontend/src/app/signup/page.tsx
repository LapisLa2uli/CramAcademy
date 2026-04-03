"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, getSupabaseConfigError } from "@/lib/supabase";
import { getEmailConfirmationRedirectUrl } from "@/lib/siteUrl";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const configErr = getSupabaseConfigError();
    if (configErr) {
      setError(configErr);
      setLoading(false);
      return;
    }

    try {
      const emailRedirectTo = getEmailConfirmationRedirectUrl();
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: emailRedirectTo
          ? { emailRedirectTo }
          : undefined,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch (err) {
      const msg =
        err instanceof TypeError && err.message === "Failed to fetch"
          ? "Could not reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL in .env.local, " +
            "confirm the project is not paused (Supabase dashboard), disable VPN/ad-block for *.supabase.co, " +
            "and restart npm run dev."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Try again.";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gray-50">
      <div className="card p-8 w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="text-2xl font-bold text-primary-700">
            CramAcademy
          </Link>
          <p className="text-gray-500 mt-2">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="input-field"
              placeholder="Confirm your password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
