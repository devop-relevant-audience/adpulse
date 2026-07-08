"use client";

import { useQuery } from "@tanstack/react-query";
import type { AppRole } from "@/lib/types/database";

export interface CurrentUser {
  user: { id: string; email: string | null };
  profile: { full_name: string | null; role: AppRole };
}

// Fetches the signed-in user's identity from /api/me. Identity doesn't change
// within a session, so cache it forever and never retry (a 401/403 is a real
// answer, not a transient error).
export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ["current-user"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) {
        throw new Error("Not authenticated");
      }
      return (await res.json()) as CurrentUser;
    },
    staleTime: Infinity,
    retry: false,
  });
}
