// Ledger-tracked migration runner.
//
//   node scripts/migrate.mjs            # apply every pending migration, in order
//   node scripts/migrate.mjs --status   # show applied vs pending, apply nothing
//   node scripts/migrate.mjs --mark-applied   # record all files as applied WITHOUT
//                                              # running them (backfill an existing DB
//                                              # whose schema already matches the repo)
//
// Migrations are the plain SQL files in drizzle/*.sql, applied in ascending
// filename order (0000_baseline.sql first). drizzle-kit generate/migrate are
// unreliable on this project (see AGENTS.md), so this is the canonical runner.
//
// Each file runs inside a single transaction and is recorded in the _migrations
// ledger table on success; a failure rolls the whole file back and stops. Files
// are meant to be idempotent (IF NOT EXISTS / guarded ADD CONSTRAINT), so a
// re-run after a partial failure is safe.
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (check .env.local).");
  process.exit(1);
}

const mode = process.argv[2] ?? "--apply";
const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");

// Idempotent migrations emit "already exists, skipping" NOTICEs on a populated
// DB — expected and noisy, so silence them unless MIGRATE_VERBOSE is set.
const sql = postgres(DATABASE_URL, {
  prepare: false,
  max: 1,
  onnotice: process.env.MIGRATE_VERBOSE ? undefined : () => {},
});

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await sql`SELECT name FROM _migrations`).map((r) => r.name)
  );
  const pending = files.filter((f) => !applied.has(f));

  if (mode === "--status") {
    console.log("Applied:");
    for (const f of files.filter((f) => applied.has(f))) console.log(`  ✓ ${f}`);
    console.log("Pending:");
    if (pending.length === 0) console.log("  (none)");
    for (const f of pending) console.log(`  • ${f}`);
    return;
  }

  if (pending.length === 0) {
    console.log("Nothing to do — database is up to date.");
    return;
  }

  if (mode === "--mark-applied") {
    for (const f of pending) {
      await sql`INSERT INTO _migrations (name) VALUES (${f}) ON CONFLICT DO NOTHING`;
      console.log(`  ✓ marked applied (not run): ${f}`);
    }
    console.log(`Recorded ${pending.length} migration(s) without running them.`);
    return;
  }

  if (mode !== "--apply") {
    console.error(`Unknown mode: ${mode}`);
    console.error("Usage: node scripts/migrate.mjs [--apply|--status|--mark-applied]");
    process.exit(1);
  }

  for (const f of pending) {
    const contents = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    process.stdout.write(`Applying ${f} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO _migrations (name) VALUES (${f})`;
    });
    console.log("✓");
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

try {
  await main();
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error("\n✗ Migration failed (transaction rolled back):");
  console.error(err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
