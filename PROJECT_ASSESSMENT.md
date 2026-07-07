# AdPulse — Project Assessment

_Last updated: 2026-07-07_

## What this project is

**AdPulse** is a Next.js 16 (App Router) + React 19 ad-analytics dashboard for
paid-media reporting across Google, Meta, and TikTok. It's backed by Supabase
(Postgres) and includes an OpenRouter-powered AI chat assistant.

**Key architectural facts:**

- **Single-route SPA.** The entire UI lives in `src/app/page.tsx`. There is no
  file-based routing for views — the 10 "views" (dashboard, anomalies, pacing,
  funnel, optimizer, health, creatives, alerts, compare, reports) are toggled
  via a Zustand store (`src/store/app-store.ts`, `activeView`). Only `/` and
  `/api/*` exist as real routes.
- **Data flow:** components → typed TanStack Query hooks (`src/hooks/use-metrics.ts`)
  → `/api/*` route handlers → data layer (`src/lib/data/*`) → Supabase
  (service-role key, server-side, bypassing RLS).
- **Synthetic data.** Every metric originates from `POST /api/seed`, which runs
  `src/lib/mock-data/*` through `src/lib/adapters/*` and inserts the result. There
  are **no live ad-platform integrations** — the adapters normalize *synthetic*
  payloads, not real Google/Meta/TikTok API responses.
- **AI chat** calls OpenRouter directly via raw `fetch` (model
  `google/gemini-3-flash-preview`) with a manual tool-calling loop and SSE
  streaming. The installed `@ai-sdk/*` / `@google/generative-ai` packages are
  **not used** by the chat route.

**Overall verdict:** This is a genuinely feature-rich, well-layered dashboard
with real, non-trivial computation (Z-score anomaly detection, budget pacing,
weighted health scoring, channel-mix optimization, creative fatigue analysis)
and a complete reporting/export/sharing stack. The "not real" parts are clearly
bounded and intentional for a demo/portfolio context. Code quality is consistent
(Zod validation, typed hooks, graceful fallbacks everywhere).

---

## Feature status (by view)

| View | Component | Status |
|---|---|---|
| dashboard | metric-cards, trend-chart, platform-breakdown, widgets, campaign-table | ✅ Complete, real data |
| anomalies | `anomaly-detector.tsx` | ✅ Complete — Z-score anomalies |
| pacing | `campaign-pacing.tsx` | ✅ Complete — budget pacing vs. spend |
| funnel | `funnel-chart.tsx` | ✅ Complete — impressions→clicks→conversions |
| optimizer | `channel-optimizer.tsx` | ✅ Complete — channel-mix reallocation |
| health | `health-score.tsx` | ✅ Complete — 5 sub-scores + grade |
| creatives | `creative-gallery.tsx` + generator | ✅ Complete — AI copy + placeholder imagery |
| alerts | `alerts-manager.tsx` | ⚠️ CRUD complete, notifications are **mock** |
| compare | `comparison-view.tsx` | ✅ Complete — campaign & period comparison |
| reports | `reports-view.tsx` | ⚠️ Build/export/share complete, **email + scheduler are mock** |

---

## What we need to FIX or FINISH

Ordered roughly by importance.

### 1. Authentication & tenancy (biggest gap — production blocker)
- **There is no authentication at all.** No `middleware.ts`, no login UI, no
  session gate. `page.tsx` renders immediately and auto-selects `clients[0]`.
- Every API route uses the **service-role key**, bypassing Supabase RLS. All
  endpoints are publicly callable with full DB privileges.
- `src/lib/supabase/server.ts` sets up an SSR cookie client but is **never used**.
- **Fix:** add Supabase Auth (or Clerk), a `middleware.ts` gate, user→client
  scoping, and move API routes onto RLS-respecting clients where possible.

### 2. Email is entirely mock
- `src/lib/mock-email.ts` only `console.log`s. Used by alerts (`api/alerts`) and
  report schedules (`api/report-schedules`). The reports UI literally says
  "Report sent successfully (mock). Check server console."
- **Fix:** integrate a real transactional email provider (Resend, Postmark, SES).

### 3. No scheduler / cron
- Report schedules and alert rules are stored and can be manually
  "evaluated"/"sent now," but **nothing runs them automatically**. No
  `vercel.json` cron, no worker.
- **Fix:** add Vercel Cron jobs (or `vercel.ts` `crons`) hitting internal
  evaluate/send endpoints, protected by a cron secret.

### 4. No live ad-platform data
- Despite the Google/Meta/TikTok adapter framing, there are no real API clients.
  Everything is seeded synthetic data.
- **Fix (large):** build real OAuth + ingestion for at least one platform, or be
  explicit that this is demo-only.

### 5. Hardcoded future/preview model
- `google/gemini-3-flash-preview` is used in chat, report builder, and creative
  generation. It will 404 against OpenRouter today (each caller degrades to a
  fallback, so nothing breaks, but AI features silently run in basic mode).
- **Fix:** make the model configurable via env; default to a currently-available
  model.

### 6. Chat is not persisted
- `chat_sessions` / `chat_messages` tables exist and are cleared by seed, but
  nothing writes to them — chat history is in-memory only.
- **Fix:** persist sessions/messages; add history retrieval.

### 7. Vestigial dependencies (cleanup)
- `@react-pdf/renderer` — installed but unused; "PDF" export is actually
  `window.print()`.
- `@ai-sdk/google`, `ai`, `@google/generative-ai` — installed but chat uses raw
  OpenRouter fetch.
- **Fix:** remove unused deps, or migrate onto them deliberately (see below).

### 8. Minor robustness
- `api/alerts` PATCH infers the target table (`alert_history` vs `alert_rules`)
  from payload shape — fragile; make it explicit.
- `optimizer.ts` "ROAS" is conversions-per-$100, not revenue-based (no revenue
  field in the model) — fine, but worth a revenue column if monetization matters.

---

## What we should ADD (suggestions from comparable tools)

Inspired by Supermetrics, Funnel.io, AdEspresso, Triple Whale, Madgicx,
NorthBeam, Google Looker Studio, and Metabase.

**Data & integrations**
- Real ad-platform OAuth ingestion (Google Ads, Meta Marketing API, TikTok) with
  scheduled sync — the headline feature of every competitor.
- GA4 / Google Analytics blending for conversion attribution.
- Revenue / ROAS tracking (add a revenue field) — real ROAS, not proxy.
- Multi-touch attribution modeling (NorthBeam/Triple Whale core).
- Currency + timezone normalization per client.

**Analytics & intelligence**
- Budget pacing *alerts* (over/under-pace warnings), not just a view.
- Automated bid/budget recommendations with "apply" write-back to platforms
  (Madgicx/AdEspresso "autopilot").
- Audience/segment breakdowns (age, geo, device, placement).
- Cohort & LTV analysis.
- Forecasting (spend/conversion projection) beyond simple run-rate.
- Anomaly detection with configurable sensitivity + Slack/email push.

**Reporting & collaboration**
- Scheduled report delivery that actually fires (see fix #3).
- White-label / branded PDF reports (logo, colors per client).
- Real server-side PDF (use the already-installed `@react-pdf/renderer`).
- Dashboard-level sharing (not just report snapshots) with view-only links.
- Comments/annotations on charts (being rebuilt — see note below).
- Slack / Teams integration for alerts and digests.

**AI**
- Persist chat + add a "insights digest" that proactively surfaces findings.
- Natural-language → chart generation ("show me CPA by platform last 30 days").
- AI-generated report narratives as an on-demand action per section (partly
  exists in the report builder — expose it interactively).
- Real creative *image* generation (currently placeholder thumbnails).

**Platform & ops**
- Multi-tenancy + team/role management (owner/analyst/viewer).
- Audit log.
- Usage-based rate limiting on public-ish API routes.
- Onboarding flow + empty states for new accounts.

---

## Other suggestions

- **Add a test setup.** There is currently no test runner. Even a light Vitest +
  Playwright smoke suite over the API routes and the seed→render path would catch
  regressions in the substantial data layer.
- **Split `page.tsx` / consider real routing.** The single-route + Zustand-router
  pattern works but hurts deep-linking, code-splitting, and SSR. Next.js App
  Router routes per view would improve URL sharing and performance.
- **Environment validation is not enforced.** `src/lib/env.ts` (zod) exists but
  API routes read `process.env` directly and `SUPABASE_SERVICE_ROLE_KEY` isn't
  validated. Route env access through a single validated module.
- **Move heavy client components to server where possible** to cut bundle size
  (comparison-view is 856 lines, report-viewer 981 lines — all client).
- **Add error boundaries + toasts** for the mutation-heavy flows (alerts,
  schedules, creatives).

---

## Note on the annotations feature

The chart-annotations feature (API route `src/app/api/annotations/`, the
`chart_annotations` table types, the `useAnnotations`/`useCreateAnnotation`/
`useDeleteAnnotation` hooks, and the annotation UI in `trend-chart.tsx`) is being
**removed** to be rebuilt in a different way. This assessment predates that
removal.
