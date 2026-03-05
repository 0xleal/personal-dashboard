# Claude Code Session Dashboard — Design

## Problem

Managing multiple concurrent Claude Code sessions (up to 5) is hard without visibility into which sessions are thinking, which need input, and which are idle.

## Solution

A Next.js web app deployed to Vercel that receives real-time events from Claude Code via HTTP hooks and displays session status on a dashboard. Designed to be kept open on a second screen or checked from a mobile phone.

## Architecture

```
Claude Code (local) --> HTTP Hooks --> Next.js API Routes (Vercel) --> SSE --> Browser
```

- Next.js App Router deployed to Vercel
- API routes receive hook events, store in-memory, push to SSE subscribers
- Claude Code hooks configured in `~/.claude/settings.json` as HTTP hooks with bearer token auth
- Simple shared secret for authentication (env var `DASHBOARD_SECRET`)

## Hook Events

| Hook Event | Purpose |
|---|---|
| `SessionStart` | Register session — capture session_id, cwd, model |
| `UserPromptSubmit` | Session is now "thinking" |
| `PreToolUse` | Update current activity (tool name) |
| `Notification` (matcher: `permission_prompt`) | Session needs user attention |
| `Stop` | Session is idle, finished responding |
| `SessionEnd` | Remove session from dashboard |

## Session States

- **Thinking** — processing a prompt or running tools
- **Needs Input** — permission prompt, waiting for user
- **Idle** — finished responding, waiting for next prompt

## Per-Session Display

- Status indicator (color-coded: green=thinking, amber=needs input, grey=idle)
- Project directory (last 2 path segments)
- Current activity (tool name, "Processing prompt...", "Waiting for permission")
- Model name
- Time in current state

## API Routes

- `POST /api/events` — receives hook events, authenticates via bearer token
- `GET /api/events/stream` — SSE endpoint for real-time browser updates
- `GET /api/sessions` — initial state load when dashboard opens

## Data Flow

1. Claude Code fires hook -> POST to `/api/events` with JSON payload
2. API route parses event, updates in-memory session map
3. SSE pushes update to all connected browsers
4. Dashboard re-renders affected session card

## Authentication

HTTP hooks support header interpolation with env vars:

```json
{
  "type": "http",
  "url": "https://dashboard.example.com/api/events",
  "headers": { "Authorization": "Bearer $DASHBOARD_SECRET" },
  "allowedEnvVars": ["DASHBOARD_SECRET"]
}
```

## Future Extensions

This is the foundation for a broader personal command center. Future integrations (Notion, GitHub, email) will add new data sources and dashboard panels. Architecture should remain simple but not prevent these additions.

## Storage

In-memory for now. Session state is ephemeral — if the server restarts, active sessions re-register on their next hook event. Persistence (SQLite or similar) will be added when historical data matters (e.g., for Notion/GitHub integrations).
