"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { PublicUser } from "../auth/types";

export default function ChangePasswordForm({ user, required }: { user: PublicUser; required: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setError("The new passwords do not match");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to change password");
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change password");
    } finally {
      setSaving(false);
    }
  }

  return <main className="auth-simple"><section className="auth-card password-card"><Image className="password-logo" src="/erentals-logo.png" alt="eRentals" width={126} height={66} priority /><span className="overline">{required ? "First sign-in" : "Account security"}</span><h1>{required ? "Create your private password" : "Change your password"}</h1><p>Signed in as <strong>{user.email}</strong>. Use at least 10 characters with a letter and a number.</p><form onSubmit={submit}><label className="field"><span>Current password</span><input type="password" name="currentPassword" autoComplete="current-password" required /></label><label className="field"><span>New password</span><input type="password" name="newPassword" autoComplete="new-password" minLength={10} required /></label><label className="field"><span>Confirm new password</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={10} required /></label>{error && <div className="form-error" role="alert">{error}</div>}<button type="submit" className="btn btn-primary auth-submit" disabled={saving}>{saving ? "Saving…" : "Save password and continue"}</button></form>{!required && <button className="text-btn auth-cancel" onClick={() => router.back()}>Cancel</button>}</section></main>;
}
