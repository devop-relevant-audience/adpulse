-- 0000_shared_baseline.sql
-- AdPulse baseline for the SHARED Atlas Supabase project. All AdPulse tables
-- live in the dedicated `adpulse` schema; Atlas owns `public` (managed by
-- drizzle-kit push from the Atlas repo) and this file must never touch it.
-- Consolidates the schema history of the old standalone project
-- (drizzle/archive-standalone/) into one idempotent file: safe to run against
-- a fresh Supabase project (creates everything) or re-run (every statement
-- no-ops).
--
-- There are no user tables: identity is the shared Clerk session; roles and
-- client access come from Atlas's public.user_roles / public.project_users,
-- linked via clients.atlas_project_id.
--
-- RLS is enabled on every table as defense in depth (Supabase convention —
-- the schema is not exposed via PostgREST and the app connects as the table
-- owner, so no policies are needed; authorization lives in the app layer).

CREATE SCHEMA IF NOT EXISTS adpulse;

-- ============ clients ============
CREATE TABLE IF NOT EXISTS adpulse.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  -- Link to the Atlas project (public.projects.id). NULL = unlinked (demo
  -- clients); client_user access flows through this link.
  atlas_project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_atlas_project_idx
  ON adpulse.clients (atlas_project_id) WHERE atlas_project_id IS NOT NULL;

-- ============ ad_accounts ============
CREATE TABLE IF NOT EXISTS adpulse.ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_account_id text NOT NULL,
  account_name text NOT NULL,
  currency text NOT NULL,
  timezone text,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_accounts_platform_check
    CHECK (platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text])),
  CONSTRAINT ad_accounts_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'disconnected'::text]))
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_accounts_platform_external_idx
  ON adpulse.ad_accounts (platform, external_account_id);
CREATE INDEX IF NOT EXISTS ad_accounts_client_idx ON adpulse.ad_accounts (client_id);

-- ============ raw_windsor_rows ============
CREATE TABLE IF NOT EXISTS adpulse.raw_windsor_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES adpulse.ad_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  date date NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pulled_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS raw_windsor_rows_natural_key
  ON adpulse.raw_windsor_rows (ad_account_id, campaign_id, date);
CREATE INDEX IF NOT EXISTS raw_windsor_rows_date_idx ON adpulse.raw_windsor_rows (date);

-- ============ conversion_mappings ============
CREATE TABLE IF NOT EXISTS adpulse.conversion_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES adpulse.ad_accounts(id) ON DELETE CASCADE,
  target text NOT NULL DEFAULT 'conversions',
  event_key text NOT NULL,
  attribution_window text NOT NULL DEFAULT 'value',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversion_mappings_target_check
    CHECK (target = ANY (ARRAY['conversions'::text, 'revenue'::text]))
);

CREATE UNIQUE INDEX IF NOT EXISTS conversion_mappings_account_target_event_idx
  ON adpulse.conversion_mappings (ad_account_id, target, event_key);

-- ============ campaigns (SCD-lite dimension; open platform enums, no CHECKs) ============
CREATE TABLE IF NOT EXISTS adpulse.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES adpulse.ad_accounts(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  name text NOT NULL,
  status text,
  objective text,
  campaign_type text,
  first_seen date,
  last_seen date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_account_campaign_idx
  ON adpulse.campaigns (ad_account_id, campaign_id);

-- ============ campaign_performance ============
-- conversions is numeric (Google DDA credit is fractional); revenue is nullable
-- (NULL = value tracking not configured); ctr/cpc/cpm are never stored.
CREATE TABLE IF NOT EXISTS adpulse.campaign_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  ad_account_id uuid REFERENCES adpulse.ad_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  date date NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  link_clicks integer,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  conversions numeric(14,4) NOT NULL DEFAULT 0,
  revenue numeric(14,2),
  currency text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  transform_version integer,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_performance_platform_check
    CHECK (platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))
);

CREATE INDEX IF NOT EXISTS idx_campaign_perf_client_date
  ON adpulse.campaign_performance (client_id, date);
CREATE INDEX IF NOT EXISTS idx_campaign_perf_campaign
  ON adpulse.campaign_performance (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_perf_platform
  ON adpulse.campaign_performance (platform);
-- Upsert conflict target for real (account-linked) rows; demo rows (NULL
-- ad_account_id) are exempt via the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_performance_upsert_key
  ON adpulse.campaign_performance (ad_account_id, campaign_id, date)
  WHERE ad_account_id IS NOT NULL;

-- ============ campaign_budgets ============
CREATE TABLE IF NOT EXISTS adpulse.campaign_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  monthly_budget numeric(12,2) NOT NULL,
  month text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_budgets_client_month
  ON adpulse.campaign_budgets (client_id, month);

-- ============ reports ============
CREATE TABLE IF NOT EXISTS adpulse.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  date_range_start date NOT NULL,
  date_range_end date NOT NULL,
  comparison_start date NOT NULL,
  comparison_end date NOT NULL,
  narrative text NOT NULL DEFAULT '',
  metrics_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  share_token text,
  share_password_hash text,
  share_expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reports_client ON adpulse.reports (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token
  ON adpulse.reports (share_token) WHERE share_token IS NOT NULL;

-- ============ chat_sessions / chat_messages ============
CREATE TABLE IF NOT EXISTS adpulse.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_client ON adpulse.chat_sessions (client_id);

CREATE TABLE IF NOT EXISTS adpulse.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES adpulse.chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  reference_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_role_check
    CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON adpulse.chat_messages (session_id);

-- ============ ad_creatives ============
CREATE TABLE IF NOT EXISTS adpulse.ad_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  platform text NOT NULL,
  ad_id text NOT NULL,
  ad_name text NOT NULL,
  creative_type text NOT NULL,
  headline text NOT NULL,
  body_copy text NOT NULL,
  thumbnail_url text NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  conversions bigint NOT NULL DEFAULT 0,
  ctr numeric(8,4) NOT NULL DEFAULT 0,
  cpc numeric(10,4) NOT NULL DEFAULT 0,
  cpa numeric(10,2) NOT NULL DEFAULT 0,
  first_served date NOT NULL,
  last_served date NOT NULL,
  days_running integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creatives_platform_check
    CHECK (platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text])),
  CONSTRAINT ad_creatives_creative_type_check
    CHECK (creative_type = ANY (ARRAY['image'::text, 'video'::text, 'carousel'::text])),
  CONSTRAINT ad_creatives_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'fatigued'::text, 'paused'::text]))
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_client_campaign
  ON adpulse.ad_creatives (client_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_client_platform
  ON adpulse.ad_creatives (client_id, platform);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_client_status
  ON adpulse.ad_creatives (client_id, status);

-- ============ alert_rules / alert_history ============
CREATE TABLE IF NOT EXISTS adpulse.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  metric text NOT NULL,
  condition text NOT NULL,
  threshold numeric NOT NULL,
  evaluation_window text NOT NULL DEFAULT 'daily',
  platform text,
  campaign_id text,
  enabled boolean NOT NULL DEFAULT true,
  recipients text[] NOT NULL DEFAULT '{}'::text[],
  frequency text NOT NULL DEFAULT 'realtime',
  severity text NOT NULL DEFAULT 'warning',
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start text,
  quiet_hours_end text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_rules_metric_check
    CHECK (metric = ANY (ARRAY['spend'::text, 'cpa'::text, 'ctr'::text, 'cpc'::text, 'conversions'::text, 'impressions'::text, 'revenue'::text, 'roas'::text])),
  CONSTRAINT alert_rules_condition_check
    CHECK (condition = ANY (ARRAY['above'::text, 'below'::text, 'increases_by_pct'::text, 'decreases_by_pct'::text])),
  CONSTRAINT alert_rules_evaluation_window_check
    CHECK (evaluation_window = ANY (ARRAY['daily'::text, 'weekly'::text])),
  CONSTRAINT alert_rules_platform_check
    CHECK (platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text])),
  CONSTRAINT alert_rules_frequency_check
    CHECK (frequency = ANY (ARRAY['realtime'::text, 'hourly_digest'::text, 'daily_digest'::text])),
  CONSTRAINT alert_rules_severity_check
    CHECK (severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text]))
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_client ON adpulse.alert_rules (client_id);

CREATE TABLE IF NOT EXISTS adpulse.alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES adpulse.alert_rules(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  metric text NOT NULL,
  actual_value numeric NOT NULL,
  threshold_value numeric NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'triggered',
  resolved_at timestamptz,
  notification_sent boolean NOT NULL DEFAULT true,
  rule_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_history_severity_check
    CHECK (severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text])),
  CONSTRAINT alert_history_status_check
    CHECK (status = ANY (ARRAY['triggered'::text, 'acknowledged'::text, 'resolved'::text]))
);

CREATE INDEX IF NOT EXISTS idx_alert_history_client ON adpulse.alert_history (client_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON adpulse.alert_history (rule_id);

-- ============ report_schedules ============
CREATE TABLE IF NOT EXISTS adpulse.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL,
  day_of_week integer,
  day_of_month integer,
  time_of_day text NOT NULL DEFAULT '09:00',
  date_range_type text NOT NULL DEFAULT 'last_30',
  custom_days integer,
  include_comparison boolean NOT NULL DEFAULT true,
  recipients text[] NOT NULL DEFAULT '{}'::text[],
  subject_template text NOT NULL DEFAULT '{{clientName}} Performance Report',
  message_template text NOT NULL DEFAULT '',
  require_approval boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_frequency_check
    CHECK (frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text])),
  CONSTRAINT report_schedules_day_of_week_check
    CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT report_schedules_day_of_month_check
    CHECK (day_of_month >= 1 AND day_of_month <= 31),
  CONSTRAINT report_schedules_date_range_type_check
    CHECK (date_range_type = ANY (ARRAY['last_7'::text, 'last_14'::text, 'last_30'::text, 'last_month'::text, 'last_quarter'::text, 'month_to_date'::text, 'custom'::text]))
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_client
  ON adpulse.report_schedules (client_id);

-- ============ attribution_journeys / customer_cohorts (demo-only sources) ============
CREATE TABLE IF NOT EXISTS adpulse.attribution_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  conversion_date date NOT NULL,
  revenue numeric(12,2) NOT NULL DEFAULT 0,
  path text[] NOT NULL DEFAULT '{}'::text[],
  converting_platform text NOT NULL,
  touch_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribution_journeys_converting_platform_check
    CHECK (converting_platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))
);

CREATE INDEX IF NOT EXISTS attribution_journeys_client_date_idx
  ON adpulse.attribution_journeys (client_id, conversion_date);

CREATE TABLE IF NOT EXISTS adpulse.customer_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  acquisition_platform text NOT NULL,
  cohort_month text NOT NULL,
  customers integer NOT NULL DEFAULT 0,
  acquisition_spend numeric(14,2) NOT NULL DEFAULT 0,
  retention jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_cohorts_acquisition_platform_check
    CHECK (acquisition_platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))
);

CREATE INDEX IF NOT EXISTS customer_cohorts_client_idx
  ON adpulse.customer_cohorts (client_id);

-- ============ dashboards ============
CREATE TABLE IF NOT EXISTS adpulse.dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  is_default boolean NOT NULL DEFAULT true,
  layouts jsonb NOT NULL DEFAULT '{"lg": [], "md": [], "sm": []}'::jsonb,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboards_client_name_idx
  ON adpulse.dashboards (client_id, name);

-- ============ RLS (defense in depth; idempotent by nature) ============
ALTER TABLE adpulse.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.raw_windsor_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.conversion_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.campaign_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.campaign_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.attribution_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.customer_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.dashboards ENABLE ROW LEVEL SECURITY;
