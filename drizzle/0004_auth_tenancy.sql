-- Auth & tenancy — stage 1.
-- Adds user profiles (linked to Supabase auth.users) and per-client membership,
-- plus a share-link expiry column on reports (used in a later stage).
-- Additive: no drops, no data loss. Authorization is enforced app-layer (no RLS).

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  role text NOT NULL DEFAULT 'client_user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_role_check
    CHECK (role = ANY (ARRAY['agency_admin'::text, 'agency_member'::text, 'client_user'::text]))
);

CREATE TABLE IF NOT EXISTS client_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_members_role_check
    CHECK (role = ANY (ARRAY['viewer'::text]))
);

-- One membership per (user, client).
CREATE UNIQUE INDEX IF NOT EXISTS client_members_user_client_idx
  ON client_members (user_id, client_id);

CREATE INDEX IF NOT EXISTS client_members_client_idx
  ON client_members (client_id);

-- Share links gain an expiry timestamp (wired up in a later stage).
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
