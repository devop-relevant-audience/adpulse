import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign in — AdPulse",
};

// Sign-in against the shared Atlas Clerk instance — the same credentials work
// in both apps. In production (same root domain) users already signed in to
// Atlas skip this page entirely; the proxy redirects them home. Catch-all
// segment because Clerk's <SignIn /> owns sub-routes (e.g. /login/factor-one).
export default function LoginPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-canvas-soft">
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <SignIn />
      </div>
    </main>
  );
}
