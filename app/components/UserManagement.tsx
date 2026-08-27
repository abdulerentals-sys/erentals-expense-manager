"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { roleDescriptions, roleLabels } from "../auth/permissions";
import { personRoleMatchesUserRole } from "../auth/team";
import { userRoles, type PublicUser, type UserRole } from "../auth/types";

type TeamPerson = { id: string; name: string; role: string; phone: string; status: string };

const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export default function UserManagement({ currentUser }: { currentUser: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [persons, setPersons] = useState<TeamPerson[]>([]);
  const [newRole, setNewRole] = useState<UserRole>("sales");
  const [personLinks, setPersonLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingUserId, setSavingUserId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load users");
    setUsers(body.users);
    setPersons(body.persons);
    setPersonLinks(Object.fromEntries(body.users.map((user: PublicUser) => [user.id, user.personId || ""])));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load users")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const availableNewPersons = useMemo(
    () => persons.filter((person) => personRoleMatchesUserRole(person.role, newRole) && !users.some((user) => user.personId === person.id)),
    [newRole, persons, users],
  );

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

  async function savePersonLink(user: PublicUser) {
    setSavingUserId(user.id); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, personId: personLinks[user.id] || "" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update team assignment");
      setSuccess(`${body.user.name} is now linked to the selected People record.`);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update team assignment");
    } finally { setSavingUserId(""); }
  }

  return <main className="users-page"><header className="users-topbar"><Link href="/" className="users-brand"><Image src="/erentals-logo.png" alt="eRentals" width={112} height={58} priority /><span>Expense Manager</span></Link><div><span>{currentUser.name}</span><Link href="/">← Dashboard</Link></div></header><div className="users-content"><section className="users-heading"><div><span className="overline">Administrator workspace</span><h1>Team access</h1><p>Link each dashboard account directly to a person from your team. Email is used only for sign-in.</p></div><span className="status success">{users.length} active users</span></section><section className="users-layout"><article className="panel user-form-panel"><h2>Add a dashboard user</h2><p>Add the person in People first, then link their login here. New users must replace their temporary password at first sign-in.</p><form className="form-grid" onSubmit={submit}><label className="field"><span>Dashboard role *</span><select name="role" value={newRole} onChange={(event) => setNewRole(event.target.value as UserRole)} required>{userRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label className="field"><span>Linked team member{newRole === "admin" ? " (optional)" : " *"}</span><select name="personId" required={newRole !== "admin"} defaultValue="" key={newRole}><option value="">{availableNewPersons.length ? "Select from People" : newRole === "admin" ? "No linked person" : "Add a matching person first"}</option>{availableNewPersons.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label><label className="field"><span>Full name{newRole === "admin" ? " *" : ""}</span><input name="name" required={newRole === "admin"} placeholder={newRole === "admin" ? "Administrator name" : "Taken from linked team member"} /></label><label className="field"><span>Login email *</span><input name="email" type="email" autoComplete="off" required placeholder="name@e-rentals.in" /></label><label className="field"><span>Temporary password *</span><input name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="10+ characters" /></label>{error && <div className="form-error field-wide" role="alert">{error}</div>}{success && <div className="form-success field-wide" role="status">{success}</div>}<button className="btn btn-primary field-wide" type="submit" disabled={saving}>{saving ? "Creating…" : "Create user account"}</button></form></article><article className="panel role-guide"><h2>Role dashboards</h2>{userRoles.map((role) => <div className="role-guide-row" key={role}><strong>{roleLabels[role]}</strong><p>{roleDescriptions[role]}</p></div>)}</article></section><section className="panel users-list"><div className="panel-head"><div><span className="overline">Current access</span><h2>Dashboard users</h2></div></div>{loading ? <div className="mini-empty">Loading users…</div> : users.map((user) => { const eligible = persons.filter((person) => personRoleMatchesUserRole(person.role, user.role) && !users.some((candidate) => candidate.id !== user.id && candidate.personId === person.id)); return <div className="user-list-row user-link-row" key={user.id}><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><span>{user.email}</span></div><span className="role-pill">{roleLabels[user.role]}</span><label className="compact-link-field"><span>Linked team member</span><select value={personLinks[user.id] || ""} onChange={(event) => setPersonLinks((current) => ({ ...current, [user.id]: event.target.value }))}><option value="">{user.role === "admin" ? "No linked person" : "Select team member"}</option>{eligible.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label><button type="button" className="btn btn-secondary btn-small" disabled={savingUserId === user.id || personLinks[user.id] === user.personId} onClick={() => void savePersonLink(user)}>{savingUserId === user.id ? "Saving…" : "Save link"}</button><small>{user.mustChangePassword ? "Password change required" : "Password active"}</small></div>; })}</section></div></main>;
}
