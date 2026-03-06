# GitHub Integration — Design

## Problem

The personal dashboard currently only shows Claude Code session status. To serve as a proper "what needs my attention" tool, it needs visibility into open work across other platforms — starting with GitHub issues and PRs.

## Solution

Add a GitHub tab to the dashboard that shows all open issues and PRs where the user is the author, assignee, or requested reviewer. Data is fetched via the GitHub Search API using an OAuth access token, cached in Supabase, and served from cache when fresh.

## Authentication

### GitHub OAuth App Flow

1. User clicks "Connect GitHub" button in the GitHub tab
2. Browser redirects to `https://github.com/login/oauth/authorize` with:
   - `client_id` (env: `GITHUB_CLIENT_ID`)
   - `redirect_uri`: `/api/auth/github/callback`
   - `scope`: `repo` (needed to search across private repos)
   - `state`: CSRF token stored in a short-lived cookie
3. GitHub redirects back to `/api/auth/github/callback?code=...&state=...`
4. Backend validates `state`, exchanges `code` for an access token via `POST https://github.com/login/oauth/access_token`
5. Backend fetches the user's GitHub username via `GET https://api.github.com/user`
6. Stores access token + GitHub username in `github_tokens` table
7. Redirects to `/dashboard` with the GitHub tab active

### Environment Variables

- `GITHUB_CLIENT_ID` — OAuth App client ID
- `GITHUB_CLIENT_SECRET` — OAuth App client secret

### Token Storage

Access tokens are stored in `github_tokens` alongside the user's GitHub username. Tokens are long-lived (no expiry unless revoked by the user on GitHub). If a token becomes invalid (401 from GitHub API), the row is deleted and the user is prompted to reconnect.

## Database Schema

### New Tables

```sql
-- GitHub OAuth tokens
create table github_tokens (
  user_id uuid primary key references users(id) on delete cascade,
  access_token text not null,
  github_username text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Cached GitHub items (issues and PRs)
create table github_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  github_id bigint not null,
  type text not null check (type in ('pr', 'issue')),
  title text not null,
  repo_full_name text not null,
  status text not null check (status in ('open', 'closed', 'merged', 'draft')),
  role text not null check (role in ('author', 'assignee', 'reviewer')),
  labels jsonb default '[]',
  html_url text not null,
  comment_count int default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, github_id, role)
);

create index idx_github_items_user on github_items(user_id);

-- Sync state tracking
create table github_sync (
  user_id uuid primary key references users(id) on delete cascade,
  last_synced_at timestamptz,
  status text not null default 'idle' check (status in ('idle', 'syncing', 'error')),
  error_message text
);
```

The `unique (user_id, github_id, role)` constraint allows the same item to appear with multiple roles (e.g., you authored a PR and are also assigned to it). The UI deduplicates by `github_id` and shows the most relevant role.

## Data Fetching

### GitHub Search API Queries

Two queries, run in parallel:

**PRs:**
```
GET https://api.github.com/search/issues?q=is:pr+is:open+author:{username}+OR+assignee:{username}+OR+review-requested:{username}&sort=updated&per_page=100
```

**Issues:**
```
GET https://api.github.com/search/issues?q=is:issue+is:open+author:{username}+OR+assignee:{username}&sort=updated&per_page=100
```

### Determining Status

- PRs: check `pull_request.merged_at` (merged), `draft` field (draft), `state` field (open/closed)
- Issues: `state` field (open/closed)

### Determining Role

Each query result is checked against the user's GitHub username:
- `author` if `item.user.login === username`
- `assignee` if username appears in `item.assignees`
- `reviewer` if the item came from the `review-requested:` qualifier (PRs only)

An item may have multiple roles. We insert one row per role, and the UI deduplicates by `github_id`, showing the highest-priority role: reviewer > assignee > author.

### Sync Logic

The sync is triggered via `POST /api/github/sync`:

1. Check `github_sync.status` — if already `syncing`, return early
2. Set status to `syncing`
3. Fetch both queries in parallel from GitHub API
4. Delete all existing `github_items` for the user
5. Insert fresh results
6. Update `github_sync`: set `last_synced_at` to now, status to `idle`
7. On error: set status to `error`, store message

### Staleness & Refresh

- **Staleness threshold:** 5 minutes
- **On tab load:** `GET /api/github/items` checks `github_sync.last_synced_at`. If older than 5 minutes, triggers a sync before returning data. If fresh, returns cached data immediately.
- **Manual refresh:** Button in the UI calls `POST /api/github/sync`, then refetches items.
- **Rate limits:** GitHub allows 5,000 requests/hour for authenticated users. Two search queries per sync means ~2,500 syncs/hour capacity — well within limits even with aggressive manual refreshing.

## API Routes

### `GET /api/auth/github`

Initiates the OAuth flow. Generates a random `state` value, stores it in a short-lived cookie, and redirects to GitHub's authorization URL.

### `GET /api/auth/github/callback`

Handles the OAuth callback. Validates state, exchanges code for token, fetches GitHub username, stores in DB, redirects to dashboard.

### `GET /api/github/items`

Returns cached GitHub items for the authenticated user. Triggers a sync if data is stale (>5 min). Response shape:

```json
{
  "items": [
    {
      "id": "uuid",
      "githubId": 12345,
      "type": "pr",
      "title": "Add GitHub integration",
      "repoFullName": "user/repo",
      "status": "open",
      "role": "author",
      "labels": [{"name": "feature", "color": "0075ca"}],
      "htmlUrl": "https://github.com/...",
      "commentCount": 3,
      "createdAt": "2026-03-01T...",
      "updatedAt": "2026-03-06T..."
    }
  ],
  "lastSyncedAt": "2026-03-06T12:00:00Z",
  "syncStatus": "idle",
  "connected": true
}
```

If no GitHub token exists for the user, returns `{ connected: false, items: [] }`.

### `POST /api/github/sync`

Triggers a manual sync. Returns `{ ok: true }` immediately if sync starts, or `{ ok: true, message: "already syncing" }` if one is in progress.

### `DELETE /api/github/connection`

Disconnects GitHub: deletes token, items, and sync state for the user. Returns `{ ok: true }`.

## UI Changes

### Dashboard Tab Bar

A tab bar at the top of the dashboard content area:

- **Sessions** (default) — existing session grid
- **GitHub** — GitHub items view

Tabs are URL-driven via query parameter (`/dashboard?tab=github`) so the active tab persists on refresh. The tab bar matches the existing dark theme with subtle underline indicator on the active tab.

### GitHub Tab — States

**Not connected:**
- Centered card with GitHub icon
- "Connect your GitHub account to see your open issues and pull requests"
- "Connect GitHub" button that navigates to `/api/auth/github`

**Connected, syncing (first load):**
- Skeleton card placeholders matching the item card layout
- "Syncing with GitHub..." text

**Connected, with data:**
- Header row: "Last synced 3m ago" + refresh button (circular arrow icon) + "Disconnect" link
- Two sections: "Pull Requests" (count) and "Issues" (count)
- Each section contains a grid of item cards
- Empty section shows "No open pull requests" / "No open issues"

**Error state:**
- Warning banner: "Failed to sync with GitHub. [Retry]"
- Stale cached data still shown below if available

### GitHub Item Card

Matches the `SessionCard` aesthetic — dark surface (`--color-surface`), subtle border, hover state:

```
+--------------------------------------------------+
| [PR icon]  Add GitHub integration to dashboard   |
| user/personal-dashboard          Updated 2h ago  |
|                                                   |
| [open]  [author]  [feature] [enhancement]    3   |
+--------------------------------------------------+
```

- **Row 1:** Type icon (git-pull-request or circle-dot) + title (truncated with ellipsis)
- **Row 2:** Repo full name (dimmed) + relative timestamp (dimmed, right-aligned)
- **Row 3:** Status badge + role badge + label chips + comment count icon
- Entire card is a link to `html_url` (opens in new tab)

### Badge Colors

| Status | Color |
|--------|-------|
| open | green (`#22d3a0`, matches "thinking" status) |
| draft | gray (`#4a4f5c`, matches "idle" status) |
| merged | purple (`#a78bfa`) |
| closed | red (`#f87171`) |

| Role | Color |
|------|-------|
| reviewer | orange (`#f0a03c`, matches "needs_input" — action needed) |
| assignee | blue (`#60a5fa`) |
| author | gray (`#6b7280`) |

Labels use their GitHub-provided hex color as background with automatic contrast text.

## File Structure

```
src/
  app/
    api/
      auth/github/route.ts          -- GET: initiate OAuth
      auth/github/callback/route.ts  -- GET: handle callback
      github/items/route.ts          -- GET: fetch cached items
      github/sync/route.ts           -- POST: trigger sync
      github/connection/route.ts     -- DELETE: disconnect
    dashboard/
      dashboard-content.tsx          -- add tab bar, tab routing
  components/
    github-item-card.tsx             -- individual item card
    github-tab.tsx                   -- GitHub tab content (states, sections)
    connect-github.tsx               -- "Connect GitHub" prompt
  hooks/
    use-github.ts                    -- fetch items, sync state, refresh
  lib/
    github.ts                        -- API client, sync logic, token management
supabase/
  migrations/
    003_github.sql                   -- new tables
```

## Security Considerations

- GitHub access tokens stored in plaintext in Supabase. For a personal dashboard this is acceptable. If sharing with others, consider encrypting at rest with a server-side key.
- OAuth `state` parameter validated to prevent CSRF.
- All GitHub API routes require valid session JWT (same as existing `/api/sessions`).
- Token revocation: if GitHub returns 401, delete the stored token and surface "reconnect" prompt.

## Future Extensions

- Webhook-based updates (GitHub App) instead of polling for real-time sync
- Filter/sort controls in the UI (by repo, label, role)
- Notification badges on the tab when new items appear
- Additional integrations (Linear, Jira) following the same pattern
