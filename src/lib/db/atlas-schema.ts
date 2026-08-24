// Read-only Drizzle models of the Atlas (ai-page-generator) tables AdPulse
// consumes from the shared Supabase project's `public` schema. Atlas OWNS these
// tables and manages their shape with drizzle-kit push from the Atlas repo —
// never write to them and never migrate them from AdPulse. Model only the
// columns AdPulse reads so Atlas can evolve the rest freely.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// One row per Clerk user known to Atlas. `role` is an Atlas role string
// (admin, manager, account_manager, client, …) — map it onto an AdPulse
// AppRole with mapAtlasRole() (src/lib/auth/atlas-roles.ts).
export const atlasUserRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
});

// Atlas project membership (client users ↔ projects). An AdPulse client is
// reachable by a client_user when clients.atlas_project_id matches one of the
// user's project assignments here.
export const atlasProjectUsers = pgTable("project_users", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  clerkUserId: text("clerk_user_id").notNull(),
});
