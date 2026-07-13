<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# AdPulse

Next.js 16 (App Router) + React 19 ad-analytics dashboard. Single-page UI backed by Supabase, with an OpenRouter-powered AI chat.

## Commands

- `npm run dev` — dev server on :3000
- `npm run build` — production build (also performs the typecheck; there is no separate `typecheck` script)
- `npm run lint` — eslint (flat config, no extra args)
- `npm run start` — serve the built app

**There is no test suite and no test runner installed.** Do not attempt `vitest`/`jest`; verification is `npm run lint` + `npm run build`.

## Environment

Copy `.env.example` to `.env.local`. Required to run:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — validated by `src/lib/env.ts` (zod).
- `SUPABASE_SERVICE_ROLE_KEY` — **not** validated by `env.ts` but used by the server data layer and the seed route. Without it, `src/lib/data/queries.ts` and `src/app/api/seed/route.ts` fall back to the anon key and most reads/writes will fail.
- `OPENROUTER_API_KEY` — optional. Without it the chat route degrades to a non-AI "basic mode" summary instead of erroring.
- `DATABASE_URL` — Postgres connection string, required for the Drizzle client (`src/lib/db/index.ts`), the migration runner (`scripts/migrate.mjs`), and `db:studio`. Use Supabase's transaction pooler (port 6543); the migration runner works fine over it. The `src/lib/data/*` query layer and all API-route writes go through Drizzle; `supabase-js` is Auth-only.
- `NEXT_PUBLIC_SITE_URL` — optional; canonical public origin used for invite-email redirect links (falls back to the request origin).
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional; enable rate limiting (`src/lib/rate-limit.ts`, Upstash Redis) for the public share endpoint (`GET /api/reports/share`), `chat`, and `creatives/generate`. **Both must be set** or rate limiting fails open (no limiting) — so local dev and CI are unaffected. Provision an Upstash Redis (Vercel Marketplace) in production so these endpoints are actually throttled.

Note: `src/lib/env.ts` exists but the API routes read `process.env` directly — do not assume env validation runs as a gate.

## Architecture

- **UI is a single route, not file-based routing.** `src/app/page.tsx` is the whole app; views (dashboard, anomalies, pacing, funnel, optimizer, attribution, health, creatives, alerts, compare, reports, team) are toggled via the Zustand store in `src/store/app-store.ts` (`VIEWS`/`activeView`). Besides `/` and `/api/*`, the only other routes are auth pages: `/login`, `/auth/callback` (PKCE code exchange), `/auth/accept-invite` (invite landing + set-password).
- **Auth & multi-tenancy (Supabase Auth).** `src/proxy.ts` (Next 16's replacement for `middleware.ts` — named `proxy` export, Node runtime) refreshes the session via `@supabase/ssr` and gates everything except `/login`, `/auth/callback`, `/auth/accept-invite`, `/` with `?share=`, and `GET /api/reports/share`; unauthenticated API calls get 401, pages redirect to `/login`. Roles (`AppRole`): `agency_admin` / `agency_member` (see all clients) and `client_user` (only clients listed in `client_members`). Server-side authorization lives in `src/lib/auth/session.ts` (`getAuthContext()` — `getClaims()` + `user_profiles` lookup) and `src/lib/auth/guard.ts` (`requireUser`/`requireClientAccess`/`requireAgencyRole`/`allowedClientIds`); **every API route must call the guard before any DB work** because `clientId` is caller-supplied and Postgres RLS is NOT used (Drizzle connects with the app's own credentials). Role-gated UI reads `useCurrentUser()` (`/api/me`) with helpers in `src/lib/auth/roles.ts`. Admin-only `/api/users` + the `team` view handle invites (`auth.admin.inviteUserByEmail` via `src/lib/supabase/admin.ts`); invite links land on `/auth/accept-invite` with **implicit-flow tokens in the URL hash** — the pkce browser client cannot auto-detect those, so the page parses the hash and calls `setSession()` manually. Bootstrap the first admin with `node scripts/create-admin.mjs <email> [password]`. Production invites need Supabase dashboard config: custom SMTP, redirect-URL allow-list, and `NEXT_PUBLIC_SITE_URL`.
- **The `dashboard` view is a customizable widget grid** (`src/components/dashboard/customizable-dashboard.tsx`) on **react-grid-layout 2.x**. Widgets are declared in a registry (`src/lib/dashboard/widget-registry.tsx`) — each has a `Render` component (reusing existing hooks), optional `ConfigForm`, default size/config. Edit state (draft/dirty/add/remove/resize) lives in `src/store/dashboard-store.ts`; layouts persist per client via `useDashboard`/`useSaveDashboard` → `/api/dashboards` (localStorage is an offline cache). `src/lib/dashboard/default-preset.ts` mirrors the classic fixed layout so an unsaved client sees a sensible page. **RGL 2.x ≠ the tutorials/1.x:** it self-measures via `useContainerWidth` (no `WidthProvider`), uses config objects (`dragConfig`/`resizeConfig`) instead of flat `isDraggable`/`draggableHandle` props, ships its own types (do **not** install `@types/react-grid-layout`, which is the 1.x API), and drops `findDOMNode` (which is why 1.x would crash under React 19).
- **Data layer:** `src/lib/data/queries.ts` queries Postgres via **Drizzle** (`src/lib/db`). `src/lib/data/optimizer.ts`, `health-score.ts`, and `attribution.ts` derive analytics on top of `getMetrics` (attribution also reads `attribution_journeys`/`customer_cohorts`); `src/lib/data/dashboards.ts` reads/writes the `dashboards` table. These are called from API routes, not Server Components.
- **API routes** (`src/app/api/*`): `metrics` (GET, multi-action via `?action=`), `attribution` (GET, `?action=overview|attribution|cohorts` — revenue/ROAS, multi-touch attribution, LTV cohorts), `dashboards` (GET by client + PUT upsert of saved layouts), `chat` (POST, SSE stream), `clients`, `campaigns`, `reports`, `reports/share` (share links now carry `share_expires_at`; POST accepts `expiresInDays`), `report-schedules`, `optimizer`, `alerts`, `creatives`, `creatives/generate`, `seed`, `me` (current user + profile), `users` (admin-only team CRUD + invites). All routes are authorization-guarded (see Auth above): client-scoped reads check membership; alerts/report-schedules/creatives-generate/dashboards-PUT/reports-share-POST are agency-only; seed and users are agency_admin-only; reports/share GET is public (token + password).
- **Mock data + adapters:** `src/lib/mock-data/{google,meta,tiktok}-ads.ts` generate fake data; `src/lib/adapters/*` normalize each platform into the unified schema. Used only by the seed route.
- **Database types are hand-written** in `src/lib/types/database.ts` (not generated via `supabase gen-types`). Tables: `clients`, `campaign_performance` (now includes a `revenue` column — platform self-reported conversion value), `campaign_budgets`, `reports` (incl. `share_token`/`share_password_hash`/`share_expires_at`), `chat_sessions`, `chat_messages`, `ad_creatives`, `alert_rules`, `alert_history`, `report_schedules`, `attribution_journeys` (cross-platform conversion paths), `customer_cohorts` (LTV/retention by acquisition channel), `dashboards` (per-client customizable dashboard layouts — `layouts`/`widgets` JSON), `user_profiles` (id = `auth.users.id`, app role) and `client_members` (client_user → client memberships). Update this file when the schema changes.
- **Drizzle ORM is the DB layer** (`drizzle.config.ts`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`). All DB reads (`src/lib/data/queries.ts`) and all API-route writes (`reports`, `reports/share`, `alerts`, `report-schedules`, `seed`, `users`) go through Drizzle. `@supabase/supabase-js` is used for **Auth only**: the browser client (`src/lib/supabase/client.ts`), the SSR server client (`src/lib/supabase/server.ts`, consumed by `src/lib/auth/session.ts` and `src/proxy.ts`), and the service-role admin client (`src/lib/supabase/admin.ts`, invites/user admin). Do **not** reintroduce supabase-js for DB access.
- **camelCase ↔ snake_case boundary:** Drizzle models columns in camelCase, but the app (Zod schemas, mock data, the `*Row` types, the frontend, and the chat tools) speaks snake_case. Cross the boundary with `keysToSnake`/`keysToCamel` from `src/lib/db/case.ts` (shallow — nested JSON column values like `raw_payload`/`metrics_summary`/`reference_context` are passed through untouched). Reads map results with `keysToSnake`; writes map payloads with `keysToCamel`. `queries.ts` alternatively uses explicit aliased `select({ snake_case: table.camelColumn })` maps.
- **Schema changes go through a Drizzle SQL migration — never ad-hoc SQL run straight against the DB.** Every schema change is a new idempotent file `drizzle/NNNN_name.sql`, applied by the ledger-tracked runner `scripts/migrate.mjs`. The workflow for any schema change is:
  1. Write `drizzle/NNNN_name.sql` (next number after the highest existing file). Make it idempotent: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ADD CONSTRAINT` guarded by a `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='…' AND conrelid='public.<table>'::regclass) THEN … END IF; END $$;` block — see `drizzle/0000_baseline.sql` for the pattern.
  2. Run `npm run db:migrate` (applies every pending file in ascending filename order, each in its own transaction, recording it in the `_migrations` ledger table). `npm run db:migrate:status` shows applied vs pending; `node scripts/migrate.mjs --mark-applied` records pending files as applied **without running them** (backfills the ledger on a DB whose schema already matches).
  3. Update **both** `src/lib/db/schema.ts` (Drizzle model — camelCase, keep its `index()`/`uniqueIndex()`/`check()` in sync with the SQL) **and** `src/lib/types/database.ts` (hand-written Row types) to match. These are hand-maintained mirrors of the DB; nothing generates them.
- **`drizzle/0000_baseline.sql` is the full-schema baseline** (all 15 tables, constraints, and indexes, generated by introspecting the live DB). It is fully idempotent, so `db:migrate` against a **fresh** Supabase project rebuilds the whole schema from empty (baseline does the work; 0001/0003/0004 then no-op), and against the existing prod DB every statement is a no-op. The `0002` gap is historical. The cross-schema FK `user_profiles.id → auth.users(id)` needs Supabase's `auth` schema to already exist. `psql`/`pg_dump`/Docker are not available in this environment; the baseline was captured by introspecting via the `postgres` package over `DATABASE_URL`.
- **Do NOT use or re-add the drizzle-kit generators.** `drizzle-kit pull`/`generate`/`migrate` are unreliable here — `pull` crashes on this project (`drizzle-kit@0.31.10`, `TypeError: Cannot read properties of undefined (reading 'replace')` while processing CHECK constraints, a drizzle-kit introspection bug). That is why `schema.ts` is hand-maintained and migrations are hand-written SQL. Only `db:studio` (read-only browsing) still uses drizzle-kit. If a future drizzle-kit upgrade fixes `pull`, review its output carefully before trusting it over the hand-written files.

## AI chat — do not "fix" the provider

`src/app/api/chat/route.ts` calls **OpenRouter** via raw `fetch` (model `google/gemini-3-flash-preview`) with a manual tool-calling loop and SSE streaming. The `@ai-sdk/google` / `@google/generative-ai` deps are present but not used by the chat route. Do not refactor it onto the AI SDK without being asked.

## Seeding

`POST /api/seed` inserts 3 demo clients + 6 months of generated campaign data into Supabase (including per-row `revenue`, plus `attribution_journeys` and `customer_cohorts` generated from the seeded rows so the blended-vs-reported ROAS, multi-touch attribution, and LTV:CAC stories reconcile). Pass `{ "force": true }` to drop and reseed. Requires the service role key and an `agency_admin` session. The attribution mock data carries deliberate, demonstrable stories (see `src/lib/mock-data/attribution.ts`): ~35% platform over-attribution, Google last-touch-vs-first-touch credit divergence, and an LTV:CAC ranking that inverts short-window ROAS.

## Style & UI

- Tailwind v4, configured via CSS (`@import "tailwindcss"` in `src/app/globals.css`) — there is no `tailwind.config.js`.
- shadcn components use the **`base-nova`** style on `@base-ui/react` (not Radix), lucide icons. Config in `components.json`; aliases resolve to `@/components/ui`, `@/lib`, `@/hooks`.
- Path alias: `@/*` -> `./src/*`. TypeScript strict mode.
