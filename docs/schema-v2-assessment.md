# AdPulse Schema v2 — Demo-vs-Reality Assessment

> **Purpose:** The current schema/business logic was designed as a tech demo by imagining how ad
> platforms report, not from their real APIs. This document assesses how far off we are now that
> real data (via Windsor.ai) is coming in, and proposes the target design.
> **Inputs:** full codebase audit + platform research (Meta Insights API, Google Ads API, TikTok
> Business API, Windsor connector docs) — 2026-07-13.
> **Companion:** `docs/data-ingestion-strategy.md` (ingestion/Windsor strategy).

---

## 1. Verdict

The **structural instincts were right** (one unified table + `platform` discriminator, `raw_payload`
kept per row, camel/snake boundary, ratios recomputed in aggregations). The **semantics are wrong in
ways that break on real data** — and three whole features (attribution, LTV cohorts, creatives) have
**no possible data source** in a Windsor-only world; they run on hand-authored fiction.

Severity legend: 🟥 breaks outright · 🟧 silently wrong numbers · 🟨 needs redesign/retuning.

## 2. Findings inventory

### 🟥 Breaks outright

| # | Finding | Where |
|---|---|---|
| 1 | **`conversions` is `integer`.** Google's `metrics.conversions` is *fractional* (data-driven attribution credit splits, e.g. `2.37`). Rounding is lossy; the column type is wrong. | `schema.ts:44`, `google-adapter.ts:22` |
| 2 | **No unique key on `campaign_performance`** — only a surrogate `id` PK. All platforms restate trailing days (Meta ≤28d, Google ≤90d windows, TikTok 3–7d), so sync must be *upsert with a rolling re-pull window*. Today's insert-only path would duplicate rows on every re-pull. Same gap on `ad_creatives`, `campaign_budgets`. | `schema.ts:32-58`, `seed/route.ts:82-90` |
| 3 | **Meta adapter hard-codes `action_type === "purchase"`.** Real accounts use `omni_purchase`, `offsite_conversion.fb_pixel_custom.<name>`, lead events, etc. — most real accounts would silently report **0 conversions**. Confirmed against our live Windsor data (4 accounts, 7 distinct action_types, none named `purchase`). | `meta-adapter.ts:10-17` |
| 4 | **No currency anywhere.** No column, `$` hard-coded in formatters, and every SUM mixes currencies across accounts/clients. Our live accounts are THB. | `format.ts:26-43`, all of `queries.ts` |
| 5 | **`attribution_journeys` + `customer_cohorts` are pure fiction with no real source.** Journey paths are hand-authored weighted templates; volume is forced to exactly 74% of reported conversions (the "~35% over-attribution" story is baked in, not measured); cohort retention is `Math.pow()` on invented constants. Real versions need a ground-truth feed (GA4/Shopify/CRM) + identity resolution — Windsor ad connectors cannot produce this. | `mock-data/attribution.ts` |
| 6 | **The creatives feature is 100% fabricated.** Copy invented from an industry-keyed catalog, tiers assigned by array index, metrics from `randomBetween`, `placehold.co` thumbnails. No adapter, no ingestion path, and campaign-grain pulls can't feed it — it needs ad-level data. | `mock-data/creatives.ts`, `ad_creatives` table |
| 7 | **`campaign_budgets` models a concept no platform has** ("monthly budget per campaign"). Google: *daily* budgets, shareable across campaigns; Meta: daily/lifetime at campaign (CBO) *or* ad-set (ABO) level; TikTok: daily/lifetime at campaign/ad-group. Seed even reverse-engineers budgets from observed spend, guaranteeing flattering pacing. The pacing feature needs redesign, not a new feed. | `schema.ts:60-69`, `queries.ts:459-561` |

### 🟧 Silently wrong

| # | Finding | Where |
|---|---|---|
| 8 | **Adapters store platform-reported CTR ×100**, assuming the upstream value is a 0–1 fraction. True for our mock generators; NOT verified for Windsor (Meta's API `ctr` is already percent-scaled). Risk of 100× errors. Stored `ctr/cpc/cpm` are also effectively write-only — aggregations recompute (correctly), so two code paths can show two different numbers. | all 3 adapters, `schema.ts:46-48` |
| 9 | **No timezone concept.** Each account reports in its own immutable timezone (all 3 platforms); `date` is stored verbatim and compared cross-platform; pacing/chat use server wall-clock "today". Cross-platform "Jul 1" can be two different 24h spans. | `schema.ts:40`, `queries.ts:479`, `chat/route.ts:488` |
| 10 | **`revenue` can't distinguish "zero" from "not tracked".** NOT NULL default 0 → lead-gen accounts show ROAS 0× instead of "no value tracking". | `schema.ts:45` |
| 11 | **Optimizer's `roas` is not ROAS** — it's `conversions/spend*100` (conversions per 100 currency units), labeled and surfaced as ROAS. Will actively contradict the real ROAS elsewhere once real revenue exists. | `optimizer.ts:115` |
| 12 | **Conversion dating differs per platform and nothing models it.** Meta files conversions under interaction date (default "mixed" report time); TikTok files under click/impression day; Google's `conversions` is interaction-dated with a separate `conversions_by_conversion_date` variant. Recent-day conversion counts are structurally understated (lag), and the funnel's day-level conversion rate is biased low for recent dates. | funnel/`queries.ts:383-435` |
| 13 | **Anomaly detection & health scores are tuned to mock noise.** Fixed z-thresholds with no day-of-week seasonality (the mock generator *injects* weekday multipliers, real data has stronger ones); health-score curves/weights are arbitrary. Expect Monday false-positives and mis-calibrated grades on real volatility. | `queries.ts:249-326`, `health-score.ts` |

### 🟨 Design/extensibility debt

| # | Finding | Where |
|---|---|---|
| 14 | **Status/objective enums must be open.** Meta `effective_status` has 10+ values and grows; legacy objectives still appear on read; TikTok is mid-migration merging objectives. DB `CHECK` constraints on these = ingestion breakage. (Our own `platform` check is fine.) `ad_creatives.status='fatigued'` is not a platform status — fatigue is a *derived* label. | `schema.ts` checks |
| 15 | **"Clicks" and "CTR" are not one thing.** Meta: `clicks` (all) vs `inline_link_clicks` vs `outbound_clicks` — materially different CTRs. Google: `interactions` ⊃ clicks; video uses view-rate, not CTR. TikTok CPM is per-1000-*reached*. Unified columns need a documented definition per platform. | adapters |
| 16 | **No account entity.** `clients` maps 1:1 to nothing real — a client has *multiple ad accounts* (one per platform, sometimes several), and account is where currency/timezone/auth live. The Windsor account→client mapping has no home. | `schema.ts:25-30` |
| 17 | **`alert_rules.metric` CHECK locks the demo's six metrics** (no revenue/ROAS), and "conversions above X" inherits the which-conversion ambiguity. | `schema.ts:174` |
| 18 | **`raw_payload` is write-only and shipped to the frontend/LLM.** Nothing reads it back, but `getMetrics` selects it into API responses and chat tool results — with real Windsor payloads (nested arrays) this bloats responses and token costs. Raw belongs in a landing table, not the serving projection. | `queries.ts:95` |
| 19 | **Campaign grain is the only grain**, and campaign metadata (name/status/objective/type) has no dimension table — names are denormalized per fact row and can change over time (needs SCD-lite handling). PMax has *no ad-group level at all*; channel-level PMax splits only exist for dates ≥ 2025-06-01. | schema-wide |

## 3. Platform semantics cheat-sheet (what the unified layer must respect)

| Semantic | Meta | Google | TikTok |
|---|---|---|---|
| Conversion definition | `actions[]` keyed by open `action_type` taxonomy; account's Ads-Manager attribution setting is **forced** since Jun 2025 (`use_unified_attribution_setting`/`action_report_time` ignored); window sub-keys (`1d_click`,`7d_click`…) are the only fixed-window readings; `7d_view`/`28d_view` dead since Jan 2026 | Per-account **conversion actions**, primary vs secondary; `conversions` (primary, **fractional** under DDA) vs `all_conversions` vs `conversions_by_conversion_date`; DDA or last-click only | Ad-group **optimization event** = "conversion"; `result` is the objective-labeled twin; per-ad-group windows (CTA 7d default, VTA 1d, EVTA) |
| Conversion dating | Interaction date (mixed) | Interaction date (`conversions`); conversion date variant exists | Interaction (click/impression) date |
| Restatement window | ≤28d (72h typical processing lag) | conversion-window-length (30–90d common); Google says trust data ≥30d old | 3–7d practical (SKAN: up to 35d for iOS apps) |
| Currency/timezone | Per account, immutable | Per account, immutable (`cost_micros` ÷1e6) | Per account, immutable |
| Grain | account/campaign/adset/ad, same fields each level | campaign/ad_group/ad… but **PMax has no ad-group**; channel splits only ≥2025-06-01 | advertiser/campaign/adgroup/ad × day/hour |
| Clicks/CTR nuance | clicks(all) vs link vs outbound | `interactions` ⊃ clicks; video → view-rate | CPM is per-1000-reached |

**Windsor-specific unknowns to verify empirically against our live key** (docs are JS-rendered/ambiguous):
1. Is Windsor's Google `conversions` = Google `conversions` (primary/bidding) or `all_conversions`? — compare against Ads UI once Google is connected.
2. CTR units per connector (fraction vs percent) — the ×100 in our adapters is unverified.
3. Which Meta fields arrive flattened as scalars (e.g. `action_values_purchase`) vs raw arrays — depends on requested `fields=`.
4. Whether any connector exposes account **timezone** per row (likely not — open Windsor feature request); currency (`account_currency`/`currency_code`) is exposed.
5. Exact TikTok conversion/revenue field names.

## 4. Target design (ground-up, mapped onto what we keep)

### 4.1 New entities

- **`ad_accounts`** — the missing anchor: `client_id`, `platform`, external `account_id`,
  `account_name`, `currency` (immutable), `timezone` (immutable, entered manually if Windsor can't
  supply it), `status`, `connected_at`. Windsor account → client mapping lives here; currency/
  timezone are account facts, not row facts.
- **`raw_windsor_rows`** (landing layer) — verbatim Windsor response rows: `ad_account_id`,
  `platform`, `entity_ids` (campaign/adgroup/ad), `date`, `payload` JSONB, `pulled_at`. Unique on
  the natural key, upsert-latest. Source of truth; normalization is a versioned pure function of
  this table (re-map ≠ re-pull).
- **`conversion_mappings`** — per ad_account (with per-client defaults): ordered rules mapping
  platform event identifiers (`action_type` patterns / Google conversion actions / TikTok
  optimization events) → unified `conversions` and `revenue`, plus the window preference for Meta
  (`value` vs `7d_click` etc.). Editable in a settings UI later; sensible default = the account's
  primary purchase/lead event.
- **`campaigns` dimension (SCD-lite)** — `ad_account_id`, platform `campaign_id`, latest `name`,
  `objective` (free text), `status` (free text), `campaign_type` (Search/PMax/Video/…),
  `first_seen`/`last_seen`. Fact rows keep the denormalized name for as-of-date display.

### 4.2 `campaign_performance` v2 (serving layer)

- Add `ad_account_id` FK; **unique index `(ad_account_id, campaign_id, date)`** — the upsert
  conflict target. (Keep `client_id` denormalized for query paths.)
- `conversions` → `numeric` (fractional). Add nullable `conversions_secondary` only if we decide we
  need an all-conversions view; detail stays in raw.
- `revenue` → **nullable** (`NULL` = value tracking not configured ≠ 0).
- Add `currency` (denorm from account), `link_clicks` (nullable; Meta/TikTok), `transform_version`,
  `synced_at`.
- **Drop stored `ctr`/`cpc`/`cpm`** from the serving contract — always recompute from base counts
  (§5.5 of the ingestion doc). Platform-reported ratios remain available in raw.
- `date` = platform-native stat date, interaction-dated (consistent across all three platforms'
  defaults); document the lag bias, and exclude/flag the trailing ~3 days in trend UIs.
- Keep the `platform` CHECK (ours, cheap to alter); **no CHECKs on any platform-sourced enum**
  (status/objective/type are free text).

### 4.3 Feature triage

| Feature | Disposition |
|---|---|
| Dashboard/metrics/compare/reports/chat | Work as-is once v2 facts flow; audit currency formatting (symbol from account currency). |
| **Attribution & LTV views** | **Demo-only until a ground-truth source exists.** Gate behind `clients.is_demo`. Standard Windsor plan allows more sources — GA4/Shopify as the ground-truth feed is the real path later. Do not fake it from ad-platform data. |
| **Creatives** | Demo-only until we pull **ad-level** grain from Windsor; then rebuild: real ad rows + *derived* fatigue label (real statuses are ENABLED/PAUSED/…, `fatigued` is ours). |
| **Pacing** | Redesign: budgets become **agency-entered monthly targets per client (×platform)** — an honest agency concept — rather than fake per-campaign platform budgets. Optionally sync real daily/lifetime budgets later for a "platform budget" readout. |
| Optimizer | Fix the fake `roas` (use real revenue, label CPA-based ranking honestly). Recommendations stay heuristic — fine, but tone down "projected" claims. |
| Anomalies/health | Keep, but retune after ~4 weeks of real data; add day-of-week baseline to z-scores. |
| Alerts | Widen metric list (revenue/ROAS), and alerts on "conversions" reference the mapped definition. |
| Funnel | Short-term: keep 3 stages, flag conversion-lag bias. Later: platform-aware stages from Meta's action array (LPV → ATC → checkout → purchase). |

## 5. Migration path

- **Phase 0 — schema corrections (before any ingestion code):** `ad_accounts`,
  `raw_windsor_rows`, `conversion_mappings`, `campaigns` dim; `campaign_performance` v2 alterations
  + unique keys; `clients.is_demo`; alert-metric widening. One migration (`0005`), plus
  `schema.ts`/`database.ts` mirrors. **✅ Done 2026-07-13** (`drizzle/0005_ingestion_foundation.sql`,
  applied + verified against the live DB).
- **Phase 1 — Meta vertical slice:** Windsor client → land raw → normalize (mapping-driven) →
  upsert; `POST /api/sync` (agency-admin), rolling 28-day re-pull; map the 4 live accounts to real
  client rows; verify dashboard end-to-end. Includes the **empirical Windsor probes** (§3 unknowns).
  **✅ Done 2026-07-13** — `src/lib/windsor/{client,meta,sync}.ts` + `POST /api/sync`; demo-gating
  live (attribution/creatives hidden for real clients). Probe results: Meta `ctr` is a **fraction**;
  `account_id`/`campaign_id`/`campaign_status`/`objective`/`link_clicks` all available;
  `conversions[]` = configured events, `actions[]` = full array (purchase family often only in
  `actions`). First sync: 4 accounts → 4 real clients, 1,586 facts over 90d, revenue reconciled
  exactly against an independent probe; re-run is idempotent (0 duplicate keys). Default mappings
  seeded: `omni_purchase` (conversions+revenue) for ONYX + both Skyviews; **GLOBIS Thailand has no
  conversion tracking at all** (conversions 0, revenue NULL) **and bills in JPY** — first real
  multi-currency client (JPY + THB), which makes Phase 3's currency-aware display non-optional.
- **Phase 2 — Google + TikTok** when connected; verify Windsor's Google `conversions` semantics
  against the Ads UI before trusting; 90-day initial backfill, 7-day rolling re-pull (TikTok),
  30-day (Google).
- **Phase 3 — feature retrofits:** pacing redesign, currency-aware formatting, optimizer/health
  retuning, funnel v2, creatives on ad-level grain, conversion-mapping settings UI.

## 6. Decisions (confirmed by Ivan, 2026-07-13)

1. **Demo gating:** ✅ decided — attribution/LTV/creatives will be gated behind `is_demo` clients
   (features stay for sales demos, hidden for real clients). The flag exists as of Phase 0; the UI
   gating itself lands with Phase 1.
2. **Pacing model:** ✅ agency-entered monthly budget per client×platform (Phase 3 redesign).
3. **Ground truth:** ✅ GA4/Shopify as an additional Windsor source for real attribution — later
   phase, not the pilot.
4. **Unified `conversions` default:** ✅ primary purchase/lead event per account via the
   `conversion_mappings` table, with per-account overrides.
