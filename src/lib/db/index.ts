import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// `prepare: false` is required when connecting through a transaction pooler
// (Neon's `-pooler` endpoint, pgbouncer) — it doesn't support prepared statements.
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, { schema });

/**
 * The pooled handle or a transaction handle. Data-layer functions take this so
 * a caller can run several of them inside one `db.transaction`, and so reads
 * made inside a transaction see that transaction's own uncommitted writes.
 */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
