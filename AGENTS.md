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
- `DATABASE_URL` — direct Postgres connection string, required for Drizzle (`drizzle-kit pull`/`generate` and the client in `src/lib/db/index.ts`). Use Supabase's transaction pooler (port 6543) for app runtime; introspection may need the direct connection (port 5432). Not used by the existing `src/lib/data/*` query layer, which still goes through `supabase-js`.

Note: `src/lib/env.ts` exists but the API routes read `process.env` directly — do not assume env validation runs as a gate.

## Architecture

- **UI is a single route, not file-based routing.** `src/app/page.tsx` is the whole app; views (dashboard, anomalies, pacing, funnel, optimizer, attribution, health, creatives, alerts, compare, reports) are toggled via the Zustand store in `src/store/app-store.ts` (`VIEWS`/`activeView`). Only `/` and `/api/*` exist as routes.
- **Data layer:** `src/lib/data/queries.ts` queries Postgres via **Drizzle** (`src/lib/db`). `src/lib/data/optimizer.ts`, `health-score.ts`, and `attribution.ts` derive analytics on top of `getMetrics` (attribution also reads `attribution_journeys`/`customer_cohorts`). These are called from API routes, not Server Components.
- **API routes** (`src/app/api/*`): `metrics` (GET, multi-action via `?action=`), `attribution` (GET, `?action=overview|attribution|cohorts` — revenue/ROAS, multi-touch attribution, LTV cohorts), `chat` (POST, SSE stream), `clients`, `campaigns`, `reports`, `reports/share`, `report-schedules`, `optimizer`, `alerts`, `creatives`, `creatives/generate`, `seed`.
- **Mock data + adapters:** `src/lib/mock-data/{google,meta,tiktok}-ads.ts` generate fake data; `src/lib/adapters/*` normalize each platform into the unified schema. Used only by the seed route.
- **Database types are hand-written** in `src/lib/types/database.ts` (not generated via `supabase gen-types`). Tables: `clients`, `campaign_performance` (now includes a `revenue` column — platform self-reported conversion value), `campaign_budgets`, `reports`, `chat_sessions`, `chat_messages`, `ad_creatives`, `alert_rules`, `alert_history`, `report_schedules`, `attribution_journeys` (cross-platform conversion paths), `customer_cohorts` (LTV/retention by acquisition channel). Update this file when the schema changes.
- **Drizzle ORM is the DB layer** (`drizzle.config.ts`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`). All DB reads (`src/lib/data/queries.ts`) and all API-route writes (`reports`, `reports/share`, `alerts`, `report-schedules`, `seed`) go through Drizzle. `@supabase/supabase-js` is retained only for the browser client (`src/lib/supabase/client.ts`) for future Auth/Storage — do **not** reintroduce it for DB access.
- **camelCase ↔ snake_case boundary:** Drizzle models columns in camelCase, but the app (Zod schemas, mock data, the `*Row` types, the frontend, and the chat tools) speaks snake_case. Cross the boundary with `keysToSnake`/`keysToCamel` from `src/lib/db/case.ts` (shallow — nested JSON column values like `raw_payload`/`metrics_summary`/`reference_context` are passed through untouched). Reads map results with `keysToSnake`; writes map payloads with `keysToCamel`. `queries.ts` alternatively uses explicit aliased `select({ snake_case: table.camelColumn })` maps.
- **`npm run db:pull` (`drizzle-kit pull`) currently crashes** on this project (`drizzle-kit@0.31.10`) with `TypeError: Cannot read properties of undefined (reading 'replace')` while processing CHECK constraints — reproduced directly against this DB's `pg_get_constraintdef` output showing no null values, so it looks like a drizzle-kit introspection bug, not a data issue. `src/lib/db/schema.ts` is therefore **hand-written** (12 tables, mirrors the live DB as of 2026-07-07) rather than generated. Schema changes are applied to the live DB via hand-written SQL in `drizzle/` (e.g. `drizzle/0001_attribution_revenue.sql`) run against `DATABASE_URL`, since `db:pull`/`db:generate` are unreliable here. If you retry `db:pull` after a drizzle-kit upgrade and it succeeds, review the diff carefully before trusting it over the hand-written version.

## AI chat — do not "fix" the provider

`src/app/api/chat/route.ts` calls **OpenRouter** via raw `fetch` (model `google/gemini-3-flash-preview`) with a manual tool-calling loop and SSE streaming. The `@ai-sdk/google` / `@google/generative-ai` deps are present but not used by the chat route. Do not refactor it onto the AI SDK without being asked.

## Seeding

`POST /api/seed` inserts 3 demo clients + 6 months of generated campaign data into Supabase (including per-row `revenue`, plus `attribution_journeys` and `customer_cohorts` generated from the seeded rows so the blended-vs-reported ROAS, multi-touch attribution, and LTV:CAC stories reconcile). Pass `{ "force": true }` to drop and reseed. Requires the service role key. The attribution mock data carries deliberate, demonstrable stories (see `src/lib/mock-data/attribution.ts`): ~35% platform over-attribution, Google last-touch-vs-first-touch credit divergence, and an LTV:CAC ranking that inverts short-window ROAS.

## Style & UI

- Tailwind v4, configured via CSS (`@import "tailwindcss"` in `src/app/globals.css`) — there is no `tailwind.config.js`.
- shadcn components use the **`base-nova`** style on `@base-ui/react` (not Radix), lucide icons. Config in `components.json`; aliases resolve to `@/components/ui`, `@/lib`, `@/hooks`.
- Path alias: `@/*` -> `./src/*`. TypeScript strict mode.
