"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/primitives";

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<{ email?: string; password?: string }>({});
  const reduce = useReducedMotion();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    const errs: typeof touched = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid e-mail address";
    if (!password) errs.password = "Enter your password";
    setTouched(errs);
    if (errs.email || errs.password) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Sign in failed");
      const me = await (await fetch("/api/auth")).json();
      const next = new URLSearchParams(location.search).get("next");
      location.href = me.role_name === "DRIVER" ? "/manage/deliveries" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-art" aria-hidden>
        <div className="login-grid-bg" />
        <div className="row" style={{ gap: 10, position: "relative" }}>
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3-8 4 16 3-8h4" />
            </svg>
          </div>
          <div className="brand-name" style={{ fontSize: 18 }}>
            Relief<span>Flow</span>
          </div>
        </div>
        <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} style={{ position: "relative", marginTop: "auto" }}>
          <h2>Every request tracked from the camp to the truck.</h2>
          <p>
            Coordinate disasters, relief camps, warehouse stock, allocations and deliveries on one transactional platform — with the
            database guarantees that keep supplies from being double-counted.
          </p>
          <div className="login-stats">
            <div>
              <b>ACID</b>
              <span>allocations & stock</span>
            </div>
            <div>
              <b>5 stores</b>
              <span>SQL · document · key-value · graph · vector</span>
            </div>
            <div>
              <b>Role-based</b>
              <span>admin · coordinator · field · driver</span>
            </div>
          </div>
        </motion.div>
        <svg viewBox="0 0 400 140" style={{ position: "absolute", right: -30, top: 70, width: 460, opacity: 0.5 }}>
          <defs>
            <linearGradient id="lg" x1="0" x2="1">
              <stop offset="0" stopColor="#60a5fa" stopOpacity="0" />
              <stop offset="1" stopColor="#5eead4" />
            </linearGradient>
          </defs>
          <motion.path
            d="M0 90 L60 90 L80 40 L105 120 L130 70 L160 70 L180 20 L200 110 L230 80 L400 80"
            fill="none"
            stroke="url(#lg)"
            strokeWidth="2.5"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2, ease: "easeInOut" }}
          />
        </svg>
      </section>
      <section className="login-form-wrap">
        <motion.div className="login-card" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <div className="eyebrow">Secure sign in</div>
          <h1>Welcome back</h1>
          <p className="muted" style={{ marginTop: 6, marginBottom: 24 }}>
            Use the account provisioned by your administrator.
          </p>
          <form onSubmit={submit} noValidate className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="email" className="field-label">
                Email
              </label>
              <input id="email" name="email" type="email" className="input" autoComplete="username" required aria-invalid={Boolean(touched.email)} aria-describedby={touched.email ? "email-err" : undefined} style={{ height: 42 }} />
              {touched.email && (
                <span id="email-err" className="err">
                  {touched.email}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input id="password" name="password" type={show ? "text" : "password"} className="input" autoComplete="current-password" required maxLength={200} aria-invalid={Boolean(touched.password)} style={{ height: 42, paddingRight: 42 }} />
                <button type="button" className="btn ghost sm icon" style={{ position: "absolute", right: 6, top: 6 }} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {touched.password && <span className="err">{touched.password}</span>}
            </div>
            {error && <Alert kind="error">{error}</Alert>}
            <button className="btn primary" style={{ height: 42 }} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden /> : <LogIn size={16} />}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="small muted row" style={{ marginTop: 22, gap: 6 }}>
            <ShieldCheck size={14} /> httpOnly session cookie · bcrypt · login throttling
          </p>
        </motion.div>
      </section>
    </main>
  );
}
