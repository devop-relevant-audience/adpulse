-- Dashboard views: many named dashboards per client instead of one "Default".
-- Each view is either internal (agency-only) or published to the client, and a
-- client has at most one default view.

ALTER TABLE adpulse.dashboards
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dashboards_visibility_check'
      AND conrelid = 'adpulse.dashboards'::regclass
  ) THEN
    ALTER TABLE adpulse.dashboards
      ADD CONSTRAINT dashboards_visibility_check
      CHECK (visibility = ANY (ARRAY['internal'::text, 'client'::text]));
  END IF;
END $$;

ALTER TABLE adpulse.dashboards
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- The baseline created is_default with DEFAULT true (one dashboard per client).
-- With multiple views per client a newly created view must not silently claim
-- the default slot.
ALTER TABLE adpulse.dashboards ALTER COLUMN is_default SET DEFAULT false;

-- At most one default per client. Demote every default but the oldest first so
-- the unique index can be built on pre-existing rows.
UPDATE adpulse.dashboards d
SET is_default = false
WHERE d.is_default
  AND EXISTS (
    SELECT 1 FROM adpulse.dashboards o
    WHERE o.client_id = d.client_id
      AND o.is_default
      AND (o.created_at, o.id) < (d.created_at, d.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS dashboards_client_default_idx
  ON adpulse.dashboards (client_id) WHERE is_default;
