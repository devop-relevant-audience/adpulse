"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole } from "@/lib/types/database";

export interface TeamUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  created_at: string;
  clients: Array<{ id: string; name: string }>;
}

export interface InviteUserInput {
  email: string;
  full_name?: string;
  role: AppRole;
  client_ids?: string[];
}

export interface UpdateUserInput {
  user_id: string;
  role?: AppRole;
  full_name?: string | null;
  client_ids?: string[];
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

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteUserInput) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return readError(res, "Failed to invite user");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return readError(res, "Failed to update user");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/users?userId=${userId}`, { method: "DELETE" });
      if (!res.ok) return readError(res, "Failed to remove user");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
