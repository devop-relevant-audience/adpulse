import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

// Service-role Supabase client for privileged Auth Admin operations
// (inviteUserByEmail, deleteUser, generateLink). SERVER-ONLY — the service role
// key bypasses RLS and must never reach the browser. Env is read directly per
// project convention (see AGENTS.md — API routes read process.env, not env.ts).
//
// autoRefreshToken/persistSession are disabled: this client acts on behalf of no
// single user and lives per-request, so there is no session to refresh or store.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
