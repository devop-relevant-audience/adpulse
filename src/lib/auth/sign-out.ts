"use client";

import { createClient } from "@/lib/supabase/client";

// Sign out locally (this device only — `scope: "local"` leaves other sessions
// intact) and hard-navigate to /login so all client state (React Query cache,
// Zustand stores) is dropped.
export async function signOutAndRedirect() {
  try {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    window.location.assign("/login");
  }
}
