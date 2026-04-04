"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { AdminUserRow, UserRole } from "@/types";

export default function AdminPage() {
  const { profile, refreshProfile } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.listUsers();
      setUsers(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to list users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") {
      load();
    }
  }, [profile?.role, load]);

  const setRole = async (id: string, role: UserRole) => {
    setBusy(id);
    try {
      await api.admin.updateUser(id, { role });
      await load();
      if (id === profile?.id) await refreshProfile();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this user and all related data? This cannot be undone.")) return;
    setBusy(id);
    try {
      await api.admin.deleteUser(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  if (profile?.role !== "admin") {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Admin</h1>
        <p className="text-gray-600">You need the admin role to manage accounts.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">User administration</h1>
      <p className="text-gray-600 mb-4">
        Change roles (user / moderator / admin) or remove accounts. You cannot delete your own
        account from here.
      </p>
      <div className="mb-8">
        <Link href="/dashboard/admin/subjects" className="btn-secondary text-sm inline-flex items-center gap-1">
          Manage Subjects &amp; Levels →
        </Link>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Username</th>
                <th className="p-3 font-medium">Role</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="p-3 text-gray-800">{u.email || "—"}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{u.username || "—"}</td>
                  <td className="p-3">
                    <select
                      value={(u.role as UserRole) || "user"}
                      disabled={busy === u.id || u.id === profile.id}
                      onChange={(e) => setRole(u.id, e.target.value as UserRole)}
                      className="input-field py-1 text-sm"
                    >
                      <option value="user">user</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={busy === u.id || u.id === profile.id}
                      onClick={() => del(u.id)}
                      className="text-sm text-red-700 hover:underline"
                    >
                      Delete account
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
