// Generic hand-written-migration runner.
//   node scripts/apply-migration.mjs drizzle/0004_auth_tenancy.sql
//
// `drizzle-kit push/generate` is unreliable on this project (see AGENTS.md), so
// migrations are plain SQL files applied here. Loads .env.local, connects via
// the `postgres` package to DATABASE_URL (Supabase transaction pooler), and runs
// the file as one unsafe (multi-statement) batch.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (check .env.local).");
  process.exit(1);
}

const path = resolve(process.cwd(), file);

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

try {
  const contents = await readFile(path, "utf8");
  console.log(`Applying ${file} ...`);
  await sql.unsafe(contents);
  console.log(`✓ Applied ${file}`);
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error(`✗ Failed to apply ${file}:`);
  console.error(err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
