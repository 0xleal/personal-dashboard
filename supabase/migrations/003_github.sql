-- GitHub OAuth tokens
CREATE TABLE github_tokens (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  github_username text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Cached GitHub items (issues and PRs)
CREATE TABLE github_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_id       bigint NOT NULL,
  type            text NOT NULL CHECK (type IN ('pr', 'issue')),
  title           text NOT NULL,
  repo_full_name  text NOT NULL,
  status          text NOT NULL CHECK (status IN ('open', 'closed', 'merged', 'draft')),
  role            text NOT NULL CHECK (role IN ('author', 'assignee', 'reviewer')),
  labels          jsonb NOT NULL DEFAULT '[]',
  html_url        text NOT NULL,
  comment_count   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  UNIQUE (user_id, github_id, role)
);

CREATE INDEX idx_github_items_user ON github_items(user_id);

-- Sync state tracking
CREATE TABLE github_sync (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_synced_at  timestamptz,
  status          text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
  error_message   text
);
