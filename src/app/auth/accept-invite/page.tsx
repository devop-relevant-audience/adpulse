import type { Metadata } from "next";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = {
  title: "Accept invite — AdPulse",
};

// Public page (carved out in src/proxy.ts). The invite session only exists
// client-side — the Supabase verify endpoint redirects here with the session in
// the URL hash — so all the work happens in the client component.
export default function AcceptInvitePage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-canvas-soft">
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <AcceptInviteForm />
      </div>
    </main>
  );
}
