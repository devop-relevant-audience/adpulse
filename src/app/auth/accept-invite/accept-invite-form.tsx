"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Phase = "verifying" | "ready" | "error" | "success";

const MIN_PASSWORD = 8;

// Reads invite session tokens out of the URL and lets the invited user set a
// password. IMPORTANT: the browser client is configured with flowType "pkce"
// (via @supabase/ssr's createBrowserClient). Supabase invite emails route
// through /auth/v1/verify and redirect here with an IMPLICIT-grant session in
// the hash (#access_token=…&refresh_token=…). Auto-detection (detectSessionInUrl)
// REFUSES those under pkce — _getSessionFromURL throws "Not a valid PKCE flow
// url." and never saves the session — so we parse the hash ourselves and call
// setSession() explicitly. A `?code=` PKCE redirect is handled as a fallback.
export function AcceptInviteForm() {
  const [supabase] = useState<SupabaseClient>(() => createClient());
  const [phase, setPhase] = useState<Phase>("verifying");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function ingest() {
      // Errors can arrive in the hash (#error=access_denied&error_description=…)
      // — e.g. an expired or already-used invite link.
      const hash = new URLSearchParams(
        window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
      );
      const query = new URLSearchParams(window.location.search);

      const urlError = hash.get("error_description") || hash.get("error") || query.get("error_description") || query.get("error");
      if (urlError) {
        if (!cancelled) {
          setErrorMessage(decodeURIComponent(urlError.replace(/\+/g, " ")));
          setPhase("error");
        }
        return;
      }

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = query.get("code");

      try {
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          // Scrub tokens from the address bar once ingested.
          window.history.replaceState(null, "", window.location.pathname);
          if (!cancelled) {
            setEmail(data.user?.email ?? null);
            setPhase("ready");
          }
          return;
        }

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState(null, "", window.location.pathname);
          if (!cancelled) {
            setEmail(data.user?.email ?? null);
            setPhase("ready");
          }
          return;
        }

        // No tokens in the URL — maybe a session is already established (e.g. a
        // page refresh after ingesting). Otherwise the link is invalid/expired.
        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          if (data.session) {
            setEmail(data.session.user.email ?? null);
            setPhase("ready");
          } else {
            setErrorMessage("This invite link is invalid or has expired.");
            setPhase("error");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : "This invite link is invalid or has expired."
          );
          setPhase("error");
        }
      }
    }

    void ingest();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < MIN_PASSWORD) {
      setFormError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message);
        return;
      }
      setPhase("success");
      // Full navigation so the proxy sees the freshly-set auth cookies.
      window.location.assign("/");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Brand */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-ink">AdPulse</h1>
          <p className="mt-1 text-sm text-ink-muted">Set up your account</p>
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-6 shadow-(--shadow-elevated)">
        {phase === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
            <p className="text-sm text-ink-muted">Verifying your invite…</p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-sm font-medium text-ink">Invite unavailable</p>
              <p className="mt-1 text-sm text-ink-muted">{errorMessage}</p>
            </div>
            <Button variant="outline" size="sm" render={<Link href="/login" />}>
              Go to sign in
            </Button>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-ink">You&apos;re all set</p>
              <p className="mt-1 text-sm text-ink-muted">Taking you to your workspace…</p>
            </div>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-ink-secondary">
                Welcome{email ? "," : ""}{" "}
                {email && <span className="font-medium text-ink">{email}</span>}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                Choose a password to finish setting up your account.
              </p>
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="new-password" className="text-sm font-medium text-ink-secondary">
                Password
              </label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="text-sm font-medium text-ink-secondary">
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Setting password…
                </>
              ) : (
                "Set password & continue"
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
