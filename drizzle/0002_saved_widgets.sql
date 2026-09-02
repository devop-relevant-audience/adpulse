-- Saved widget library: agency-wide, reusable widget definitions.
--
-- A saved widget is ONE piece of data. Dashboard views reference it by id
-- (`widgets[].savedWidgetId`, with no inline config stored), so editing the
-- library entry changes every view that uses it. Deleting an entry detaches it
-- first (the config is materialized inline into every referencing view), so no
-- view is ever left pointing at a missing row.
--
-- Deliberately NOT client-scoped: the library is shared across every client the
-- agency manages, and the API is agency-only.

CREATE TABLE IF NOT EXISTS adpulse.saved_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  widget_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Names are the human handle for the library, so they are unique case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS saved_widgets_name_idx
  ON adpulse.saved_widgets (lower(name));

-- Usage lookups scan dashboards.widgets for `[{"savedWidgetId": "<id>"}]`
-- containment; a jsonb GIN index makes that an index scan.
CREATE INDEX IF NOT EXISTS dashboards_widgets_gin_idx
  ON adpulse.dashboards USING gin (widgets jsonb_path_ops);

-- RLS as defense in depth, matching every other adpulse table (the app is the
-- only client and authorizes in the route layer).
ALTER TABLE adpulse.saved_widgets ENABLE ROW LEVEL SECURITY;
