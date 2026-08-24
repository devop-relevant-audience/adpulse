-- 0005_ingestion_foundation.sql
-- Phase 0 of the Windsor ingestion workstream (docs/schema-v2-assessment.md §5):
-- schema corrections + new ingestion entities, ahead of any ingestion code.
--
-- New: ad_accounts (currency/timezone/Windsor-mapping anchor), raw_windsor_rows
-- (verbatim landing layer), conversion_mappings (per-account "what counts as a
-- conversion"), campaigns (SCD-lite dimension), clients.is_demo.
-- Changed: campaign_performance gains ad_account_id/currency/link_clicks/
-- transform_version/synced_at, conversions becomes numeric (Google DDA credit is
-- fractional), revenue becomes nullable (NULL = value tracking not configured),
-- stored ctr/cpc/cpm are dropped (always recomputed from base counts), and a
-- partial unique index provides the upsert conflict target for real rows.
-- alert_rules.metric gains 'revenue' and 'roas'.

-- 1. ad_accounts — one row per connected platform ad account. Currency and
-- timezone are immutable account-level facts on all three platforms; timezone
-- is nullable because Windsor does not currently expose it (entered manually).
CREATE TABLE IF NOT EXISTS public.ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_account_id text NOT NULL,
  account_name text NOT NULL,
  currency text NOT NULL,
  timezone text,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_accounts_platform_check' AND conrelid = 'public.ad_accounts'::regclass) THEN
    ALTER TABLE public.ad_accounts
      ADD CONSTRAINT ad_accounts_platform_check CHECK (platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_accounts_status_check' AND conrelid = 'public.ad_accounts'::regclass) THEN
    ALTER TABLE public.ad_accounts
      ADD CONSTRAINT ad_accounts_status_check CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'disconnected'::text]));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ad_accounts_platform_external_idx
  ON public.ad_accounts (platform, external_account_id);
CREATE INDEX IF NOT EXISTS ad_accounts_client_idx ON public.ad_accounts (client_id);

-- 2. raw_windsor_rows — landing layer. Verbatim Windsor response row per
-- (account, campaign, date); normalization is a re-runnable pure function of
-- this table, so a mapping mistake is a re-run, not a re-pull.
CREATE TABLE IF NOT EXISTS public.raw_windsor_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  date date NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pulled_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS raw_windsor_rows_natural_key
  ON public.raw_windsor_rows (ad_account_id, campaign_id, date);
CREATE INDEX IF NOT EXISTS raw_windsor_rows_date_idx ON public.raw_windsor_rows (date);

-- 3. conversion_mappings — per-account rules defining which platform events
-- count toward unified conversions/revenue. event_key is the platform event
-- identifier (Meta action_type, Google conversion action, TikTok optimization
-- event); attribution_window picks the reading for platforms that embed
-- per-window breakdowns ('value' = the account's active attribution setting,
-- or e.g. '7d_click' / '1d_view' for a fixed-window reading on Meta).
CREATE TABLE IF NOT EXISTS public.conversion_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  target text NOT NULL DEFAULT 'conversions',
  event_key text NOT NULL,
  attribution_window text NOT NULL DEFAULT 'value',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_mappings_target_check' AND conrelid = 'public.conversion_mappings'::regclass) THEN
    ALTER TABLE public.conversion_mappings
      ADD CONSTRAINT conversion_mappings_target_check CHECK (target = ANY (ARRAY['conversions'::text, 'revenue'::text]));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS conversion_mappings_account_target_event_idx
  ON public.conversion_mappings (ad_account_id, target, event_key);

-- 4. campaigns — SCD-lite dimension for campaign metadata. status/objective/
-- campaign_type are platform-native OPEN enums (Meta/TikTok add values over
-- time and legacy values still appear on read) — deliberately NO CHECK.
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
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
  ON public.campaigns (ad_account_id, campaign_id);

-- 5. clients.is_demo — demo/seed clients keep the showcase features
-- (attribution, LTV, creatives); real clients hide them until real sources exist.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Backfill: every client that predates this migration is a seeded demo client.
-- Guarded so a re-run can never flip a real (ad_accounts-linked) client.
UPDATE public.clients c
SET is_demo = true
WHERE NOT EXISTS (SELECT 1 FROM public.ad_accounts a WHERE a.client_id = c.id);

-- 6. campaign_performance v2.
ALTER TABLE public.campaign_performance ADD COLUMN IF NOT EXISTS ad_account_id uuid;
ALTER TABLE public.campaign_performance ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.campaign_performance ADD COLUMN IF NOT EXISTS link_clicks integer;
ALTER TABLE public.campaign_performance ADD COLUMN IF NOT EXISTS transform_version integer;
ALTER TABLE public.campaign_performance ADD COLUMN IF NOT EXISTS synced_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_performance_ad_account_id_fkey' AND conrelid = 'public.campaign_performance'::regclass) THEN
    ALTER TABLE public.campaign_performance
      ADD CONSTRAINT campaign_performance_ad_account_id_fkey
      FOREIGN KEY (ad_account_id) REFERENCES public.ad_accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Google DDA reports fractional conversion credit — integer is the wrong type.
ALTER TABLE public.campaign_performance
  ALTER COLUMN conversions TYPE numeric(14,4) USING conversions::numeric(14,4);
ALTER TABLE public.campaign_performance ALTER COLUMN conversions SET DEFAULT 0;

-- NULL revenue = value tracking not configured; 0 = tracked, no sales.
ALTER TABLE public.campaign_performance ALTER COLUMN revenue DROP NOT NULL;
ALTER TABLE public.campaign_performance ALTER COLUMN revenue DROP DEFAULT;

-- Demo/seed rows were generated in implicit USD.
UPDATE public.campaign_performance SET currency = 'USD'
WHERE currency IS NULL AND ad_account_id IS NULL;

-- Ratios are always recomputed from base counts (never stored, never trusted
-- from the platform): drop the stored columns.
ALTER TABLE public.campaign_performance DROP COLUMN IF EXISTS ctr;
ALTER TABLE public.campaign_performance DROP COLUMN IF EXISTS cpc;
ALTER TABLE public.campaign_performance DROP COLUMN IF EXISTS cpm;

-- Upsert conflict target for real (account-linked) rows; demo rows (NULL
-- ad_account_id) are exempt via the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_performance_upsert_key
  ON public.campaign_performance (ad_account_id, campaign_id, date)
  WHERE ad_account_id IS NOT NULL;

-- 7. alert_rules.metric: allow revenue/roas alerts. DROP+ADD is idempotent as a pair.
ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_metric_check;
ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_metric_check
  CHECK (metric = ANY (ARRAY['spend'::text, 'cpa'::text, 'ctr'::text, 'cpc'::text, 'conversions'::text, 'impressions'::text, 'revenue'::text, 'roas'::text]));
