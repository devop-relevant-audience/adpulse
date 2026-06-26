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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

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
