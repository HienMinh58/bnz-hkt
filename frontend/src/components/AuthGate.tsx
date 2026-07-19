import { type FormEvent, useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../api/supabaseClient";

type AuthGateProps = {
  children: React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
    }
    setSubmitting(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-lg border bg-white/95 p-6 text-sm font-semibold text-slate-700 shadow-panel">
          Checking session...
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <form
          className="w-full max-w-md space-y-5 rounded-lg border bg-white/95 p-7 shadow-panel"
          onSubmit={handleLogin}
        >
          <div className="space-y-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border bg-bnz-50 text-bnz-700">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-slate-950">
              Synthetic Customer Lab
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              Sign in with an approved Supabase account to continue.
            </p>
          </div>

          <label className="block space-y-2 text-sm font-semibold text-slate-800">
            <span>Email</span>
            <input
              className="w-full rounded-lg border px-3 py-2.5"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="block space-y-2 text-sm font-semibold text-slate-800">
            <span>Password</span>
            <input
              className="w-full rounded-lg border px-3 py-2.5"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="flex w-full items-center justify-center rounded-lg border bg-bnz-700 px-4 py-2.5 font-semibold text-white hover:bg-bnz-900 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      <button
        className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border bg-white/95 px-3 py-2 text-sm font-semibold text-slate-800 shadow-panel"
        type="button"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </button>
      {children}
    </>
  );
}
