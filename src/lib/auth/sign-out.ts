"use client";

import { useClerk } from "@clerk/nextjs";

// Sign out of the shared Clerk session (this also ends the session for Atlas —
// it is one login across both apps) and hard-navigate to /login so all client
// state (React Query cache, Zustand stores) is dropped.
export function useSignOutAndRedirect() {
  const { signOut } = useClerk();

  return async function signOutAndRedirect() {
    try {
      await signOut();
    } finally {
      window.location.assign("/login");
    }
  };
}
