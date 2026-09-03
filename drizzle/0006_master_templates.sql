-- The MASTER template: exactly one dashboard template and one report template
-- are marked `is_master`, and they are the agency's house style.
--
-- Everything else about a template is unchanged (agency-wide, name-unique,
-- widgets in the stored/pointer form). What the flag adds is a single row per
-- kind that the app treats as the starting point:
--
--   * a client with no saved dashboard view renders the master dashboard
--     template instead of the hard-coded preset in
--     `src/lib/dashboard/default-preset.ts` (which is now only the SEED used to
--     create the master row the first time it is asked for);
--   * a new view / report layout can be stamped from the master by name
--     (`fromMaster`), without the UI having to know its id;
--   * the master's CONTENT is editable by the agency (the templates PUT), which
--     is how "change the house layout everywhere new" is done.
--
-- The partial unique index is the whole enforcement: at most one row per table
-- may have is_master = true, so "the master" is never ambiguous. Rows with
-- is_master = false are not covered by the index and stay unconstrained.

ALTER TABLE adpulse.dashboard_templates
  ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;

ALTER TABLE adpulse.report_templates
  ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_templates_master_idx
  ON adpulse.dashboard_templates (is_master) WHERE is_master;

CREATE UNIQUE INDEX IF NOT EXISTS report_templates_master_idx
  ON adpulse.report_templates (is_master) WHERE is_master;
