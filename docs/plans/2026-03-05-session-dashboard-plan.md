# Claude Code Session Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A real-time dashboard showing status of multiple concurrent Claude Code sessions, deployed to a public URL.

**Architecture:** Next.js App Router with API routes receiving HTTP hook events from Claude Code, in-memory session store, and SSE for real-time browser updates. Bearer token auth on the event ingestion endpoint.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS

**Deployment note:** Vercel serverless functions are stateless and can't hold in-memory state across invocations. This app needs a persistent process. Options: Railway, Fly.io, or local + Cloudflare Tunnel. The plan builds a standard Next.js app that works on any of these.

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `.gitignore`, `.env.local`

**Step 1: Initialize Next.js with TypeScript and Tailwind**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --turbopack
```

Accept defaults. This scaffolds into the current directory.

**Step 2: Add `.env.local` with the dashboard secret**

Create `.env.local`:
```
DASHBOARD_SECRET=local-dev-secret-change-me
```

**Step 3: Verify dev server starts**

Run: `npm run dev`
Expected: Server starts on http://localhost:3000

**Step 4: Commit**

```bash
git add -A
git commit -m "scaffold next.js project with typescript and tailwind"
```

---

### Task 2: Session store and types

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/store.ts`

**Step 1: Define types**

Create `src/lib/types.ts`:

```typescript
export type SessionStatus = "thinking" | "needs_input" | "idle";

export interface Session {
  sessionId: string;
  status: SessionStatus;
  cwd: string;
  project: string; // last 2 path segments of cwd
  model: string;
  currentActivity: string;
  lastEventAt: number; // timestamp ms
  statusChangedAt: number; // timestamp ms for "time in state"
}

export interface HookEvent {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
  transcript_path?: string;
  // SessionStart fields
  source?: string;
  model?: string;
  // UserPromptSubmit fields
  prompt?: string;
  // PreToolUse fields
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // Notification fields
  notification_type?: string;
}
```

**Step 2: Create in-memory store with SSE support**

Create `src/lib/store.ts`:

```typescript
import { Session, SessionStatus, HookEvent } from "./types";

type Listener = (sessions: Session[]) => void;

const sessions = new Map<string, Session>();
const listeners = new Set<Listener>();

function extractProject(cwd: string): string {
  const segments = cwd.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function updateSession(
  sessionId: string,
  updates: Partial<Omit<Session, "sessionId">>
): void {
  const existing = sessions.get(sessionId);
  const now = Date.now();

  if (existing) {
    const statusChanged = updates.status && updates.status !== existing.status;
    sessions.set(sessionId, {
      ...existing,
      ...updates,
      lastEventAt: now,
      statusChangedAt: statusChanged ? now : existing.statusChangedAt,
    });
  } else {
    sessions.set(sessionId, {
      sessionId,
      status: "idle",
      cwd: "",
      project: "",
      model: "",
      currentActivity: "",
      lastEventAt: now,
      statusChangedAt: now,
      ...updates,
    });
  }

  notifyListeners();
}

function notifyListeners(): void {
  const all = getAllSessions();
  for (const listener of listeners) {
    listener(all);
  }
}

export function processEvent(event: HookEvent): void {
  const { session_id, hook_event_name, cwd } = event;

  switch (hook_event_name) {
    case "SessionStart":
      updateSession(session_id, {
        cwd,
        project: extractProject(cwd),
        model: event.model ?? "",
        status: "idle",
        currentActivity: "Session started",
      });
      break;

    case "UserPromptSubmit":
      updateSession(session_id, {
        status: "thinking",
        currentActivity: "Processing prompt...",
        ...(cwd && { cwd, project: extractProject(cwd) }),
      });
      break;

    case "PreToolUse":
      updateSession(session_id, {
        status: "thinking",
        currentActivity: `Running ${event.tool_name ?? "tool"}`,
        ...(cwd && { cwd, project: extractProject(cwd) }),
      });
      break;

    case "Notification":
      if (event.notification_type === "permission_prompt") {
        updateSession(session_id, {
          status: "needs_input",
          currentActivity: "Waiting for permission",
          ...(cwd && { cwd, project: extractProject(cwd) }),
        });
      }
      break;

    case "Stop":
      updateSession(session_id, {
        status: "idle",
        currentActivity: "Finished",
        ...(cwd && { cwd, project: extractProject(cwd) }),
      });
      break;

    case "SessionEnd":
      sessions.delete(session_id);
      notifyListeners();
      return;
  }
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values()).sort(
    (a, b) => b.lastEventAt - a.lastEventAt
  );
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

**Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/store.ts
git commit -m "add session store and types for hook event processing"
```

---

### Task 3: Event ingestion API route

**Files:**
- Create: `src/app/api/events/route.ts`

**Step 1: Create POST /api/events**

Create `src/app/api/events/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { processEvent, getAllSessions } from "@/lib/store";
import { HookEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true; // no secret configured = open (dev mode)

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const event: HookEvent = await request.json();

  if (!event.session_id || !event.hook_event_name) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  processEvent(event);

  return NextResponse.json({ ok: true });
}
```

**Step 2: Verify with curl**

Run dev server, then:
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local-dev-secret-change-me" \
  -d '{"session_id":"test-1","hook_event_name":"SessionStart","cwd":"/Users/me/project","model":"claude-sonnet-4-6"}'
```
Expected: `{"ok":true}`

**Step 3: Commit**

```bash
git add src/app/api/events/route.ts
git commit -m "add event ingestion API route with bearer auth"
```

---

### Task 4: Sessions list and SSE stream API routes

**Files:**
- Create: `src/app/api/sessions/route.ts`
- Create: `src/app/api/events/stream/route.ts`

**Step 1: Create GET /api/sessions**

Create `src/app/api/sessions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAllSessions());
}
```

**Step 2: Create GET /api/events/stream (SSE)**

Create `src/app/api/events/stream/route.ts`:

```typescript
import { subscribe, getAllSessions } from "@/lib/store";
import { Session } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately
      const initial = getAllSessions();
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initial)}\n\n`)
      );

      // Subscribe to updates
      const unsubscribe = subscribe((sessions: Session[]) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(sessions)}\n\n`)
          );
        } catch {
          unsubscribe();
        }
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Step 3: Verify SSE works**

Run dev server, open two terminals:

Terminal 1 (listen):
```bash
curl -N http://localhost:3000/api/events/stream
```

Terminal 2 (send event):
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local-dev-secret-change-me" \
  -d '{"session_id":"test-1","hook_event_name":"UserPromptSubmit","cwd":"/Users/me/project","prompt":"hello"}'
```

Expected: Terminal 1 receives a new SSE data line with the updated session showing status "thinking".

**Step 4: Commit**

```bash
git add src/app/api/sessions/route.ts src/app/api/events/stream/route.ts
git commit -m "add sessions list and SSE stream API routes"
```

---

### Task 5: Dashboard UI

**Files:**
- Modify: `src/app/page.tsx` (replace scaffold)
- Modify: `src/app/layout.tsx` (update title/metadata)
- Create: `src/components/session-card.tsx`
- Create: `src/hooks/use-sessions.ts`

**Step 1: Create SSE hook**

Create `src/hooks/use-sessions.ts`:

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import { Session } from "@/lib/types";

export function useSessions(): Session[] {
  const [sessions, setSessions] = useState<Session[]>([]);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    function connect() {
      eventSource = new EventSource("/api/events/stream");

      eventSource.onmessage = (event) => {
        const data: Session[] = JSON.parse(event.data);
        setSessions(data);
      };

      eventSource.onerror = () => {
        eventSource?.close();
        retryTimeoutRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  return sessions;
}
```

**Step 2: Create session card component**

Create `src/components/session-card.tsx`:

```typescript
"use client";

import { Session } from "@/lib/types";

const STATUS_CONFIG = {
  thinking: {
    label: "Thinking",
    dotClass: "bg-emerald-400 animate-pulse",
    borderClass: "border-emerald-500/30",
    bgClass: "bg-emerald-500/5",
  },
  needs_input: {
    label: "Needs Input",
    dotClass: "bg-amber-400 animate-pulse",
    borderClass: "border-amber-500/30",
    bgClass: "bg-amber-500/5",
  },
  idle: {
    label: "Idle",
    dotClass: "bg-zinc-500",
    borderClass: "border-zinc-700/50",
    bgClass: "bg-zinc-500/5",
  },
} as const;

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function SessionCard({ session }: { session: Session }) {
  const config = STATUS_CONFIG[session.status];

  return (
    <div
      className={`rounded-lg border p-4 ${config.borderClass} ${config.bgClass}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
          <span className="text-sm font-medium text-zinc-300">
            {config.label}
          </span>
        </div>
        <span className="text-xs text-zinc-500">
          {timeAgo(session.statusChangedAt)}
        </span>
      </div>

      <div className="mb-1">
        <span className="text-sm font-mono text-zinc-400">
          {session.project}
        </span>
      </div>

      <div className="text-xs text-zinc-500 mb-2">{session.currentActivity}</div>

      <div className="text-xs text-zinc-600">{session.model}</div>
    </div>
  );
}
```

**Step 3: Update layout metadata**

Modify `src/app/layout.tsx` — update the metadata:

```typescript
export const metadata: Metadata = {
  title: "Dashboard",
  description: "Personal command center",
};
```

**Step 4: Build the dashboard page**

Replace `src/app/page.tsx`:

```typescript
"use client";

import { useSessions } from "@/hooks/use-sessions";
import { SessionCard } from "@/components/session-card";

export default function Home() {
  const sessions = useSessions();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-lg font-medium">Claude Sessions</h1>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                sessions.length > 0 ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            {sessions.length > 0
              ? `${sessions.length} active`
              : "No active sessions"}
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-20 text-zinc-600">
            <p className="text-sm">No active Claude Code sessions</p>
            <p className="text-xs mt-1">
              Sessions will appear here when Claude Code hooks are configured
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
```

**Step 5: Verify UI works**

Run dev server. Open http://localhost:3000 — should show empty state. Send a test event via curl, should see the session card appear in real-time.

**Step 6: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx src/components/session-card.tsx src/hooks/use-sessions.ts
git commit -m "add dashboard UI with real-time session cards via SSE"
```

---

### Task 6: Live timestamp updates

The "time in state" display needs to tick without waiting for SSE events.

**Files:**
- Modify: `src/components/session-card.tsx`

**Step 1: Add a ticking timer**

Add to `session-card.tsx` — replace the `timeAgo` usage with a hook:

```typescript
import { useState, useEffect } from "react";

function useTimeAgo(timestamp: number): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
```

Replace the `timeAgo(session.statusChangedAt)` call in the JSX with a component that uses this hook:

```typescript
function TimeAgo({ timestamp }: { timestamp: number }) {
  const display = useTimeAgo(timestamp);
  return <span className="text-xs text-zinc-500">{display}</span>;
}
```

And in `SessionCard` JSX, replace:
```typescript
<span className="text-xs text-zinc-500">
  {timeAgo(session.statusChangedAt)}
</span>
```
with:
```typescript
<TimeAgo timestamp={session.statusChangedAt} />
```

Remove the standalone `timeAgo` function.

**Step 2: Commit**

```bash
git add src/components/session-card.tsx
git commit -m "add live-ticking time-in-state display"
```

---

### Task 7: Claude Code hooks configuration

**Files:**
- Create: `src/app/api/health/route.ts`
- Create: `scripts/setup-hooks.sh`

**Step 1: Add health check endpoint**

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

**Step 2: Create setup script**

Create `scripts/setup-hooks.sh`:

```bash
#!/bin/bash
set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"
DASHBOARD_URL="${1:-http://localhost:3000}"

echo "Setting up Claude Code hooks for dashboard at: $DASHBOARD_URL"
echo ""
echo "This will add HTTP hooks to: $SETTINGS_FILE"
echo ""

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Generate the hooks config
HOOKS_CONFIG=$(cat <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "${DASHBOARD_URL}/api/events",
            "headers": { "Authorization": "Bearer \$DASHBOARD_SECRET" },
            "allowedEnvVars": ["DASHBOARD_SECRET"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
)

echo "Hooks configuration to merge into $SETTINGS_FILE:"
echo ""
echo "$HOOKS_CONFIG" | jq .
echo ""
echo "Please add the hooks section above to your $SETTINGS_FILE"
echo ""
echo "Also set the DASHBOARD_SECRET environment variable:"
echo "  export DASHBOARD_SECRET=your-secret-here"
```

**Step 3: Make script executable**

```bash
chmod +x scripts/setup-hooks.sh
```

**Step 4: Commit**

```bash
git add src/app/api/health/route.ts scripts/setup-hooks.sh
git commit -m "add health check endpoint and hooks setup script"
```

---

### Task 8: Handle Notification event field mapping

**Files:**
- Modify: `src/app/api/events/route.ts`

The Notification hook event sends the notification type in a field we need to map. Based on the hooks docs, the matcher matches on `notification_type`. We need to ensure the event includes this.

**Step 1: Add notification_type extraction**

The hook input for Notification events includes a `type` or `notification_type` field. Update the POST handler to normalize it:

```typescript
// After parsing the event, before processEvent:
if (event.hook_event_name === "Notification") {
  // The notification type comes from the matcher field
  // Ensure it's available for the store
  if (!event.notification_type) {
    event.notification_type = "unknown";
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/events/route.ts
git commit -m "normalize notification event fields"
```

---

### Task 9: End-to-end manual test

**No new files. Verification only.**

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Open dashboard**

Open http://localhost:3000 in browser. Should show empty state.

**Step 3: Simulate a full session lifecycle**

Run these curl commands in sequence:

```bash
SECRET="local-dev-secret-change-me"
URL="http://localhost:3000/api/events"

# Session starts
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-1","hook_event_name":"SessionStart","cwd":"/Users/me/workspace/my-project","model":"claude-sonnet-4-6","source":"startup"}'

# User sends prompt (should go to "thinking")
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-1","hook_event_name":"UserPromptSubmit","cwd":"/Users/me/workspace/my-project","prompt":"fix the bug"}'

# Tool use (should stay "thinking", update activity)
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-1","hook_event_name":"PreToolUse","cwd":"/Users/me/workspace/my-project","tool_name":"Read","tool_input":{"file_path":"src/main.ts"}}'

# Permission needed (should go to "needs input")
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-1","hook_event_name":"Notification","cwd":"/Users/me/workspace/my-project","notification_type":"permission_prompt"}'

# Second session starts
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-2","hook_event_name":"SessionStart","cwd":"/Users/me/workspace/other-project","model":"claude-opus-4-6","source":"startup"}'

# Stop (session 1 goes idle)
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-1","hook_event_name":"Stop","cwd":"/Users/me/workspace/my-project"}'

# Session ends (session 2 removed)
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $SECRET" \
  -d '{"session_id":"sess-2","hook_event_name":"SessionEnd","cwd":"/Users/me/workspace/other-project"}'
```

**Expected results at each step:**
1. One card appears: "my-project" — Idle
2. Card turns green: "Thinking" — "Processing prompt..."
3. Card stays green: "Thinking" — "Running Read"
4. Card turns amber: "Needs Input" — "Waiting for permission"
5. Second card appears: "other-project" — Idle
6. First card turns grey: "Idle" — "Finished"
7. Second card disappears

**Step 4: Final commit if any fixes were needed**

---

### Task 10: Stale session cleanup

Sessions that stop sending events (e.g., Claude Code crashed) should eventually disappear.

**Files:**
- Modify: `src/lib/store.ts`

**Step 1: Add cleanup interval**

Add to the bottom of `src/lib/store.ts`:

```typescript
const STALE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of sessions) {
    if (now - session.lastEventAt > STALE_TIMEOUT) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (changed) notifyListeners();
}, 60000); // check every minute
```

**Step 2: Commit**

```bash
git add src/lib/store.ts
git commit -m "clean up stale sessions after 30 minutes of inactivity"
```
