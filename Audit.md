AdPulse: MVP → Production Architecture Assessment

What's already solid (preserve these)

- Auth & tenancy is the strongest layer. Every one of the 18 API routes calls requireUser() before DB work; every caller-supplied clientId goes through requireClientAccess first; the chat tool loop even overrides the model-supplied clientId with the authorized one (src/app/api/chat/route.ts:210 — good prompt-injection defense). No route does DB work before its guard. proxy.ts has no bypass gaps.
- TypeScript hygiene: strict mode, zero any, zero @ts-ignore, zero TODO/FIXME across the repo.
- Clean seams: mock data/adapters are imported only by the seed route, never in production read paths; date-range filtering is correctly pushed to SQL; React Query hooks are centralized (use-metrics.ts holds ~25 queries) with correct enabled gating and invalidation.

---

🔴 Critical — fix before calling anything "production"

1. The database cannot be rebuilt from the repo

drizzle/ contains only additive migrations 0001/0003/0004. The 10 core tables (clients, campaign*performance, reports, chat*_, alert\__, …) have no SQL source of truth anywhere — they exist only in the live Supabase instance, and schema.ts is a hand transcription of it. There's also no migration ledger: scripts/apply-migration.mjs:35 just runs whatever file you name, recording nothing. A new environment, a staging DB, CI, or disaster recovery is currently impossible.
Fix: dump the live schema into a baseline 0000_baseline.sql, add a simple \_migrations ledger table to apply-migration.mjs, and treat drizzle/ as canonical from then on.

2. Public share links are brute-forceable and weakly hashed  
   reports/share/route.ts is intentionally public (correct), but: passwords are unsalted single-pass SHA-256 (:21-27), compared with plain !== (:144), minimum length is 4 chars (:30), and thereere in the repo. This endpoint exposes clientperformance data to the open internet. Fix: bcrypt/argon2 + crypto.timingSafeEqual, longer mistash or Vercel WAF rules) — prioritize this endpointplus the two paid AI endpoints (chat, creatives/generate).
3. .env.example contains real-looking live secrets  
   .env.example:4,8,11 hold what appear to be a real service-role JWT and a real OpenRouter key. It's gitignored today, but one git add -f or a repo export leaks a key that bypasses all authorizatnd rotate the OpenRouter key + service-role keyregardless.

4. Errors are invisible to you and leaked to clients

This is systemic across both halves of the stack:

- Server: ~20 routes return raw error.message in the 5 internals) without logging anything server-side. NoSentry, no structured logging, 14 console.\* calls total. A production incident today is undiagnosable.
- Client: only 2 of ~30 data-driven components check iructures isLoading only and renders empty on failure —indistinguishable from "no data." There are no error boundaries around the 12 views (only per-widget), no error.tsx anywhere, so one
  render error white-screens the app.
- Worst instance: report generation swallows its DB insert error and returns 200 with id: undefined (reports/route.ts:62-64) — silent data
  loss presented as success.
  Fix: one shared withRoute() wrapper (auth → zod parse → handler → logged, sanitized error response) kills the leakage, adds logging, and
  deletes ~20 copies of boilerplate in a single change. ct Query error handler + per-view error states.

---

🟠 High

5. Three features look done but silently do nothing

- Report schedules store frequency/recipients but no cron exists — nothing ever runs them (report-schedules/route.ts, manual
  ?action=send-now only).
- Alert rules are only evaluated when someone manually hits ?action=evaluate — no background evaluation.
- Email is a console.log stub (src/lib/mock-email.ts:1ove, which then return HTTP 200 "sent."
  This is the most dangerous product debt: users will configure alerts and schedules, trust them, and get nothing. Fix: Vercel Cron hitting
  the evaluate/send endpoints + a real provider (Resend

6. Zero tests, zero CI

No test runner, no .github/. The entire safety net is mum bar: a GitHub Actions workflow running lint + buildon PR, then targeted tests where correctness actually matters — guard.ts (the whole tenancy model), the share-link hash/expiry path, and
the alert-evaluation math.

7. The hot query path has no index and aggregates in J

campaign_performance is filtered by client_id + date b(metrics, trend, funnel, pacing, optimizer, health,attribution, anomalies, alerts) and has no index on (client_id, date) — no index() calls exist in schema.ts for it. On top of that,
getMetrics returns every raw row unbounded and all conalert evaluation runs one full scan per rule in a loop(alerts/route.ts:195-262). Fine at seed scale; a cliff with real data.
Fix: add the composite index (one migration line), the SQL GROUP BY incrementally, starting withsummarizeMetrics and alert evaluation.

8. The single-route SPA — your routing question

You're right, and it's worth more than tidiness. The current design (page.tsx switching 12 views off useAppStore.activeView) costs you
three concrete things:

1. Zero code-splitting. There is not a single dynamic( views — including Recharts (~8 views),react-grid-layout, react-markdown, the 880-line report viewer — ship in the first paint bundle.
2. Zero URL state. activeView, selected client, date rin Zustand with no persistence — nothing isbookmarkable, back/forward is dead, refresh resets everything to dashboard/first-client/last-30-days.
3. No route-level error.tsx/loading.tsx, which is half

Splitting into routes fixes all three for free. Sugges

src/app/(app)/
layout.tsx ← AppShell + sidebar moves here (renders once)
dashboard/page.tsx anomalies/page.tsx pacing
funnel/page.tsx optimizer/page.tsx attribution/page.tsx
health/page.tsx creatives/page.tsx alerts
compare/page.tsx reports/page.tsx team/page.tsx
error.tsx loading.tsx ← shared boundaries, per-rou

Decisions to make going in:

- Client scope: either ?client= searchParam (smallest change) or /(app)/[clientId]/… path segment (cleaner for a multi-tenant product; the
  current "auto-pick first client" effect at page.tsx:12'd take the path segment — it makes tenancy explicitand future-proofs client-scoped deep links.
- Filters (dateRange, platform) become searchParams vilace; Zustand keeps only true UI state (chat open, editmode, drafts in dashboard-store).
- RBAC becomes route-level. Today client_users are bouient-side effect in the sidebar (sidebar.tsx:259-266) —UX-only enforcement. With routes, a layout-level check redirects properly.
- The mechanical migration is low-risk because each viined component — each route's page.tsx is a thinwrapper. Do it one view at a time; the sidebar changes from onClick={setActiveView} to <Link>.
- Note layout.tsx:25 sets overflow-hidden/h-screen (fishared (app)/layout.tsx keeps that, so visually nothingchanges.

9. Every table shape is defined 4–5 times, and drift is already visible

Drizzle schema (camelCase) + hand-written \*Row types + a Supabase-style Database interface + per-route zod schemas + ad-hoc types like
chat.ts:5-19. The Database interface is already missin code (supabase-js is auth-only) — delete it. Worse,keysToSnake/keysToCamel return Record<string, unknown>, so every mutating route double-casts (as unknown as …) on the write path — a
renamed column sails through the compiler and fails atlerts/report-schedules additionally spread unvalidatedrequest bodies straight into db.update().set() (mass assignment, alerts/route.ts:113-143).
Fix: make Drizzle $inferSelect/$inferInsert the single snake_case wire types from them (a mapped type can dothe case conversion at the type level), and give every PATCH a zod schema.

---

🟡 Medium (schedule, don't panic)

- No transactions on multi-step writes: force-reseed d in batches, all autocommit (seed/route.ts:51-181) —mid-failure leaves a half-wiped DB; invite flow can create a user with no client membership. The pattern exists (users/route.ts:251 uses
  db.transaction correctly) — apply it.
- env.ts is dead code: nothing imports it, and it validates the least-critical vars while DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
  unchecked process.env.X! reads. Wire fail-fast validatoot.
- DB pool unconfigured: db/index.ts:7 sets prepare: false (correct for the pooler) but no max/timeouts — serverless instances × default 10
  connections will exhaust pgbouncer under load. Set maxer instance.
- Chat route hardening: no fetch timeouts/maxDuration, unguarded JSON.parse of tool args, and full conversation history resent every
  request with no cap (chat/route.ts:311-446) — unbounde
- Four dead AI/PDF deps: @react-pdf/renderer, ai, @ai-sdk/google, @google/generative-ai are imported nowhere — remove.
- No security headers at all (next.config.ts is empty)CSP (share pages are currently framable),X-Content-Type-Options.
- Double auth round-trip per request: proxy calls netwroute re-verifies via getAuthContext() + a profilequery. Cache the profile lookup or lean on getClaims() in the proxy.
- No pagination on any list endpoint (reports, users, TP caching on data GETs (React Query's 60s staleTime isthe only cache).
- Duplication worth consolidating: formatCurrency/formles → one lib/format.ts; aggregateByCampaign copy-pasted between campaign-table.tsx:34 and its widget twin; and the broader classic-views vs widgets/\* parallel implementations (trend, table,
  funnel, breakdown, health) mean every metric fix must canonical and make widgets thin wrappers.

🟢 Low

Hand-rolled client-switcher dropdown with no keyboard//Popover primitive exists; "Seed demo data" button inthe production sidebar; no engines pinning in package.json; raw <img> for creatives instead of next/image; query keys embed whole param
objects (["metrics", params]) instead of explicit tupl

---

Suggested sequencing

1. Week 1 — safety net & security: CI (lint+build), shared withRoute() wrapper + Sentry (kills error leakage, adds logging, deletes
   boilerplate), rotate/scrub secrets, harden share passwendpoints, security headers, wire env validation.
2. Week 2 — data foundation: baseline migration + ledger, (client_id, date) index, transactions on seed/invite, pool config, fix the
   swallowed report-save error.
3. Weeks 3-4 — the routing migration: one view at a time into (app)/[clientId]/<view>, URL-ify filters, add error.tsx/loading.tsx, let
   code-splitting happen.
4. Week 5 — make features truthful: Vercel Cron for schedules + alert evaluation, real email provider, pagination.
5. Ongoing — consolidation: single-source types off Drc-vs-widget reconciliation, dead deps removal.

Item 1 and 2 are deliberately before the routing work:sk everything after, and the withRoute() wrapperespecially means every subsequent change lands on a consistent foundation.

Want me to turn any slice of this into an actual implementation plan (the withRoute() wrapper and the routing migration are the two I'd start with), or publish this as a shareable artifact f
