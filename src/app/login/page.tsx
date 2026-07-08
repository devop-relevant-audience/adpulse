import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — AdPulse",
};

// The root layout sets `overflow-hidden` on <body>, so this page owns its own
// scroll container. searchParams carries the ?error= set by the auth callback.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-dvh overflow-y-auto bg-canvas-soft">
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <LoginForm initialError={error ?? null} />
      </div>
    </main>
  );
}
