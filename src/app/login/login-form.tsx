"use client";

import { useState } from "react";
import { Zap, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function LoginForm({ initialError }: { initialError: string | null }) {
  // One browser client for the life of the form.
  const [supabase] = useState(() => createClient());

  const [tab, setTab] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      // Full navigation so the proxy sees the freshly-set auth cookies.
      window.location.assign("/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // Invite-only portal — never provision new users from a magic link.
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (otpError) {
        setError(otpError.message);
        return;
      }
      setMagicSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
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
          <p className="mt-1 text-sm text-ink-muted">
            Sign in to your reporting workspace
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-6 shadow-(--shadow-elevated)">
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as "password" | "magic");
            setError(null);
            setMagicSent(false);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic">Magic link</TabsTrigger>
          </TabsList>

          {/* Password */}
          <TabsContent value="password" className="pt-5">
            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="password-email"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Email
                </label>
                <Input
                  id="password-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@agency.com"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </TabsContent>

          {/* Magic link */}
          <TabsContent value="magic" className="pt-5">
            {magicSent ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-ink">Check your email</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    We sent a sign-in link to{" "}
                    <span className="font-medium text-ink-secondary">{email}</span>.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMagicSent(false)}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="magic-email"
                    className="text-sm font-medium text-ink-secondary"
                  >
                    Email
                  </label>
                  <Input
                    id="magic-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@agency.com"
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={pending}
                >
                  {pending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Mail />
                      Email me a magic link
                    </>
                  )}
                </Button>
                <p className="text-center text-xs text-ink-faint">
                  Magic links only work for existing accounts.
                </p>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
