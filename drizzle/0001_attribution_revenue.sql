-- Attribution & Revenue feature — additive migration.
-- Adds revenue to campaign_performance and two new tables.
-- Safe/additive: no drops, no data loss.

ALTER TABLE campaign_performance
  ADD COLUMN IF NOT EXISTS revenue numeric(14, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS attribution_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  conversion_date date NOT NULL,
  revenue numeric(12, 2) NOT NULL DEFAULT 0,
  path text[] NOT NULL DEFAULT '{}',
  converting_platform text NOT NULL,
  touch_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribution_journeys_converting_platform_check
    CHECK (converting_platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))
);

CREATE INDEX IF NOT EXISTS attribution_journeys_client_date_idx
  ON attribution_journeys (client_id, conversion_date);

CREATE TABLE IF NOT EXISTS customer_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  acquisition_platform text NOT NULL,
  cohort_month text NOT NULL,
  customers integer NOT NULL DEFAULT 0,
  acquisition_spend numeric(14, 2) NOT NULL DEFAULT 0,
  retention jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_cohorts_acquisition_platform_check
    CHECK (acquisition_platform = ANY (ARRAY['google'::text, 'meta'::text, 'tiktok'::text]))
);

CREATE INDEX IF NOT EXISTS customer_cohorts_client_idx
  ON customer_cohorts (client_id);
