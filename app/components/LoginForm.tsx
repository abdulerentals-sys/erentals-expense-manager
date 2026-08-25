"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to sign in");
      router.replace(body.user.mustChangePassword ? "/change-password" : "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-visual">
      <div className="auth-brand"><Image src="/erentals-logo.png" alt="eRentals" width={132} height={68} priority /><span>Expense Manager</span></div>
      <div className="auth-promise"><span className="overline">One connected workspace</span><h1>Control every order, invoice and expense.</h1><p>Role-based access keeps sales, execution and accounting teams focused on the work that belongs to them.</p><div className="auth-feature-grid"><div><strong>Sales</strong><span>Customers & invoices</span></div><div><strong>Execution</strong><span>Orders & expenses</span></div><div><strong>Accounts</strong><span>Payments & reports</span></div></div></div>
    </section>
    <section className="auth-form-side"><div className="auth-card"><div className="mobile-auth-logo"><Image src="/erentals-logo.png" alt="eRentals" width={130} height={68} priority /></div><span className="overline">Secure team access</span><h2>Welcome back</h2><p>Sign in with the email ID added by your administrator.</p><form onSubmit={submit}><label className="field"><span>Email ID</span><input name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@e-rentals.in" autoFocus /></label><label className="field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in to dashboard"}</button></form><small className="auth-help">Need access? Ask your eRentals administrator to create your account.</small></div></section>
  </main>;
}
