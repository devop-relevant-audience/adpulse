# Dashboard UX Recommendations

Date: 2026-08-31. Source: competitive research across Looker Studio, Tableau, Power BI, Amplitude, Mixpanel, PostHog, AgencyAnalytics, Whatagraph, DashThis, Swydo, Supermetrics, Metabase, Grafana, Databox, Geckoboard, Google Ads, Meta Ads Manager, and GA4 — checked against the current AdPulse dashboard code.

Confidence = how sure we are the change is needed (how strongly the market converges on the pattern). Difficulty = code effort in this codebase. Sorted best first.

## What we already do right (keep as is)

- **F1** Explicit edit mode with Save/Cancel, grid drag and resize. Same model as Metabase, Grafana, and every agency tool.
- **F2** Two-tier filters (page filter, widget can override it) with a "following the page filter" hint. Same model as PostHog and Grafana.
- **F3** The linked saved-widget library with "update everywhere / create a copy". Only Grafana, Metabase, and PostHog have this. None of the agency tools do. Ahead of the market.
- **F4** Templates as stamp-once copies. Matches Looker Studio, Tableau, and Power BI. Swydo/Whatagraph use live-linked templates instead, but the saved-widget links already cover the "agreed metric stays synced" case, so no change needed.
- **F5** KPI cards already show the change vs the previous period and already flip the green/red color for "lower is better" metrics like CPA. That polarity handling is a documented GA4 feature we already have.
- **F6** Catalog organized by what the widget shows, not by ad platform. Matches how all five agency tools organize theirs.

## Recommended changes

| Code | Change | Difficulty | Confidence |
|---|---|---|---|
| A1 | "Compare" toggle in the date picker (previous period / previous year) | 5 | 9 |
| A2 | More date presets + a real calendar range picker | 3 | 9 |
| A3 | Duplicate-widget button in edit mode | 1 | 9 |
| A4 | Per-widget menu in view mode: expand full-screen, download CSV | 4 | 8 |
| A5 | Click column headers to sort tables in view mode | 2 | 8 |
| A6 | Fix "Last N days" preset math (off-by-one, includes today) | 1 | 8 |
| A7 | Day/week/month switch on the trend chart | 3 | 7 |
| A8 | Multi-select platform filter + page-level campaign filter | 5 | 7 |
| A9 | Per-widget date range override | 4 | 7 |
| A10 | Search box in the widget catalog | 2 | 6 |
| A11 | Sparkline inside KPI cards | 3 | 6 |
| A12 | Section heading widget | 2 | 6 |
| A13 | Goal/target widget (value vs a target, pacing bar or gauge) | 5 | 6 |
| A14 | Column picker for the campaign table | 3 | 6 |
| A15 | Put the selected view in the URL | 2 | 6 |
| A16 | Live preview in every config dialog, not just the custom builder | 2 | 5 |
| A17 | Scheduled email delivery of reports | 7 | 6 |
| A18 | Chart annotations (notes pinned to dates) | 6 | 5 |
| A19 | Click a chart segment to filter the page (cross-filtering) | 7 | 4 |
| A20 | TV / presentation mode | 3 | 3 |
| A21 | Anomaly callouts ("this metric jumped, here's why") | 8 | 4 |

## Details

**A1 — Compare toggle.** Google Ads, Meta, and GA4 all put a single "Compare: previous period / previous year" switch inside the date picker, and marketers expect it. When on: KPI cards keep their delta (they already fetch it), the trend chart draws a second line for the prior period, and tables gain change columns (the native-platform convention is four columns: current, previous, change, % change). Our metrics API already has a compare action, so the work is the picker UI, one store/URL field, and the chart overlay. Highest-value single change on the list.

**A2 — Date presets and calendar.** We're missing the presets every ad platform leads with: Today, Yesterday, This week, Last week, Last 28 days (Google's default), Year to date. The presets are a pure data change (`src/lib/dashboard/date-presets.ts`). The custom range should also become one calendar popover instead of two bare date inputs.

**A3 — Duplicate widget.** Every platform reviewed has it. One store action that clones the widget instance and its layout entry. Cheapest win on the list.

**A4 — View-mode widget menu.** Today widgets are completely inert outside edit mode. The universal pattern (Grafana, Power BI, Looker Studio, Metabase) is a small "…" menu per widget: expand to full screen and download the data as CSV. Expand can reuse the dialog shell the config preview already uses.

**A5 — Table sorting.** Viewers expect to click a header to re-sort in every tool reviewed (campaign table + custom table widget). Local state only, no API change.

**A6 — Preset math.** Our "Last 7 days" spans 8 days and includes today's partial data. Google Ads and GA4 end "last N days" on yesterday. One decision to make (D1): end presets on yesterday, or keep today and accept the partial-day dip at the end of charts.

**A7 — Granularity switch.** A small day/week/month control on the trend chart is standard in Google Ads, Meta, and GA4. The custom widget already buckets by day/week, so the vocabulary mostly exists (month is missing).

**A8 — Richer page filters.** Our platform selector is single-choice and there is no page-level campaign filter, while widget filters already support both as lists and the API already accepts them (`platforms`/`campaignIds` comma lists). This is UI plus store/URL plumbing, but it touches every hook that reads the page scope, hence the 5.

**A9 — Per-widget date override.** A named feature in AgencyAnalytics, Grafana, and PostHog: a widget can pin its own range (for example a month-to-date KPI on a 30-day dashboard). Fits the existing widget-filters shape; needs the badge, the filter form, and the Zod schema updated.

**A10 — Catalog search.** Amplitude/Mixpanel-style search input over the widget catalog and saved-widget library. Small quality-of-life win as the catalog grows.

**A11 — KPI sparklines.** GA4's scorecard convention is value + sparkline + colored delta arrow. We have value + delta; adding a small trend line inside the card means one extra daily-trend fetch per KPI.

**A12 — Section heading widget.** Metabase ships heading cards distinct from text cards. We only have the markdown note widget. A lightweight full-width heading/divider widget makes long dashboards scannable. New widget type, trivial render.

**A13 — Goal/target widget.** The one widget type all four agency competitors have and we lack: a metric vs a target, drawn as a pacing bar (AgencyAnalytics) or a gauge with red/orange/green zones (DashThis, Swydo, Databox). Storing the target in the widget config keeps it schema-free.

**A14 — Campaign table column picker.** Column customization with saved presets is universal in Google Ads and Meta. The campaign table currently has fixed columns; let the config pick from the existing metric vocabulary like the custom table already does.

**A15 — View in the URL.** Date and platform are already URL-synced; the selected dashboard view is not. Adding a `?view=` param makes a specific view deep-linkable/shareable, matching Metabase/Grafana URL-state behavior.

**A16 — Preview everywhere.** The custom-widget builder has a live preview; the small config dialogs (KPI, trend, table) don't. The preview card component already exists and can be reused.

**A17 — Scheduled email.** Every agency competitor sends recurring branded report emails (the delivery trio is share link + PDF + scheduled email). Our schedules table and route already exist, but this needs the production deploy, a cron, and an email provider — the Windsor workstream already deferred that. Right to do, wrong to do now.

**A18 — Annotations.** First-class in Amplitude, Mixpanel, and PostHog: notes pinned to dates on the chart axis ("campaign launched", "budget doubled"). Valuable for agency storytelling but needs storage plus marker rendering on every time-series widget.

**A19 — Cross-filtering.** Clicking a platform bar to filter the whole page is standard in the big BI tools (opt-in per chart) but a heavy build with real edge cases. Nice-to-have.

**A20 — TV / presentation mode.** Amplitude, Mixpanel, Databox, Geckoboard have wall-display modes with auto-refresh. Cheap (fullscreen route hiding the chrome) but no one has asked for it.

**A21 — Anomaly callouts.** Google Ads "Explanations" attaches a root-cause blurb to the exact metric that moved — the most distinctive pattern found, and a natural fit with our AI chat, but the biggest build on the list.

## Bottom line

A1–A7 are the batch worth building first (one date-picker overhaul plus five small view-mode upgrades). They close the most visible gap between AdPulse and the tools that trained our users: everything on our dashboard is read-only and comparison-blind outside edit mode. Only D1 (whether "last 7 days" should include today) needs a decision before starting.
