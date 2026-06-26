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

Note: `src/lib/env.ts` exists but the API routes read `process.env` directly — do not assume env validation runs as a gate.

## Architecture

- **UI is a single route, not file-based routing.** `src/app/page.tsx` is the whole app; views (dashboard, anomalies, pacing, funnel, optimizer, health, reports) are toggled via the Zustand store in `src/store/app-store.ts` (`VIEWS`/`activeView`). Only `/` and `/api/*` exist as routes.
- **Data layer:** `src/lib/data/queries.ts` queries Supabase directly (service role key). `src/lib/data/optimizer.ts` and `health-score.ts` derive analytics. These are called from API routes, not Server Components.
- **API routes** (`src/app/api/*`): `metrics` (GET, multi-action via `?action=`), `chat` (POST, SSE stream), `clients`, `campaigns`, `reports`, `optimizer`, `seed`.
- **Mock data + adapters:** `src/lib/mock-data/{google,meta,tiktok}-ads.ts` generate fake data; `src/lib/adapters/*` normalize each platform into the unified schema. Used only by the seed route.
- **Database types are hand-written** in `src/lib/types/database.ts` (not generated via `supabase gen-types`). Tables: `clients`, `campaign_performance`, `campaign_budgets`, `reports`, `chat_sessions`, `chat_messages`. Update this file when the schema changes.

## AI chat — do not "fix" the provider

`src/app/api/chat/route.ts` calls **OpenRouter** via raw `fetch` (model `google/gemini-3-flash-preview`) with a manual tool-calling loop and SSE streaming. The `@ai-sdk/google` / `@google/generative-ai` deps are present but not used by the chat route. Do not refactor it onto the AI SDK without being asked.

## Seeding

`POST /api/seed` inserts 3 demo clients + 6 months of generated campaign data into Supabase. Pass `{ "force": true }` to drop and reseed. Requires the service role key.

## Style & UI

- Tailwind v4, configured via CSS (`@import "tailwindcss"` in `src/app/globals.css`) — there is no `tailwind.config.js`.
- shadcn components use the **`base-nova`** style on `@base-ui/react` (not Radix), lucide icons. Config in `components.json`; aliases resolve to `@/components/ui`, `@/lib`, `@/hooks`.
- Path alias: `@/*` -> `./src/*`. TypeScript strict mode.
