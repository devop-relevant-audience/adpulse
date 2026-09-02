-- Report builder: block-based report layouts + agency-wide report templates.
--
-- These mirror the dashboard system exactly, one level over:
--
--   adpulse.report_layouts   ~ adpulse.dashboards          (per-client, editable)
--   adpulse.report_templates ~ adpulse.dashboard_templates (agency-wide snapshot)
--
-- A report LAYOUT is the editable structure of a report for one client: the
-- same `layouts` (react-grid-layout) + `widgets` JSON a dashboard view holds,
-- in the same STORED form — an instance linked to `adpulse.saved_widgets` keeps
-- only its `{ i, type, savedWidgetId }` pointer and no inline config, so an
-- "agreed metric" widget stays in sync across dashboards AND reports. Generated
-- reports are unaffected by later edits: they freeze into `reports.view_snapshot`.
--
-- Unlike dashboards there is no `visibility` and no `is_default`: layouts are
-- agency-internal, full stop (the API is agency-only on every verb). What a
-- client sees is the generated report, through the existing reports list.

CREATE TABLE IF NOT EXISTS adpulse.report_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES adpulse.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  layouts jsonb NOT NULL,
  widgets jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Names are the human handle within a client's layout list (mirrors
-- dashboards_client_name_idx).
CREATE UNIQUE INDEX IF NOT EXISTS report_layouts_client_name_idx
  ON adpulse.report_layouts (client_id, name);

-- Saved-widget usage/detach scans widgets for `[{"savedWidgetId": "<id>"}]`
-- containment, same as dashboards.widgets.
CREATE INDEX IF NOT EXISTS report_layouts_widgets_gin_idx
  ON adpulse.report_layouts USING gin (widgets jsonb_path_ops);

-- Agency-wide report templates: a snapshot of one layout's structure, not tied
-- to any client, used to stamp the same report layout onto another client.
-- Mirrors adpulse.dashboard_templates exactly.
CREATE TABLE IF NOT EXISTS adpulse.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  layouts jsonb NOT NULL,
  widgets jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS report_templates_name_idx
  ON adpulse.report_templates (lower(name));

CREATE INDEX IF NOT EXISTS report_templates_widgets_gin_idx
  ON adpulse.report_templates USING gin (widgets jsonb_path_ops);

-- RLS as defense in depth, matching every other adpulse table (the app is the
-- only client and authorizes in the route layer).
ALTER TABLE adpulse.report_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE adpulse.report_templates ENABLE ROW LEVEL SECURITY;
