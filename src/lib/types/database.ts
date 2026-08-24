export interface ClientRow {
  id: string;
  name: string;
  industry: string;
  is_demo: boolean;
  created_at: string;
}

export interface ClientInsert {
  id?: string;
  name: string;
  industry: string;
  is_demo?: boolean;
  created_at?: string;
}

export const PLATFORMS = ['google', 'meta', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

// ctr/cpc/cpm are NOT stored columns — the data layer computes them from base
// counts in the select projection. revenue is NULL when value tracking isn't
// configured on the account (distinct from 0 = tracked, no sales).
// raw_payload exists on the table but is excluded from the serving projection.
export interface CampaignPerformanceRow {
  id: string;
  client_id: string;
  ad_account_id: string | null;
  platform: Platform;
  campaign_id: string;
  campaign_name: string;
  date: string;
  impressions: number;
  clicks: number;
  link_clicks: number | null;
  spend: number;
  conversions: number;
  revenue: number | null;
  currency: string | null;
  ctr: number;
  cpc: number;
  cpm: number;
  created_at: string;
}

export interface CampaignPerformanceInsert {
  id?: string;
  client_id: string;
  ad_account_id?: string | null;
  platform: Platform;
  campaign_id: string;
  campaign_name: string;
  date: string;
  impressions: number;
  clicks: number;
  link_clicks?: number | null;
  spend: number;
  conversions: number;
  revenue?: number | null;
  currency?: string | null;
  raw_payload?: Record<string, unknown>;
  transform_version?: number | null;
  synced_at?: string | null;
  created_at?: string;
}

// --- Ingestion foundation (Windsor workstream) ---

export const AD_ACCOUNT_STATUSES = ['active', 'paused', 'disconnected'] as const;
export type AdAccountStatus = (typeof AD_ACCOUNT_STATUSES)[number];

export interface AdAccountRow {
  id: string;
  client_id: string;
  platform: Platform;
  external_account_id: string;
  account_name: string;
  currency: string;
  timezone: string | null;
  status: AdAccountStatus;
  connected_at: string;
  created_at: string;
  updated_at: string;
}

export interface AdAccountInsert {
  id?: string;
  client_id: string;
  platform: Platform;
  external_account_id: string;
  account_name: string;
  currency: string;
  timezone?: string | null;
  status?: AdAccountStatus;
  connected_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RawWindsorRow {
  id: string;
  ad_account_id: string;
  platform: Platform;
  campaign_id: string;
  date: string;
  payload: Record<string, unknown>;
  pulled_at: string;
}

export interface RawWindsorRowInsert {
  id?: string;
  ad_account_id: string;
  platform: Platform;
  campaign_id: string;
  date: string;
  payload: Record<string, unknown>;
  pulled_at?: string;
}

export const CONVERSION_MAPPING_TARGETS = ['conversions', 'revenue'] as const;
export type ConversionMappingTarget = (typeof CONVERSION_MAPPING_TARGETS)[number];

export interface ConversionMappingRow {
  id: string;
  ad_account_id: string;
  target: ConversionMappingTarget;
  event_key: string;
  attribution_window: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversionMappingInsert {
  id?: string;
  ad_account_id: string;
  target?: ConversionMappingTarget;
  event_key: string;
  attribution_window?: string;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Campaign dimension. status/objective/campaign_type are platform-native open
// enums — typed as plain strings on purpose.
export interface CampaignRow {
  id: string;
  ad_account_id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  objective: string | null;
  campaign_type: string | null;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignInsert {
  id?: string;
  ad_account_id: string;
  campaign_id: string;
  name: string;
  status?: string | null;
  objective?: string | null;
  campaign_type?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReportRow {
  id: string;
  client_id: string;
  title: string;
  date_range_start: string;
  date_range_end: string;
  comparison_start: string;
  comparison_end: string;
  narrative: string;
  metrics_summary: Record<string, unknown>;
  share_token: string | null;
  share_password_hash: string | null;
  share_expires_at: string | null;
  created_at: string;
}

export interface ReportInsert {
  id?: string;
  client_id: string;
  title: string;
  date_range_start: string;
  date_range_end: string;
  comparison_start: string;
  comparison_end: string;
  narrative: string;
  metrics_summary: Record<string, unknown>;
  share_token?: string | null;
  share_password_hash?: string | null;
  share_expires_at?: string | null;
  created_at?: string;
}

export interface ChatSessionRow {
  id: string;
  client_id: string;
  title: string;
  created_at: string;
}

export interface ChatSessionInsert {
  id?: string;
  client_id: string;
  title: string;
  created_at?: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  reference_context: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatMessageInsert {
  id?: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  reference_context?: Record<string, unknown> | null;
  created_at?: string;
}

// --- Ad Creatives ---

export const CREATIVE_TYPES = ['image', 'video', 'carousel'] as const;
export type CreativeType = (typeof CREATIVE_TYPES)[number];

export const CREATIVE_STATUSES = ['active', 'fatigued', 'paused'] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export interface AdCreativeRow {
  id: string;
  client_id: string;
  campaign_id: string;
  platform: Platform;
  ad_id: string;
  ad_name: string;
  creative_type: CreativeType;
  headline: string;
  body_copy: string;
  thumbnail_url: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  first_served: string;
  last_served: string;
  days_running: number;
  status: CreativeStatus;
  created_at: string;
}

export interface AdCreativeInsert {
  id?: string;
  client_id: string;
  campaign_id: string;
  platform: Platform;
  ad_id: string;
  ad_name: string;
  creative_type: CreativeType;
  headline: string;
  body_copy: string;
  thumbnail_url: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  first_served: string;
  last_served: string;
  days_running: number;
  status?: CreativeStatus;
  created_at?: string;
}

// --- Alerts & Notifications ---

export const ALERT_METRICS = ['spend', 'cpa', 'ctr', 'cpc', 'conversions', 'impressions', 'revenue', 'roas'] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_CONDITIONS = ['above', 'below', 'increases_by_pct', 'decreases_by_pct'] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const EVALUATION_WINDOWS = ['daily', 'weekly'] as const;
export type EvaluationWindow = (typeof EVALUATION_WINDOWS)[number];

export const ALERT_FREQUENCIES = ['realtime', 'hourly_digest', 'daily_digest'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];

export const ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['triggered', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export interface AlertRuleRow {
  id: string;
  client_id: string;
  name: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  evaluation_window: EvaluationWindow;
  platform: Platform | null;
  campaign_id: string | null;
  enabled: boolean;
  recipients: string[];
  frequency: AlertFrequency;
  severity: AlertSeverity;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleInsert {
  id?: string;
  client_id: string;
  name: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  evaluation_window?: EvaluationWindow;
  platform?: Platform | null;
  campaign_id?: string | null;
  enabled?: boolean;
  recipients: string[];
  frequency?: AlertFrequency;
  severity?: AlertSeverity;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

export interface AlertHistoryRow {
  id: string;
  rule_id: string;
  client_id: string;
  triggered_at: string;
  metric: AlertMetric;
  actual_value: number;
  threshold_value: number;
  severity: AlertSeverity;
  status: AlertStatus;
  resolved_at: string | null;
  notification_sent: boolean;
  rule_name: string | null;
  created_at: string;
}

export interface AlertHistoryInsert {
  id?: string;
  rule_id: string;
  client_id: string;
  metric: AlertMetric;
  actual_value: number;
  threshold_value: number;
  severity?: AlertSeverity;
  status?: AlertStatus;
  resolved_at?: string | null;
  notification_sent?: boolean;
  rule_name?: string | null;
}

// --- Scheduled Report Delivery ---

export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const DATE_RANGE_TYPES = ['last_7', 'last_14', 'last_30', 'last_month', 'last_quarter', 'month_to_date', 'custom'] as const;
export type DateRangeType = (typeof DATE_RANGE_TYPES)[number];

export interface ReportScheduleRow {
  id: string;
  client_id: string;
  name: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  date_range_type: DateRangeType;
  custom_days: number | null;
  include_comparison: boolean;
  recipients: string[];
  subject_template: string;
  message_template: string;
  require_approval: boolean;
  enabled: boolean;
  last_sent_at: string | null;
  next_send_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportScheduleInsert {
  id?: string;
  client_id: string;
  name: string;
  frequency: ScheduleFrequency;
  day_of_week?: number | null;
  day_of_month?: number | null;
  time_of_day?: string;
  date_range_type?: DateRangeType;
  custom_days?: number | null;
  include_comparison?: boolean;
  recipients: string[];
  subject_template?: string;
  message_template?: string;
  require_approval?: boolean;
  enabled?: boolean;
}

// --- Attribution & Revenue ---

export type AttributionModel =
  | 'first_touch'
  | 'last_touch'
  | 'linear'
  | 'time_decay'
  | 'position_based';

export interface AttributionJourneyRow {
  id: string;
  client_id: string;
  conversion_date: string;
  revenue: number;
  path: Platform[];
  converting_platform: Platform;
  touch_count: number;
  created_at: string;
}

export interface AttributionJourneyInsert {
  id?: string;
  client_id: string;
  conversion_date: string;
  revenue: number;
  path: Platform[];
  converting_platform: Platform;
  touch_count: number;
  created_at?: string;
}

// Nested JSON value on customer_cohorts.retention — passed through the
// snake/camel converter untouched, so its keys stay camelCase everywhere.
export interface CohortRetentionPoint {
  monthOffset: number;
  revenue: number;
  activeCustomers: number;
}

export interface CustomerCohortRow {
  id: string;
  client_id: string;
  acquisition_platform: Platform;
  cohort_month: string;
  customers: number;
  acquisition_spend: number;
  retention: CohortRetentionPoint[];
  created_at: string;
}

export interface CustomerCohortInsert {
  id?: string;
  client_id: string;
  acquisition_platform: Platform;
  cohort_month: string;
  customers: number;
  acquisition_spend: number;
  retention: CohortRetentionPoint[];
  created_at?: string;
}

// --- Customizable dashboards ---
// `layouts`/`widgets` are nested JSON blobs (react-grid-layout layout + widget
// instances). Typed as unknown at the DB boundary to avoid a types↔dashboard
// import cycle; the data layer maps them to the DashboardConfig app type.
export interface DashboardRow {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  layouts: unknown;
  widgets: unknown;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardInsert {
  id?: string;
  client_id: string;
  name?: string;
  is_default?: boolean;
  layouts: unknown;
  widgets: unknown;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

// --- Auth & tenancy ---
// Application-level roles. `agency_*` roles see all clients; `client_user` sees
// only clients they're a member of (via client_members). Later stages import this.
export type AppRole = 'agency_admin' | 'agency_member' | 'client_user';

// One profile per Supabase auth user; `id` is the auth.users id. The FK to
// auth.users(id) lives in the migration, not in Drizzle.
export interface UserProfileRow {
  id: string;
  full_name: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface UserProfileInsert {
  id: string;
  full_name?: string | null;
  role?: AppRole;
  created_at?: string;
  updated_at?: string;
}

export const CLIENT_MEMBER_ROLES = ['viewer'] as const;
export type ClientMemberRole = (typeof CLIENT_MEMBER_ROLES)[number];

export interface ClientMemberRow {
  id: string;
  user_id: string;
  client_id: string;
  role: ClientMemberRole;
  created_at: string;
}

export interface ClientMemberInsert {
  id?: string;
  user_id: string;
  client_id: string;
  role?: ClientMemberRole;
  created_at?: string;
}

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: UserProfileRow;
        Insert: UserProfileInsert;
        Update: Partial<UserProfileInsert>;
      };
      client_members: {
        Row: ClientMemberRow;
        Insert: ClientMemberInsert;
        Update: Partial<ClientMemberInsert>;
      };
      dashboards: {
        Row: DashboardRow;
        Insert: DashboardInsert;
        Update: Partial<DashboardInsert>;
      };
      attribution_journeys: {
        Row: AttributionJourneyRow;
        Insert: AttributionJourneyInsert;
        Update: Partial<AttributionJourneyInsert>;
      };
      customer_cohorts: {
        Row: CustomerCohortRow;
        Insert: CustomerCohortInsert;
        Update: Partial<CustomerCohortInsert>;
      };
      campaign_performance: {
        Row: CampaignPerformanceRow;
        Insert: CampaignPerformanceInsert;
        Update: Partial<CampaignPerformanceInsert>;
      };
      ad_accounts: {
        Row: AdAccountRow;
        Insert: AdAccountInsert;
        Update: Partial<AdAccountInsert>;
      };
      raw_windsor_rows: {
        Row: RawWindsorRow;
        Insert: RawWindsorRowInsert;
        Update: Partial<RawWindsorRowInsert>;
      };
      conversion_mappings: {
        Row: ConversionMappingRow;
        Insert: ConversionMappingInsert;
        Update: Partial<ConversionMappingInsert>;
      };
      campaigns: {
        Row: CampaignRow;
        Insert: CampaignInsert;
        Update: Partial<CampaignInsert>;
      };
      clients: {
        Row: ClientRow;
        Insert: ClientInsert;
        Update: Partial<ClientInsert>;
      };
      reports: {
        Row: ReportRow;
        Insert: ReportInsert;
        Update: Partial<ReportInsert>;
      };
      chat_sessions: {
        Row: ChatSessionRow;
        Insert: ChatSessionInsert;
        Update: Partial<ChatSessionInsert>;
      };
      chat_messages: {
        Row: ChatMessageRow;
        Insert: ChatMessageInsert;
        Update: Partial<ChatMessageInsert>;
      };
      ad_creatives: {
        Row: AdCreativeRow;
        Insert: AdCreativeInsert;
        Update: Partial<AdCreativeInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
