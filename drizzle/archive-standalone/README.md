# Archived: standalone-project migrations

These files are the migration history of AdPulse's ORIGINAL standalone Supabase
project (own `public` schema, Supabase Auth). That project was abandoned when
AdPulse moved into the shared Atlas Supabase project (dedicated `adpulse`
schema, shared Clerk auth) — see `../0000_shared_baseline.sql`, which
consolidates the final state of this history minus the Supabase-Auth tables
(`user_profiles`, `client_members`).

The migration runner only picks up `drizzle/*.sql` (not this subdirectory).
Never apply these files to the shared project.
