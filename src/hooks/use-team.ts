"use client";

import { useQuery } from "@tanstack/react-query";
import type { AppRole } from "@/lib/types/database";

export interface TeamUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  created_at: string;
  clients: Array<{ id: string; name: string }>;
}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch {
    // non-JSON body — keep the fallback
  }
  throw new Error(message);
}

// Read-only: the directory is derived from Atlas's user_roles/project_users —
// invites, role changes, and removals happen in Atlas, not here.
export function useTeam() {
  return useQuery<TeamUser[]>({
    queryKey: ["team"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return readError(res, "Failed to load team");
      return res.json();
    },
  });
}
