"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { profileAvatarSrc } from "@/lib/avatar";
import type { ContributionsCalendar, ProfileMe } from "@/types";
import ContributionHeatmap from "@/components/ContributionHeatmap";

const THEME_LABELS: Record<string, string> = {
  default: "Default",
  ocean: "Ocean",
  midnight: "Midnight",
  aurora: "Aurora",
};

const FRAME_LABELS: Record<string, string> = {
  none: "None",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

function themeOptions(unlocked: string[] | undefined) {
  return Array.from(new Set(["default", ...(unlocked ?? [])]));
}

function frameOptions(unlocked: string[] | undefined) {
  return Array.from(new Set(["none", ...(unlocked ?? [])]));
}

export default function ProfilePage() {
  const { refreshProfile } = useAuth();
  const [me, setMe] = useState<ProfileMe | null>(null);
  const [cal, setCal] = useState<ContributionsCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const [usernameEdit, setUsernameEdit] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [theme, setTheme] = useState("default");
  const [frame, setFrame] = useState("none");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.profile.me(), api.profile.contributions()]);
      setMe(p);
      setCal(c);
      setUsernameEdit(p.username ?? "");
      setBio(p.bio ?? "");
      setAvatarUrl(p.avatar_url ?? "");
      const tOpts = themeOptions(p.unlocked_themes);
      const fOpts = frameOptions(p.unlocked_frames);
      const t = p.equipped_theme ?? "default";
      const f = p.equipped_frame ?? "none";
      setTheme(tOpts.includes(t) ? t : "default");
      setFrame(fOpts.includes(f) ? f : "none");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveProfileOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const p = await api.profile.patch({
        username: usernameEdit.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      });
      setMe(p);
      setUsernameEdit(p.username ?? "");
      setAvatarUrl(p.avatar_url ?? "");
      await refreshProfile();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAppearanceOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLook(true);
    try {
      const p = await api.profile.patch({
        equipped_theme: theme,
        equipped_frame: frame,
      });
      setMe(p);
      setTheme(p.equipped_theme ?? "default");
      setFrame(p.equipped_frame ?? "none");
      await refreshProfile();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingLook(false);
    }
  };

  if (loading || !me) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Profile</h1>
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  const themes = themeOptions(me.unlocked_themes);
  const frames = frameOptions(me.unlocked_frames);
  const previewTheme = themes.includes(theme) ? theme : "default";
  const previewFrame = frames.includes(frame) ? frame : "none";
  const shellClass = `profile-shell profile-theme-${previewTheme} profile-frame-${previewFrame}`;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Profile</h1>
      <p className="text-gray-600 mb-8 max-w-2xl">
        Your username is shown in the header and on this page. Track contribution points from
        approved community questions, and unlock profile themes and frames as you level up.
      </p>

      <div className={`card p-8 mb-8 ${shellClass}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 border-b border-gray-200 pb-6 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-tutorial="profile-avatar"
            src={profileAvatarSrc(me.avatar_url)}
            alt=""
            width={80}
            height={80}
            className="h-20 w-20 rounded-full object-cover shrink-0 bg-gray-300 ring-2 ring-gray-200"
          />
          <div className="min-w-0">
            <p className="text-sm text-gray-500">You are</p>
            <p className="text-lg font-semibold text-gray-900 truncate font-mono">
              {me.username ?? "—"}
            </p>
            <p className="text-sm text-gray-500 truncate">{me.email}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between border-b border-gray-200 pb-4 mb-6">
          <div>
            <p className="text-sm text-gray-500">Title</p>
            <p className="text-xl font-semibold profile-accent">{me.title}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Level</p>
            <p className="text-lg font-medium text-gray-800">{me.level}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Contribution points</p>
            <p className="text-lg font-medium text-gray-800">{me.contribution_points ?? 0}</p>
          </div>
        </div>
        {me.next_title != null && me.points_to_next_title != null && (
          <p className="text-sm text-gray-600 mb-6">
            Next title: <span className="font-medium">{me.next_title}</span> —{" "}
            {me.points_to_next_title} more points to unlock.
          </p>
        )}
        {cal && (
          <div className="mb-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-3" data-tutorial="contribution-heatmap">Contributions</h2>
            <ContributionHeatmap days={cal.days} />
          </div>
        )}
      </div>

      <form onSubmit={saveProfileOnly} className="card p-8 space-y-6 max-w-2xl mb-6">
        <h2 className="text-lg font-semibold text-gray-900" data-tutorial="profile-username">Username, bio &amp; photo</h2>
        <p className="text-sm text-gray-600">
          Save this section without touching themes or frames. Usernames are stored in lowercase (3–30
          characters: letters, digits, underscores). Use an https link for your profile photo, or leave
          it blank for the default avatar.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
          <input
            value={usernameEdit}
            onChange={(e) => setUsernameEdit(e.target.value)}
            className="input-field font-mono"
            maxLength={30}
            autoComplete="username"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="input-field min-h-[100px]"
            maxLength={2000}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Profile photo URL (optional)
          </label>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className="input-field"
            placeholder="https://…"
            maxLength={2000}
          />
        </div>
        <button type="submit" disabled={savingProfile} className="btn-primary">
          {savingProfile ? "Saving…" : "Save profile"}
        </button>
      </form>

      <form onSubmit={saveAppearanceOnly} className="card p-8 space-y-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-gray-900">Appearance</h2>
        <p className="text-sm text-gray-600">
          Themes and frames unlock as you earn contribution points. Saving here only updates
          cosmetics.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Profile theme</label>
            <select
              value={themes.includes(theme) ? theme : "default"}
              onChange={(e) => setTheme(e.target.value)}
              className="input-field"
            >
              {themes.map((id) => (
                <option key={id} value={id}>
                  {THEME_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avatar frame</label>
            <select
              value={frames.includes(frame) ? frame : "none"}
              onChange={(e) => setFrame(e.target.value)}
              className="input-field"
            >
              {frames.map((id) => (
                <option key={id} value={id}>
                  {FRAME_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={savingLook} className="btn-primary">
          {savingLook ? "Saving…" : "Save appearance"}
        </button>
      </form>
    </div>
  );
}
