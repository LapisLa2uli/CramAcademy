"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { profileAvatarSrc } from "@/lib/avatar";

const nav = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/my-bank", label: "My question bank" },
  { href: "/dashboard/moderation", label: "Moderation", minRole: "moderator" as const },
  { href: "/dashboard/admin", label: "Admin", minRole: "admin" as const },
];

function rank(r: string | undefined) {
  if (r === "admin") return 2;
  if (r === "moderator") return 1;
  return 0;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, profileLoading, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="text-xl font-bold text-primary-700">
              CramAcademy
            </Link>
            <div className="flex flex-wrap gap-1">
              {nav.map((item) => {
                if (item.minRole && rank(profile?.role) < rank(item.minRole)) {
                  return null;
                }
                const active =
                  item.href === "/dashboard/moderation"
                    ? pathname.startsWith("/dashboard/moderation")
                    : pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                      active
                        ? "bg-primary-50 text-primary-800"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/dashboard/profile"
              title={user.email ?? undefined}
              className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 text-gray-800 hover:bg-gray-100 transition-colors max-w-[min(100vw-8rem,14rem)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar URLs */}
              <img
                src={profileAvatarSrc(profile?.avatar_url)}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover shrink-0 bg-gray-300 ring-1 ring-gray-200"
              />
              <span className="flex flex-col min-w-0 leading-tight">
                <span className="font-medium truncate">
                  {profileLoading ? "…" : profile?.username ?? user.email?.split("@")[0] ?? "Account"}
                </span>
                <span className="text-xs text-gray-500 truncate hidden sm:block">
                  {profile?.role && profile.role !== "user" ? (
                    <span className="uppercase text-primary-600">{profile.role}</span>
                  ) : (
                    "View profile"
                  )}
                </span>
              </span>
            </Link>
            <button type="button" onClick={() => signOut()} className="btn-secondary text-sm shrink-0">
              Sign Out
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
