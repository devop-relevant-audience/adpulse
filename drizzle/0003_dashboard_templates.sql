-- Dashboard templates: agency-wide, reusable whole-view blueprints.
--
-- A template is a SNAPSHOT of one dashboard view's `layouts` + `widgets` taken
-- at save time — later edits to the source view do not touch the template. It
-- is deliberately NOT client-scoped: the point is to stamp the same view onto
-- any client ("create a view from this template"), so the API is agency-only.
--
-- `widgets` is stored in the same STORED form as `adpulse.dashboards.widgets`:
-- an instance linked to `adpulse.saved_widgets` keeps only its
-- `{ i, type, savedWidgetId }` pointer with no inline config. That is what keeps
-- an "agreed metric" widget in sync — a view created from a template is still
-- linked to the library row, and deleting that library row detaches templates
-- exactly the way it detaches views (config materialized inline first).

CREATE TABLE IF NOT EXISTS adpulse.dashboard_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  layouts jsonb NOT NULL,
  widgets jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Names are the human handle for the template list, so they are unique
-- case-insensitively (same rule as saved_widgets).
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_templates_name_idx
  ON adpulse.dashboard_templates (lower(name));

-- Saved-widget usage/detach scans templates.widgets for
-- `[{"savedWidgetId": "<id>"}]` containment, same as dashboards.widgets.
CREATE INDEX IF NOT EXISTS dashboard_templates_widgets_gin_idx
  ON adpulse.dashboard_templates USING gin (widgets jsonb_path_ops);

-- RLS as defense in depth, matching every other adpulse table (the app is the
-- only client and authorizes in the route layer).
ALTER TABLE adpulse.dashboard_templates ENABLE ROW LEVEL SECURITY;
