"use client";

import { useState } from "react";
import { BiShieldX, BiRefresh } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { signOutAndRedirect } from "@/lib/auth/sign-out";

// Full-page state for an authenticated user with no user_profiles row
// (/api/me → 403). They have a valid session but no access yet, so the only
// action is to sign out.
export function AccountNotProvisioned() {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="w-full max-w-md text-center bg-white border border-hairline rounded-2xl shadow-(--shadow-elevated) px-8 py-10">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 grid place-items-center mb-5">
          <BiShieldX className="w-6 h-6 text-amber-600" />
        </div>
        <h1 className="text-lg font-semibold text-ink">
          Your account isn&apos;t provisioned yet
        </h1>
        <p className="text-[13px] text-ink-muted mt-2 leading-relaxed">
          You&apos;re signed in, but your account hasn&apos;t been granted
          access to a workspace. Ask your agency admin to set up your access.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOutAndRedirect();
          }}
        >
          {signingOut ? <BiRefresh className="w-4 h-4 animate-spin" /> : null}
          Sign out
        </Button>
      </div>
    </div>
  );
}
