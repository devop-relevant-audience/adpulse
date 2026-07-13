# AdPulse — Ad Data Ingestion & Normalization (Handoff)

> **Purpose:** Bring any engineer or AI agent up to speed on the plan for ingesting ad data
> into AdPulse and normalizing it into one schema. This is the current state of thinking,
> what has been decided, what has been tested against the live Windsor API, and what to do next.
>
> **Status:** Discovery / design phase — no ingestion code written yet.
> **Branch:** `connectors`
> **Last updated:** 2026-07-13
> **Context:** Relevant Audience (performance marketing agency) manages clients' ad accounts;
> a senior dev owns this workstream.

---

## 1. Goal

Ingest performance data from **Google Ads, Meta (Facebook/Instagram) Ads, and TikTok Ads** —
three APIs with three schemas — and **normalize it into one unified schema** so the dashboard,
analytics (attribution, optimizer, health scores), and AI chat all work against a single model.

**Key framing:** the unified schema is the *easy ~20%*. The hard ~80% is the **semantics** of
the mapping (which action = a conversion, attribution windows, currency, timezones) — see §5.
No tool removes that work.

---

## 2. Decision summary (read this first)

| Decision | Outcome |
|---|---|
| **Ingestion approach** | **Buy ingestion, own normalization.** Use **Windsor.ai** as the data source (managed connectors, agency-friendly, no platform App Review needed). |
| **Why not build/raw** | Building raw connectors means owning OAuth, App Review/dev-token approvals, and permanent API-churn maintenance (Meta versions ~quarterly). Windsor absorbs all of that. |
| **What Windsor does NOT solve** | The **semantic** normalization (conversion mapping, attribution windows, dedup, currency) — that stays ours. Windsor only gives **structural** normalization (consistent field names/units). |
| **Auth model** | Agency holds manager-level access (Google MCC / Meta Business Manager / TikTok Business Center) → **authenticate once per platform, all client accounts selectable.** Not per-client OAuth. |
| **API key** | Provided by agency, stored in `.env.local` as `WINDSOR_API_KEY`. **Tested working** (see §7). |
| **Plan tier** | Pilot: **Basic ($19)** or **Standard ($99)** — decided by whether the attribution/ground-truth story is in-scope for the pilot (needs a 4th data source). Full 50 clients → **Plus ($249)** floor. |
| **Architecture** | Raw → Normalize → Serve, with normalization as a *re-runnable pure function* of raw data (§4). |

---

## 3. Where AdPulse already is

AdPulse already implements the normalized-schema pattern for **mock/seed data**:

- **Unified table:** `campaign_performance` — columns: `client_id`, `platform`, `campaign_id`,
  `campaign_name`, `date`, `impressions`, `clicks`, `spend`, `conversions`, `revenue`, `ctr`,
  `cpc`, `cpm`, `raw_payload`.
- **Adapters:** `src/lib/adapters/{google,meta,tiktok}-adapter.ts` map each platform's row shape
  into `CampaignPerformanceInsert`.
- **`raw_payload`** is already stored per row.

**Two instincts already right:** (1) one unified table with a `platform` discriminator, and
(2) keeping the raw payload.

**The gap:** the current adapters treat normalization as **field-renaming** (`costMicros/1e6`,
`ctr*100`, hard-coded `"purchase"` for Meta). That is fine for mock data but insufficient for
real APIs — real normalization is a business-logic problem (§5). The adapters will need to be
rebuilt against real Windsor data.

---

## 4. Target architecture

Three hard-separated layers:

```
Extract (Windsor) → Land (raw) → Normalize (derived) → Serve
```

1. **Raw / landing layer** — store Windsor responses close to verbatim, keyed by
   `(client_id, platform, entity_id, date)`. Never discard a field. This is the source of truth.
2. **Normalized layer** — the unified `campaign_performance` table, **computed** from the raw
   layer by *versioned* transform code, never written to directly. Core comparable metrics only;
   platform-specific detail stays in raw / a JSON side-column.
3. **Serving layer** — what the dashboard/queries read; add pre-aggregated rollups as volume grows.

**Key property:** if normalization is a *pure function* of the raw layer, every mapping mistake
is a **re-run, not data loss**. This is the most important architectural rule.

**Build order:** Meta first (hardest conversion model — see §7.4), then Google + TikTok, letting
each challenge the schema. Backfill/historical load is a separate concern from incremental sync.

---

## 5. The hard problems (the normalization work that is ours)

These drive the design of the normalize layer. Windsor does not solve them.

### 5.1 Conversions are a per-client business decision, not a field
Meta returns an `actions[]` array keyed by `action_type` (`purchase`, `lead`, `add_to_cart`,
custom pixel events…). Google has configured **conversion actions**; TikTok has multiple
conversion columns. **Which event(s) count as "a conversion" is per-client config, not a
constant.** Hard-coding `"purchase"` (as the current adapter does) is wrong for clients whose
goal is leads/bookings/installs.

**Recommended handling — discover-then-map:**
1. **Discovery:** list available conversion actions/events per account (from the feed).
2. **Per-client mapping config:** a small table — "unified `conversions` = Meta `X` + Google `Y`
   + TikTok `Z`", with a sensible default, editable in a settings UI.
3. **Normalize using the map**, while raw keeps *all* action types so you can re-map without
   re-pulling.

> **Confirmed live (§7.4):** Windsor returns Meta's raw `actions[]` array unflattened, so this
> mapping problem is real on day one.

### 5.2 Attribution windows & timezones make numbers non-comparable
**Attribution window** = the span after an ad interaction in which a later conversion is still
credited. Defaults differ per platform.

**Worked example:** user clicks a Meta ad (Jul 1), clicks a Google ad (Jul 1), buys $100 on Jul 8.
- Meta (7-day click): 1 conv, $100, **dated Jul 1** (interaction date, not purchase date).
- Google (credits the Jul 1 click): also 1 conv, $100.
- Naive cross-platform SUM → **2 conversions, $200 from a single $100 sale.** Both platforms
  claim it. This is the classic over-attribution (the "~35%" story already in AdPulse seed data).

**Timezone:** a Meta account in `America/Los_Angeles` and Google in UTC file an 11pm-PT-Jul-1
conversion under different days. Cross-platform "Jul 1" mixes two different 24h spans.

**Rule:** store the **window** and **account timezone** as first-class data, normalize dates to
one timezone, and never present a naive cross-platform SUM as truth without flagging it.

> **Confirmed live (§7.4):** each Meta conversion entry carries window breakdowns
> (`1d_view`, `7d_click`).

### 5.3 Late-arriving data / restatements
Platforms revise the trailing ~7–28 days as conversions attribute retroactively. Incremental
sync must be **upsert on `(client_id, platform, entity_id, date)` with a rolling re-pull window** —
never append-only.

### 5.4 Grain (level of detail)
Hierarchy: `Account → Campaign → Ad set/Ad group → Ad/Creative`, plus a time grain (day/hour).
Current unified grain is **campaign × day**. **Capture the finest grain you can afford in raw;
serve at the grain the UI needs.** Widening grain later = painful re-pull; narrowing = trivial.
AdPulse has a **creatives view**, which argues for capturing ad/creative grain in raw.

### 5.5 Reported vs derived metrics
Platform-reported CTR/CPC/CPM/ROAS can disagree with your own `clicks/impressions`. **Store base
counts always; recompute ratios yourself; treat platform-reported ratios as raw-only.**

### 5.6 Currency
Spend arrives in the **account's** currency (not guaranteed USD). Cannot add €100 + $100 — to
total/compare across clients, convert to one **reporting currency** with an FX rate (historical
per-date rate for accurate trends). **Store native spend + currency code + FX rate used; derive
the reporting-currency value.**

> **Confirmed live (§7.4):** trial accounts report in **THB**.

### 5.7 Auth / token lifecycle (mostly handled by Windsor + the agency model)
Windsor stores and refreshes OAuth tokens; the agency model (§6) means one authorization per
platform covers all managed clients. The only residual work: a "reconnect" path for when an
agency-side authorization breaks (password change, revocation, authorizing user leaves). Prefer
a **Meta System User** token where supported (long-lived, survives staff departure).

---

## 6. Windsor.ai — what a handoff needs to know

### 6.1 Plans & the real constraint (accounts, not rows)

| Plan | Price (annual) | **Accounts** | Sources | MAR | Notes |
|---|---|---|---|---|---|
| Basic | $19/mo | 75 | 3 | 5M | daily only |
| Standard | $99/mo | 75 | 7 | 7.5M | daily/hourly |
| Plus | $249/mo | 200 | 10 | 10M | |
| Professional | $499/mo | 500 | 14 | 50M | **auto-add accounts** (agency) |

An **"account" = one individual ad account** (Windsor's example: 25 Google + 25 Facebook +
25 Bing = 75). So **1 client = Google + Meta + TikTok = 3 accounts**; 75 accounts ≈ **25 clients**.

- **Pilot (a handful of clients):** Basic fits (3 sources = exactly the 3 ad platforms).
- **Basic's real ceiling = 3 data sources (zero headroom).** A **4th source** (GA4 / Shopify /
  CRM as the *ground-truth* feed for blended-vs-reported attribution) forces **Standard ($99)**.
  → **The Basic-vs-Standard call = is the attribution story in the pilot or later?**
- **Full 50 clients (150 accounts):** **Plus ($249)** is the floor, regardless of row volume.

### 6.2 Agency manager-account model (verified against Windsor docs)
- **Google Ads (MCC): confirmed.** Authorize once with the MCC user (read-only+ access enough);
  all accessible accounts appear, select one/many/all. Child accounts must be linked under the MCC.
- **Meta: multi-account confirmed**, but **unverified**: (a) Business Manager **system-user
  token** support, (b) exact partner-access scoping. Verify with support (§6.3).
- **TikTok: likely works via Business Center but unverified** — no doc confirmation.

### 6.3 Message to Windsor support (still open — send this)
> 1. Google MCC: authorize once → all linked client accounts selectable, read-only sufficient — correct?
> 2. Meta: can we connect via a **Business Manager system-user token** (survive password change /
>    staff leaving)? Does BM partner access auto-expose a client's account after one auth?
> 3. TikTok: does connecting a user with **Business Center** access expose all assigned client
>    ad accounts to select (one auth covers all)?
> 4. **Plan question:** do manager-level connections (Google MCC / Meta BM / TikTok BC) and
>    "auto-add accounts" work on **Standard ($99)**, or are they gated to **Professional ($499)**?

---

## 7. Windsor API — live test results (2026-07-13)

Tested with the agency-provided key (`WINDSOR_API_KEY` in `.env.local`, 36 chars,
identity `info@relevantaudience.com`). Key is **valid and returning real data**.

### 7.1 API format (working)
```
https://connectors.windsor.ai/{connector}?fields=date,account_name,spend,clicks&date_preset=last_7d&api_key=***
```
- `{connector}` = `facebook`, `google_ads`, `tiktok`, or **`all`** (blended across connected sources).
- `date_preset` = `last_3d|7d|14d|28d|30d|90d`, or `date_from` + `date_to`.
- Include `date` in `fields` → daily rows; omit → aggregated per account.

### 7.2 What's connected

| Source | Status | Accounts |
|---|---|---|
| **Facebook/Meta** | ✅ Connected | GLOBIS Thailand, ONYX Rewards, Skyview Hotel Bangkok, Skyview Patong |
| **Google Ads** | ❌ Not connected | connect at `onboard.windsor.ai?datasource=google_ads` |
| **TikTok** | ❌ Not connected | connect at `onboard.windsor.ai?datasource=tiktok` |

30-day Meta spend across the 4 accounts ≈ **517,700 THB**.

### 7.3 Valid Meta field names (probed)
- Valid: `date, account_name, campaign, currency, spend, impressions, clicks, conversions,
  conversion_values, purchase_roas, website_purchase_roas, action_values, conversions_value`.
- **Invalid:** `total_conversion_value`, `purchase_conversion_value`, `total_conversions`, `revenue`.

### 7.4 Critical finding — the semantic problem is real on day one
`conversions` is **NOT a number** — Windsor passes Meta's raw `actions[]` through unflattened:

```json
"conversions": [
  {"action_type": "subscribe_website",                        "value": "1", "7d_click": "1"},
  {"action_type": "offsite_conversion.fb_pixel_custom.AddToCart_BKK",       "value": "1", "7d_click": "1"},
  {"action_type": "offsite_conversion.fb_pixel_custom.InitiateCheckout_BKK","value": "1", "7d_click": "1"},
  {"action_type": "offsite_conversion.fb_pixel_custom.start_booking",       "value": "3", "1d_view": "1", "7d_click": "2"}
]
```

This one sample confirms, on real data:
- **§5.1:** a single row has 7 different `action_type`s → we must **choose** which count as "a
  conversion." No `conversions=5` field exists.
- **§5.2:** attribution windows are embedded per entry (`1d_view`, `7d_click`).
- `conversion_values` is the same nested shape (keyed by action type; `None` on most rows).
- `purchase_roas` is `null` here (traffic/custom-event campaigns) → "which metric matters" is
  per-campaign/client.
- **§5.6:** `currency = THB`.

**Implication for the build:** the normalize layer must collapse `conversions[]` →
"the client's chosen conversion metric on a chosen window," driven by the per-client mapping
config (§5.1). Store the full array in raw so re-mapping never needs a re-pull.

### 7.5 Usage / quota
Not exposed via the data API (no usage endpoint or rate-limit headers). **MAR usage is only in
the Windsor dashboard UI (billing/usage).**

---

## 8. Open questions / to verify

- [ ] Send the Windsor support message (§6.3) — esp. **Meta system-user** support and whether
      **manager-account connections are gated to Professional**.
- [ ] Confirm how Windsor counts an "account" for **MCC/BM with sub-accounts** (children counted
      individually? Only the Google My Business "10 = 1 account" exception is documented).
- [ ] Connect **Google Ads** and **TikTok** to the Windsor key (currently Meta-only) to test the
      real three-platform blend.
- [ ] Decide the **conversion-mapping** model against the real `actions[]` shape.
- [ ] Decide **grain** (campaign/day for unified; capture ad/creative in raw?).
- [ ] Decide **currency** handling (native + code + FX; reporting currency).
- [ ] Decide the **plan tier** (Basic vs Standard — attribution story in the pilot?).

---

## 9. Next steps (proposed)

1. **Draft the v2 normalized schema + transform contract** against the real Windsor fields (§7.3),
   including how to collapse `conversions[]` → a chosen metric + window.
2. **Design the per-client conversion-mapping config** (table + defaults + settings UI).
3. **Prototype the ingestion job:** Windsor pull → land raw (`raw_payload`) → normalize → upsert
   `campaign_performance` on `(client_id, platform, campaign_id, date)` with a rolling re-pull window.
4. Get **Google + TikTok** connected in Windsor and validate the three-platform blend.
5. Send the Windsor support questions (§6.3) and finalize the plan tier.

---

### Appendix — reference URLs
- Windsor pricing: https://windsor.ai/pricing/
- Windsor pricing docs (account definition): https://windsor.ai/documentation/pricing-information/
- Windsor API docs: https://windsor.ai/api-documentation/
- Google Ads setup (MCC): https://windsor.ai/documentation/connector-setup-guides/google-ads-installation/
- Meta setup: https://windsor.ai/documentation/connector-setup-guides/facebook-meta-ads-connector-installation/
- Meta field reference: https://windsor.ai/data-field/facebook/
- Onboard new sources: https://onboard.windsor.ai
