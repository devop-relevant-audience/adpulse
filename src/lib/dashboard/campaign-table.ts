// Contract for the "campaign table" widget: which row counts and sort keys it
// accepts. Pure TypeScript, no React — shared by the widget, its config form
// and the Builder Assistant's server-side schema, so the assistant can never
// emit a `limit` the widget would silently round back to its default.

export const CAMPAIGN_TABLE_LIMITS = [5, 8, 10, 20] as const;
export type CampaignTableLimit = (typeof CAMPAIGN_TABLE_LIMITS)[number];

export const CAMPAIGN_TABLE_SORTS = [
  { value: "spend", label: "Spend" },
  { value: "conversions", label: "Conversions" },
  { value: "cpa", label: "CPA" },
] as const;

export const CAMPAIGN_TABLE_SORT_BYS = CAMPAIGN_TABLE_SORTS.map((o) => o.value);
export type CampaignTableSortBy = (typeof CAMPAIGN_TABLE_SORTS)[number]["value"];

export const CAMPAIGN_TABLE_DEFAULT_LIMIT: CampaignTableLimit = 8;
export const CAMPAIGN_TABLE_DEFAULT_SORT_BY: CampaignTableSortBy = "spend";

export function campaignTableSortLabel(sortBy: CampaignTableSortBy): string {
  return CAMPAIGN_TABLE_SORTS.find((o) => o.value === sortBy)?.label ?? sortBy;
}
