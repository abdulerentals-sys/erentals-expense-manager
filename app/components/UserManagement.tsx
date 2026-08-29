"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { roleDescriptions, roleLabels } from "../auth/permissions";
import { userRoles, type PublicUser, type UserRole } from "../auth/types";

const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export default function UserManagement({ currentUser }: { currentUser: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [newRole, setNewRole] = useState<UserRole>("sales");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load users");
    setUsers(body.users);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load users")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to create user");
      formElement.reset();
      setNewRole("sales");
      setSuccess(`${body.user.name} can now sign in with ${body.user.email}. Share the temporary password securely.`);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create user");
    } finally { setSaving(false); }
  }

  return <main className="users-page"><header className="users-topbar"><Link href="/" className="users-brand"><Image src="/erentals-logo.png" alt="eRentals" width={112} height={58} priority /><span>Expense Manager</span></Link><div><span>{currentUser.name}</span><Link href="/">← Dashboard</Link></div></header><div className="users-content"><section className="users-heading"><div><span className="overline">Administrator workspace</span><h1>Team access</h1><p>Create sign-in accounts by role. Order assignments come directly from active People roles and do not require account linking or matching email addresses.</p></div><span className="status success">{users.length} active users</span></section><section className="users-layout"><article className="panel user-form-panel"><h2>Add a dashboard user</h2><p>Choose the dashboard role and a display name. New users must replace their temporary password at first sign-in.</p><form className="form-grid" onSubmit={submit}><label className="field"><span>Dashboard role *</span><select name="role" value={newRole} onChange={(event) => setNewRole(event.target.value as UserRole)} required>{userRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label className="field"><span>Full name *</span><input name="name" required placeholder="Team member name" /></label><label className="field"><span>Login email *</span><input name="email" type="email" autoComplete="off" required placeholder="name@e-rentals.in" /></label><label className="field"><span>Temporary password *</span><input name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="10+ characters" /></label>{error && <div className="form-error field-wide" role="alert">{error}</div>}{success && <div className="form-success field-wide" role="status">{success}</div>}<button className="btn btn-primary field-wide" type="submit" disabled={saving}>{saving ? "Creating…" : "Create user account"}</button></form></article><article className="panel role-guide"><h2>Role dashboards</h2>{userRoles.map((role) => <div className="role-guide-row" key={role}><strong>{roleLabels[role]}</strong><p>{roleDescriptions[role]}</p></div>)}</article></section><section className="panel users-list"><div className="panel-head"><div><span className="overline">Current access</span><h2>Dashboard users</h2></div></div>{loading ? <div className="mini-empty">Loading users…</div> : users.map((user) => <div className="user-list-row role-only-user-row" key={user.id}><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><span>{user.email}</span></div><span className="role-pill">{roleLabels[user.role]}</span><small>{user.mustChangePassword ? "Password change required" : "Password active"}</small></div>)}</section></div></main>;
}
