-- Customizable dashboards — per-client saved layouts.
-- Additive: no drops, no data loss.

CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  is_default boolean NOT NULL DEFAULT true,
  layouts jsonb NOT NULL DEFAULT '{"lg":[],"md":[],"sm":[]}'::jsonb,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One dashboard per (client, name) — upsert target for stage-3 persistence.
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_client_name_idx
  ON dashboards (client_id, name);
