// Hand-maintained Drizzle model of the Supabase Postgres schema. `drizzle-kit
// pull`/`generate` are unreliable here (pull crashes on this project's CHECK
// constraints — see AGENTS.md), so this file is NOT generated. When you change
// the schema, write an idempotent migration in `drizzle/NNNN_*.sql`, run
// `npm run db:migrate`, and hand-edit this file (and src/lib/types/database.ts)
// to match. Keep the index()/uniqueIndex()/check() calls in sync with the SQL.
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  boolean,
  jsonb,
  date,
  timestamp,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DashboardLayouts, WidgetInstance } from "@/lib/dashboard/types";

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  // Demo/seed clients keep the showcase-only features (attribution, LTV,
  // creatives); real clients hide them until real data sources exist.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// --- Ingestion foundation (Windsor workstream, docs/schema-v2-assessment.md) ---

// One row per connected platform ad account. Currency/timezone are immutable
// account-level facts on all three platforms; timezone is nullable because
// Windsor doesn't currently expose it (entered manually).
export const adAccounts = pgTable(
  "ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    accountName: text("account_name").notNull(),
    currency: text("currency").notNull(),
    timezone: text("timezone"),
    status: text("status").notNull().default("active"),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("ad_accounts_platform_check", sql`(${table.platform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    check("ad_accounts_status_check", sql`(${table.status} = ANY (ARRAY['active'::text, 'paused'::text, 'disconnected'::text]))`),
    uniqueIndex("ad_accounts_platform_external_idx").on(table.platform, table.externalAccountId),
    index("ad_accounts_client_idx").on(table.clientId),
  ]
);

// Landing layer: verbatim Windsor response row per (account, campaign, date).
// Normalization is a re-runnable pure function of this table — a mapping
// mistake is a re-run, not a re-pull.
export const rawWindsorRows = pgTable(
  "raw_windsor_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    campaignId: text("campaign_id").notNull(),
    date: date("date").notNull(),
    // Nested JSON — passed through the case converter untouched.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    pulledAt: timestamp("pulled_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("raw_windsor_rows_natural_key").on(table.adAccountId, table.campaignId, table.date),
    index("raw_windsor_rows_date_idx").on(table.date),
  ]
);

// Per-account rules defining which platform events count toward unified
// conversions/revenue. event_key = Meta action_type / Google conversion action
// / TikTok optimization event; attribution_window = 'value' (account's active
// setting) or a fixed-window reading (e.g. '7d_click') where the platform
// embeds per-window breakdowns.
export const conversionMappings = pgTable(
  "conversion_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    target: text("target").notNull().default("conversions"),
    eventKey: text("event_key").notNull(),
    attributionWindow: text("attribution_window").notNull().default("value"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("conversion_mappings_target_check", sql`(${table.target} = ANY (ARRAY['conversions'::text, 'revenue'::text]))`),
    uniqueIndex("conversion_mappings_account_target_event_idx").on(table.adAccountId, table.target, table.eventKey),
  ]
);

// SCD-lite campaign dimension. status/objective/campaign_type are
// platform-native OPEN enums (values get added over time and legacy values
// still appear on read) — deliberately no CHECK constraints.
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    objective: text("objective"),
    campaignType: text("campaign_type"),
    firstSeen: date("first_seen"),
    lastSeen: date("last_seen"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaigns_account_campaign_idx").on(table.adAccountId, table.campaignId),
  ]
);

export const campaignPerformance = pgTable(
  "campaign_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    // NULL on demo/seed rows; set for real ingested rows (upsert key below).
    adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name").notNull(),
    date: date("date").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    linkClicks: integer("link_clicks"),
    spend: numeric("spend", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    // numeric, not integer: Google DDA reports fractional conversion credit.
    conversions: numeric("conversions", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
    // NULL = value tracking not configured; 0 = tracked, no sales.
    revenue: numeric("revenue", { precision: 14, scale: 2, mode: "number" }),
    currency: text("currency"),
    // ctr/cpc/cpm are intentionally NOT stored — always recomputed from base counts.
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    transformVersion: integer("transform_version"),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("campaign_performance_platform_check", sql`(${table.platform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    index("idx_campaign_perf_client_date").on(table.clientId, table.date),
    index("idx_campaign_perf_campaign").on(table.campaignId),
    index("idx_campaign_perf_platform").on(table.platform),
    uniqueIndex("campaign_performance_upsert_key")
      .on(table.adAccountId, table.campaignId, table.date)
      .where(sql`${table.adAccountId} IS NOT NULL`),
  ]
);

export const campaignBudgets = pgTable("campaign_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull(),
  monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2, mode: "number" }).notNull(),
  month: text("month").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("idx_campaign_budgets_client_month").on(table.clientId, table.month),
]);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dateRangeStart: date("date_range_start").notNull(),
  dateRangeEnd: date("date_range_end").notNull(),
  comparisonStart: date("comparison_start").notNull(),
  comparisonEnd: date("comparison_end").notNull(),
  narrative: text("narrative").notNull().default(""),
  metricsSummary: jsonb("metrics_summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  shareToken: text("share_token"),
  sharePasswordHash: text("share_password_hash"),
  shareExpiresAt: timestamp("share_expires_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("idx_reports_client").on(table.clientId),
  uniqueIndex("idx_reports_share_token").on(table.shareToken).where(sql`${table.shareToken} IS NOT NULL`),
]);

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("idx_chat_sessions_client").on(table.clientId),
]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    referenceContext: jsonb("reference_context").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("chat_messages_role_check", sql`(${table.role} = ANY (ARRAY['user'::text, 'assistant'::text]))`),
    index("idx_chat_messages_session").on(table.sessionId),
  ]
);

export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").notNull(),
    platform: text("platform").notNull(),
    adId: text("ad_id").notNull(),
    adName: text("ad_name").notNull(),
    creativeType: text("creative_type").notNull(),
    headline: text("headline").notNull(),
    bodyCopy: text("body_copy").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    spend: numeric("spend", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    conversions: bigint("conversions", { mode: "number" }).notNull().default(0),
    ctr: numeric("ctr", { precision: 8, scale: 4, mode: "number" }).notNull().default(0),
    cpc: numeric("cpc", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    cpa: numeric("cpa", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    firstServed: date("first_served").notNull(),
    lastServed: date("last_served").notNull(),
    daysRunning: integer("days_running").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("ad_creatives_platform_check", sql`(${table.platform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    check("ad_creatives_creative_type_check", sql`(${table.creativeType} = ANY (ARRAY['image'::text, 'video'::text, 'carousel'::text]))`),
    check("ad_creatives_status_check", sql`(${table.status} = ANY (ARRAY['active'::text, 'fatigued'::text, 'paused'::text]))`),
    index("idx_ad_creatives_client_campaign").on(table.clientId, table.campaignId),
    index("idx_ad_creatives_client_platform").on(table.clientId, table.platform),
    index("idx_ad_creatives_client_status").on(table.clientId, table.status),
  ]
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metric: text("metric").notNull(),
    condition: text("condition").notNull(),
    threshold: numeric("threshold", { mode: "number" }).notNull(),
    evaluationWindow: text("evaluation_window").notNull().default("daily"),
    platform: text("platform"),
    campaignId: text("campaign_id"),
    enabled: boolean("enabled").notNull().default(true),
    recipients: text("recipients").array().notNull().default([]),
    frequency: text("frequency").notNull().default("realtime"),
    severity: text("severity").notNull().default("warning"),
    quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("alert_rules_metric_check", sql`(${table.metric} = ANY (ARRAY['spend'::text, 'cpa'::text, 'ctr'::text, 'cpc'::text, 'conversions'::text, 'impressions'::text, 'revenue'::text, 'roas'::text]))`),
    check("alert_rules_condition_check", sql`(${table.condition} = ANY (ARRAY['above'::text, 'below'::text, 'increases_by_pct'::text, 'decreases_by_pct'::text]))`),
    check("alert_rules_evaluation_window_check", sql`(${table.evaluationWindow} = ANY (ARRAY['daily'::text, 'weekly'::text]))`),
    check("alert_rules_platform_check", sql`(${table.platform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    check("alert_rules_frequency_check", sql`(${table.frequency} = ANY (ARRAY['realtime'::text, 'hourly_digest'::text, 'daily_digest'::text]))`),
    check("alert_rules_severity_check", sql`(${table.severity} = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text]))`),
    index("idx_alert_rules_client").on(table.clientId),
  ]
);

export const alertHistory = pgTable(
  "alert_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").notNull().references(() => alertRules.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    metric: text("metric").notNull(),
    actualValue: numeric("actual_value", { mode: "number" }).notNull(),
    thresholdValue: numeric("threshold_value", { mode: "number" }).notNull(),
    severity: text("severity").notNull().default("warning"),
    status: text("status").notNull().default("triggered"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    notificationSent: boolean("notification_sent").notNull().default(true),
    ruleName: text("rule_name"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("alert_history_severity_check", sql`(${table.severity} = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text]))`),
    check("alert_history_status_check", sql`(${table.status} = ANY (ARRAY['triggered'::text, 'acknowledged'::text, 'resolved'::text]))`),
    index("idx_alert_history_client").on(table.clientId),
    index("idx_alert_history_rule").on(table.ruleId),
  ]
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequency: text("frequency").notNull(),
    dayOfWeek: integer("day_of_week"),
    dayOfMonth: integer("day_of_month"),
    timeOfDay: text("time_of_day").notNull().default("09:00"),
    dateRangeType: text("date_range_type").notNull().default("last_30"),
    customDays: integer("custom_days"),
    includeComparison: boolean("include_comparison").notNull().default(true),
    recipients: text("recipients").array().notNull().default([]),
    subjectTemplate: text("subject_template").notNull().default("{{clientName}} Performance Report"),
    messageTemplate: text("message_template").notNull().default(""),
    requireApproval: boolean("require_approval").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true, mode: "string" }),
    nextSendAt: timestamp("next_send_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("report_schedules_frequency_check", sql`(${table.frequency} = ANY (ARRAY['daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text]))`),
    check("report_schedules_day_of_week_check", sql`((${table.dayOfWeek} >= 0) AND (${table.dayOfWeek} <= 6))`),
    check("report_schedules_day_of_month_check", sql`((${table.dayOfMonth} >= 1) AND (${table.dayOfMonth} <= 31))`),
    check("report_schedules_date_range_type_check", sql`(${table.dateRangeType} = ANY (ARRAY['last_7'::text, 'last_14'::text, 'last_30'::text, 'last_month'::text, 'last_quarter'::text, 'month_to_date'::text, 'custom'::text]))`),
    index("idx_report_schedules_client").on(table.clientId),
  ]
);

// --- Attribution & Revenue ---
// Cross-platform conversion journeys: each row is ONE deduplicated (real)
// conversion with the ordered list of platform touchpoints that led to it.
// Used to compute multi-touch attribution models and the blended-vs-reported
// ROAS contrast (platforms each self-claim conversions, so summing
// campaign_performance across platforms over-counts vs these real journeys).
export const attributionJourneys = pgTable(
  "attribution_journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    conversionDate: date("conversion_date").notNull(),
    revenue: numeric("revenue", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    path: text("path").array().notNull().default([]),
    convertingPlatform: text("converting_platform").notNull(),
    touchCount: integer("touch_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("attribution_journeys_converting_platform_check", sql`(${table.convertingPlatform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    index("attribution_journeys_client_date_idx").on(table.clientId, table.conversionDate),
  ]
);

// Customer cohorts by acquisition channel + acquisition month, with a retention
// curve (per-customer cumulative revenue over month offsets) for LTV / LTV:CAC.
export const customerCohorts = pgTable(
  "customer_cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    acquisitionPlatform: text("acquisition_platform").notNull(),
    cohortMonth: text("cohort_month").notNull(),
    customers: integer("customers").notNull().default(0),
    acquisitionSpend: numeric("acquisition_spend", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    // Nested JSON — passed through the case converter untouched, so keys stay camelCase.
    retention: jsonb("retention")
      .$type<Array<{ monthOffset: number; revenue: number; activeCustomers: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("customer_cohorts_acquisition_platform_check", sql`(${table.acquisitionPlatform} = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))`),
    index("customer_cohorts_client_idx").on(table.clientId),
  ]
);

// --- Customizable dashboards ---
// Per-client saved dashboard layouts. `layouts`/`widgets` are nested JSON that
// crosses the case boundary untouched (their inner keys stay camelCase).
export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Default"),
  isDefault: boolean("is_default").notNull().default(true),
  layouts: jsonb("layouts").$type<DashboardLayouts>().notNull().default({ lg: [], md: [], sm: [] }),
  widgets: jsonb("widgets").$type<WidgetInstance[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dashboards_client_name_idx").on(table.clientId, table.name),
]);

// --- Auth & tenancy ---
// One profile row per Supabase auth user. `id` is the auth.users id; the
// cross-schema FK to auth.users(id) ON DELETE CASCADE lives in the migration
// (drizzle/0004_auth_tenancy.sql) since Drizzle doesn't model the auth schema.
export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey(),
    fullName: text("full_name"),
    role: text("role").notNull().default("client_user"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("user_profiles_role_check", sql`(${table.role} = ANY (ARRAY['agency_admin'::text, 'agency_member'::text, 'client_user'::text]))`),
  ]
);

// Per-client membership — grants a (non-agency) user access to a single client.
export const clientMembers = pgTable(
  "client_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("client_members_role_check", sql`(${table.role} = ANY (ARRAY['viewer'::text]))`),
    index("client_members_client_idx").on(table.clientId),
    uniqueIndex("client_members_user_client_idx").on(table.userId, table.clientId),
  ]
);
