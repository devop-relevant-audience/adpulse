"use client";

import { useState } from "react";
import { BiBuildings, BiRefresh } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { signOutAndRedirect } from "@/lib/auth/sign-out";

// Full-page state for a provisioned user who has no accessible clients (e.g. an
// agency with nothing seeded yet, or a client_user with no memberships). Without
// a client there is no dashboard to route to.
export function NoClientsState() {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="w-full max-w-md text-center bg-white border border-hairline rounded-2xl shadow-(--shadow-elevated) px-8 py-10">
        <div className="mx-auto w-12 h-12 rounded-full bg-canvas-soft grid place-items-center mb-5">
          <BiBuildings className="w-6 h-6 text-ink-muted" />
        </div>
        <h1 className="text-lg font-semibold text-ink">No clients yet</h1>
        <p className="text-[13px] text-ink-muted mt-2 leading-relaxed">
          There are no clients available for your account. Ask your agency admin
          to add a client (or seed demo data) to get started.
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
