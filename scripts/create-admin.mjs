// Bootstrap the first agency admin.
//   node scripts/create-admin.mjs <email> [password]
//
// Creates (or reuses) a Supabase auth user via the service role, then upserts a
// user_profiles row with role='agency_admin'. Idempotent — safe to re-run.
// If no password is given, one is generated and printed ONCE. Never prints the
// service-role key.
import { randomBytes } from "node:crypto";
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

const email = process.argv[2];
let password = process.argv[3];

if (!email) {
  console.error("Usage: node scripts/create-admin.mjs <email> [password]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (check .env.local).");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (check .env.local).");
  process.exit(1);
}

let generatedPassword = false;
if (!password) {
  // 24 alnum chars from random bytes.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(24);
  password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  generatedPassword = true;
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sql = postgres(databaseUrl, { prepare: false, max: 1 });

async function resolveUserId() {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error && data?.user?.id) {
    console.log(`✓ Created auth user ${email}`);
    if (generatedPassword) {
      console.log(`  Generated password: ${password}`);
      console.log("  Change it after first login.");
    }
    return data.user.id;
  }

  // Already registered — look up the id directly in Postgres.
  const message = error?.message ?? "";
  const alreadyExists =
    /already.*registered|already.*exist|email.*taken|duplicate/i.test(message) ||
    error?.status === 422;

  if (!alreadyExists) {
    throw error ?? new Error("Failed to create user for an unknown reason.");
  }

  const rows = await sql`select id from auth.users where email = ${email}`;
  if (rows.length === 0) {
    throw new Error(`User ${email} reported as existing but not found in auth.users.`);
  }
  console.log(`• Auth user ${email} already exists — reusing.`);
  return rows[0].id;
}

try {
  const userId = await resolveUserId();

  await sql`
    insert into user_profiles (id, role)
    values (${userId}, 'agency_admin')
    on conflict (id) do update set role = 'agency_admin', updated_at = now()
  `;

  console.log(`✓ user_profiles row for ${email} set to role='agency_admin' (id: ${userId})`);
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error("✗ Failed to bootstrap admin:");
  console.error(err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
