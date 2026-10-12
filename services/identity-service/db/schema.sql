-- identity-service DDL (audit Step 2a) — derived ONLY from SQL in src/.
-- Apply AS identity_app (see README below). Idempotent.

CREATE TABLE IF NOT EXISTS users (
  id                  uuid PRIMARY KEY,
  email               text NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  full_name           text NOT NULL,
  hostel_block        text NOT NULL,
  hostel_group        text NOT NULL CHECK (hostel_group IN ('MH','LH')),
  room_number         text NOT NULL,
  upi_vpa             text,
  -- Simple email+password authn (no email verification). authorization is
  -- admin-side: role is flipped from the admin console's userbase page and
  -- is the source of the signed JWT `role` claim.
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  verification_status text NOT NULL DEFAULT 'VERIFIED' CHECK (verification_status IN ('PENDING','VERIFIED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash  text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id                      uuid PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint      text NOT NULL,
  ip_address              text,
  access_token            text,
  access_token_expires_at timestamptz,
  refresh_token_hash      text,
  refresh_token_expires_at timestamptz,
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','REFRESHED')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx     ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_refresh_idx     ON sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_ip_idx     ON sessions (user_id, ip_address) WHERE status = 'ACTIVE';

-- M1 fix (audit): rotation keeps status ACTIVE and rotates refresh_token_hash
-- in place; superseded hashes are remembered here so replaying an OLD token
-- is still detected (REUSED + revocation) while the CURRENT token can be
-- refreshed any number of times legitimately.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS superseded_refresh_hashes text[] NOT NULL DEFAULT '{}';

-- Removed (email-auth teardown): otp_challenges (2FA codes) and
-- users.verification_tokens (email verification links) no longer exist.
DROP TABLE IF EXISTS otp_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS verification_tokens;
ALTER TABLE users ALTER COLUMN verification_status SET DEFAULT 'VERIFIED';

-- Additive: contact phone number. Needed for the physical handover — the
-- seller sees the buyer's phone on the accepted-order delivery-details dialog.
-- Nullable: accounts created before this column simply have no number and the
-- owner supplies it from the profile dialog (PATCH /api/users/me).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
