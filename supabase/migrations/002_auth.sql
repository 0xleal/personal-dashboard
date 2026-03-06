-- Wipe existing sessions (fresh start for multi-user)
DELETE FROM sessions;

-- Users table
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text UNIQUE NOT NULL,
  api_key_hash text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Invite codes table
CREATE TABLE invite_codes (
  code       text PRIMARY KEY,
  used_by    uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add user_id to sessions
ALTER TABLE sessions
  ADD COLUMN user_id uuid NOT NULL REFERENCES users(id);

CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
