-- View reports: a report created FROM a dashboard view.
--
-- `view_snapshot` is a FROZEN snapshot of one dashboard view — its layouts, its
-- widgets with fully inlined config (no `savedWidgetId`: a report must never
-- depend on the saved-widget library, whose rows can change or be deleted), and
-- every widget's computed data at the moment the report was created. The report
-- renderer reads only this column; it never re-queries `campaign_performance`
-- and never re-reads the source view, so the numbers on a report never move.
--
-- NULL = a classic (narrative + metrics_summary) report. Both kinds live in the
-- same table and share the same share-link flow.

ALTER TABLE adpulse.reports ADD COLUMN IF NOT EXISTS view_snapshot jsonb;
