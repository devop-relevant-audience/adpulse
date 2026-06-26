export interface ClientRow {
  id: string;
  name: string;
  industry: string;
  created_at: string;
}

export interface ClientInsert {
  id?: string;
  name: string;
  industry: string;
  created_at?: string;
}

export const PLATFORMS = ["google", "meta", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface CampaignPerformanceRow {
  id: string;
  client_id: string;
  platform: Platform;
  campaign_id: string;
  campaign_name: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  raw_payload: Record<string, unknown>;
  created_at: string;
}

export interface CampaignPerformanceInsert {
  id?: string;
  client_id: string;
  platform: Platform;
  campaign_id: string;
  campaign_name: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  raw_payload: Record<string, unknown>;
  created_at?: string;
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
  role: "user" | "assistant";
  content: string;
  reference_context: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatMessageInsert {
  id?: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  reference_context?: Record<string, unknown> | null;
  created_at?: string;
}

// --- Ad Creatives ---

export const CREATIVE_TYPES = ["image", "video", "carousel"] as const;
export type CreativeType = (typeof CREATIVE_TYPES)[number];

export const CREATIVE_STATUSES = ["active", "fatigued", "paused"] as const;
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

export const ALERT_METRICS = ["spend", "cpa", "ctr", "cpc", "conversions", "impressions"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_CONDITIONS = ["above", "below", "increases_by_pct", "decreases_by_pct"] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const EVALUATION_WINDOWS = ["daily", "weekly"] as const;
export type EvaluationWindow = (typeof EVALUATION_WINDOWS)[number];

export const ALERT_FREQUENCIES = ["realtime", "hourly_digest", "daily_digest"] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];

export const ALERT_SEVERITIES = ["critical", "warning", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["triggered", "acknowledged", "resolved"] as const;
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

export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const DATE_RANGE_TYPES = ["last_7", "last_14", "last_30", "last_month", "last_quarter", "month_to_date", "custom"] as const;
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

// --- Chart Annotations ---

export interface ChartAnnotationRow {
  id: string;
  client_id: string;
  date: string;
  content: string;
  created_at: string;
}

export interface ChartAnnotationInsert {
  id?: string;
  client_id: string;
  date: string;
  content: string;
  created_at?: string;
}

export interface Database {
  public: {
    Tables: {
      campaign_performance: {
        Row: CampaignPerformanceRow;
        Insert: CampaignPerformanceInsert;
        Update: Partial<CampaignPerformanceInsert>;
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
      chart_annotations: {
        Row: ChartAnnotationRow;
        Insert: ChartAnnotationInsert;
        Update: Partial<ChartAnnotationInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
