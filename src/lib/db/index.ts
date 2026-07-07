import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// `prepare: false` is required when connecting through Supabase's transaction
// pooler (pgbouncer, port 6543) — it doesn't support prepared statements.
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, { schema });
