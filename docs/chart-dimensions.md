# Chart dimensions

A dashboard chart answers "this metric, split this way, over this period". The
splits it can offer are bounded by what the fact table stores, and what the fact
table stores is bounded by what the Windsor.ai sync asks for. This file records
where that boundary sits today, what recently landed, and what is genuinely
blocked behind ingestion work.

Scope: the `custom` widget and the query behind it. Contract in
`src/lib/dashboard/custom-widget.ts`, aggregation in
`src/lib/data/metric-query.ts`, served by `GET /api/metrics?action=query`.

## What a chart can do today

| Axis | Values |
| --- | --- |
| Metrics | `spend`, `impressions`, `clicks`, `conversions`, `revenue`, `ctr`, `cpc`, `cpm`, `cpa`, `roas` |
| Split (`groupBy`) | `none`, `platform`, `campaign`, `adAccount`, `campaignType` |
| Time bucket | `none`, `day`, `week` (week starts Monday) |
| Period | the page date range, or a per-widget `config.filters.dateRange` override |
| Pre-filters | `platforms`, `campaignIds` (`config.filters`, or the page selector) |
| Top-N | rank groups by any metric, asc/desc, 1..50 (default 10) |
| Group threshold | keep only groups whose whole-range metric is over/under a value (grouped charts only) |
| Visualizations | number, line, area, bar, combo, pie, donut, table, pivot |
| Comparison series | the compare window drawn as a second dashed line (ungrouped line, area, combo) |

How the numbers are produced matters for everything below. `aggregate()` sums
only the five base columns in SQL — impressions, clicks, spend, conversions,
revenue — grouped by the chosen dimension expression and time bucket. CTR, CPC,
CPM, CPA and ROAS are then derived in TypeScript from those sums (`toRow`), so
they are weighted, never averaged, and **they do not exist as columns anywhere**.
Revenue stays NULL when no row in the bucket has revenue, which makes ROAS null
rather than zero.

Every query reads facts from one table, `adpulse.campaign_performance`. The two
derived splits LEFT JOIN one label table each (`ad_accounts`, `campaigns`) and
add no rows.

## Splits and filters that shipped

All four are in the code. None of them touched ingestion; the data was already
stored.

| Item | Where the data comes from |
| --- | --- |
| Split by ad account | `campaign_performance.ad_account_id`, label from `adpulse.ad_accounts.account_name` (LEFT JOIN) |
| Split by campaign type / objective | `adpulse.campaigns` (`objective`, `campaign_type`), LEFT JOIN on `(ad_account_id, campaign_id)` |
| Metric threshold on grouped charts | derived after aggregation, in `runMetricQuery` |
| Comparison series | a second `useMetricQuery` over the compare window (`getCompareRange`) |

What the implementations settled on, and what a reader has to know to trust a
chart:

- **The comparison series is offered on ungrouped line, area and combo only.**
  One earlier window laid over many group series is unreadable, so
  `VISUALIZATION_OPTIONS` lists `compareSeries` on those three types,
  `normalizeCustomConfig` drops it whenever `groupBy` is not `none`, and the
  strict schema rejects it there. It tracks the first metric only, like the
  trend fit.
- **It follows the page Compare selector**, so it is not always "the previous
  period" — it is whatever the selector says (previous period or previous
  year), and on "None" it falls back to the immediately preceding window. The
  chart shares the one earlier-window query the number widget's delta uses, so
  the two can never disagree.
- **The threshold lives in TypeScript, not SQL.** CTR, CPC, CPM, CPA and ROAS
  are derived from summed columns and have no column to filter on, so
  `passesThreshold` reads the value off the row `toRow` already built. A HAVING
  clause would mean re-spelling the five ratios in SQL and letting the two
  definitions drift.
- **Order is filter, then rank, then cut.** The threshold is applied before the
  top-N, so "top 10 campaigns with CPA over 50" is the ten biggest that
  qualify, not the qualifiers among the ten biggest. It is a predicate on one
  group's whole-range totals: a group keeps its entire series or is absent.
  Grouped charts only, and a chart whose threshold matched nothing says so
  (`describeThresholdEmpty`) instead of reading as missing data.
- **A ratio with a zero denominator is 0, not missing.** So a group with no
  conversions has CPA 0 and survives an "under 50" filter — the same 0 the
  chart itself shows. Only a genuinely null metric (revenue or ROAS without
  value tracking) fails every test.
- **Campaign-type rows carry no platform and no name.** Meta fills `objective`
  and Google fills `campaign_type`, so `coalesce(objective, campaign_type)` is
  one dimension rather than a merge that picks a winner. But a type spans
  whatever campaigns carry it, and nothing makes the merged dimension
  platform-disjoint in general, so `platform` stays null on those rows. Facts
  the dimension has no row for land in a labelled "No type set" bucket.
  `src/lib/data/metric-query.ts` is the first and only reader of
  `adpulse.campaigns`; `listCampaigns` still derives its list from
  `campaign_performance`.
- **An ad-account split shows one group today.** Every real client in the
  current data has exactly one ad account, because the Windsor sync creates one
  client per account. The split becomes useful when a client gets a second
  account. Demo and seeded rows have a NULL `ad_account_id` and all land in a
  single "No ad account" bucket.

## What is blocked

Four dimensions cannot be charted at any price in chart code, because the data
is not in the database and is not requested from Windsor.

| Dimension | Status |
| --- | --- |
| Device | Not in `META_FIELDS` or `GOOGLE_FIELDS`. Not stored. |
| Country / region | Not in either field list. Not stored. |
| Ad set / ad group | Not in either field list. No table at that grain. |
| Ad / creative | Not in either field list. `adpulse.ad_creatives` exists but is written only by `POST /api/seed`; no sync path fills it, and the creatives view is demo-gated for that reason. |

The field lists are `META_FIELDS` in `src/lib/windsor/meta.ts` and
`GOOGLE_FIELDS` in `src/lib/windsor/google.ts`. They are passed verbatim as the
`fields` query parameter in `src/lib/windsor/client.ts`, so what is not listed
is never returned, never landed in `raw_windsor_rows`, and never available for
re-normalization. This is not a mapping gap that a re-run fixes; it needs a
re-pull.

### Why this is more than "add a field"

The grain of `campaign_performance` is one row per ad account + campaign + date.
The ingestion upsert depends on exactly that: the partial unique index
`campaign_performance_upsert_key (ad_account_id, campaign_id, date) WHERE
ad_account_id IS NOT NULL`, used as the `onConflictDoUpdate` target in
`sync.ts`. Every one of the four blocked dimensions changes what one row means.
Add device and the same campaign-day arrives as several rows; the upsert key
collapses them and the last write wins. The key has to change, and the moment it
changes, every existing row is at a different grain from every new one.

Row counts multiply with the grain, and they multiply against each other. The
current dev data is 5,989 fact rows: 9 client/platform pairs, 110 to 1,155 rows
each, over 2026-06-02 to 2026-08-31. Ad-set grain is a single-digit multiple of
that, ad grain more, and either one crossed with device and country is a
multiple of a multiple.

`docs/data-ingestion-strategy.md` §5.4 already states the rule this follows:
capture the finest grain you can afford in raw, serve at the grain the UI needs.
Widening the grain of an existing served table later is the painful direction.

## What unblocking actually takes

In order. Sizes are relative, not estimates in days.

1. **Ask the provider.** Confirm the breakdown fields exist on both connectors,
   add them to `META_FIELDS` / `GOOGLE_FIELDS`, and re-pull the window you care
   about. Small change, but it changes the shape of every landed row and it
   costs Windsor quota. Check the row-count blowup on one account first.
2. **Decide the grain.** The recommendation is a **new fact table per grain**
   (for example `campaign_breakdown_daily` for device/geo, `adset_performance`
   and `ad_performance` for the hierarchy) rather than widening
   `campaign_performance`. A new table keeps the existing upsert key, existing
   rows, existing queries, all reports and all saved dashboards untouched, and
   lets the campaign-grain table stay the fast default. Widening the existing
   table means a new unique key, a backfill, and a silent double-count risk in
   every query that does not add the new dimension to its GROUP BY. Decide all
   four dimensions together, once — they share the same key change and the same
   raw pull, so doing them one at a time pays the migration cost four times.
   Medium decision, large consequence.
3. **Migrate.** One idempotent `drizzle/NNNN_*.sql` per the workflow in
   `CLAUDE.md`: the new table, its own upsert key, its indexes, plus the mirror
   updates in `src/lib/db/schema.ts` and `src/lib/types/database.ts`. Medium.
4. **Ingestion.** `NormalizedFact` in `src/lib/windsor/adapter.ts` is one flat
   campaign-day shape; a second grain needs either a second normalize output or
   a second adapter method, plus its own landing/normalize/upsert steps in
   `sync.ts`. Conversion mapping applies per row at the new grain too. This is
   the largest piece.
5. **Query layer.** `runMetricQuery` currently reads facts from one table. Serving a
   new grain means routing by `groupBy` to the right table, keeping the ratio
   derivation identical so numbers reconcile across grains, and accepting that
   a chart split by a breakdown dimension cannot be joined to a campaign-grain
   chart without double counting. Medium.
6. **UI.** New `groupBy` values, `VISUALIZATION_RULES` entries, builder picker
   labels, `describeCustomWidget` text, and the Builder Assistant tool schema.
   Small, and only worth doing after 1-5 land.

## Backward compatibility of new splits

Adding a `groupBy` value is additive and safe for everything already saved.
`normalizeCustomConfig` in `src/lib/dashboard/custom-widget.ts` never throws: an
unrecognized `groupBy` or `timeBucket` falls back to the default, and a value
the chosen visualization does not allow is snapped to the first allowed one
(`rule.groupBy[0]`). Metrics are filtered to known names and trimmed to the
visualization's limit; display options the chart type does not accept are
dropped rather than rejected. So a widget saved with a split that later
disappears keeps rendering something sensible instead of erroring.

This covers all four surfaces:

- Saved dashboard views and library widgets go through the same normalizer on
  read, and the strict `customWidgetConfigSchema` only gates writes.
- Templates store widgets in the same stored form, so they normalize the same
  way when stamped onto a client.
- Frozen view-report snapshots do not re-query at all — `build-view-snapshot.ts`
  freezes layout, inlined config and computed data onto the report row, and
  `src/components/reports/view-report.tsx` renders that with no data hooks. A
  new split cannot change an existing report's numbers.

The one thing that is not automatically safe is removing or renaming an existing
`groupBy` value: old configs would snap to the default and silently change what
the chart shows. Add values; do not rename them.
