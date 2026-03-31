"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function ModerationLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const pathname = usePathname();

  if (profile?.role !== "moderator" && profile?.role !== "admin") {
    return <>{children}</>;
  }

  const tabs = [
    { href: "/dashboard/moderation/queue", label: "Review queue" },
    { href: "/dashboard/moderation/community", label: "Community bank" },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Moderation</h1>
      <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-200 pb-3">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-primary-100 text-primary-800"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
