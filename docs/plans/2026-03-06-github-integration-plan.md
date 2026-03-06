# GitHub Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub tab to the dashboard showing open issues and PRs where the user is author, assignee, or requested reviewer, using GitHub OAuth for authentication and Supabase for caching.

**Architecture:** GitHub OAuth App flow stores access tokens in Supabase. A sync mechanism fetches data from GitHub's Search API, caches results in `github_items` table, and serves from cache when fresh (<5 min). Dashboard gets a tab bar to switch between Sessions and GitHub views.

**Tech Stack:** Next.js 16 App Router, Supabase, GitHub REST API (Search endpoint), TypeScript strict mode

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/003_github.sql`

**Step 1: Create the migration file**

```sql
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
```

**Step 2: Run migration against Supabase**

Run the migration via the Supabase dashboard SQL editor or CLI:
```bash
npx supabase db push
```

**Step 3: Commit**

```bash
git add supabase/migrations/003_github.sql
git commit -m "add github integration tables"
```

---

### Task 2: GitHub Types

**Files:**
- Modify: `src/lib/types.ts`

**Step 1: Add GitHub types to the existing types file**

Append after the `HookEvent` interface:

```typescript
export type GitHubItemType = "pr" | "issue";

export type GitHubItemStatus = "open" | "closed" | "merged" | "draft";

export type GitHubItemRole = "author" | "assignee" | "reviewer";

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubItem {
  id: string;
  githubId: number;
  type: GitHubItemType;
  title: string;
  repoFullName: string;
  status: GitHubItemStatus;
  role: GitHubItemRole;
  labels: GitHubLabel[];
  htmlUrl: string;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export type GitHubSyncStatus = "idle" | "syncing" | "error";

export interface GitHubState {
  connected: boolean;
  items: GitHubItem[];
  lastSyncedAt: string | null;
  syncStatus: GitHubSyncStatus;
  errorMessage?: string;
}
```

**Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "add github item types"
```

---

### Task 3: GitHub Library — Token & Sync Logic

**Files:**
- Create: `src/lib/github.ts`

**Step 1: Create the GitHub library**

This file handles token CRUD, GitHub API calls, and sync orchestration. Reference the existing patterns in `src/lib/store.ts` and `src/lib/auth.ts` for Supabase usage.

```typescript
import { supabase } from "./supabase";
import type { GitHubItem, GitHubLabel, GitHubItemStatus } from "./types";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// --- Token Management ---

export async function getGitHubToken(
  userId: string
): Promise<{ accessToken: string; githubUsername: string } | null> {
  const { data } = await supabase
    .from("github_tokens")
    .select("access_token, github_username")
    .eq("user_id", userId)
    .single();
  if (!data) return null;
  return { accessToken: data.access_token, githubUsername: data.github_username };
}

export async function saveGitHubToken(
  userId: string,
  accessToken: string,
  githubUsername: string
): Promise<void> {
  await supabase.from("github_tokens").upsert({
    user_id: userId,
    access_token: accessToken,
    github_username: githubUsername,
    updated_at: new Date().toISOString(),
  });
  // Initialize sync state
  await supabase.from("github_sync").upsert({
    user_id: userId,
    status: "idle",
  });
}

export async function deleteGitHubConnection(userId: string): Promise<void> {
  await supabase.from("github_items").delete().eq("user_id", userId);
  await supabase.from("github_sync").delete().eq("user_id", userId);
  await supabase.from("github_tokens").delete().eq("user_id", userId);
}

// --- Sync State ---

interface SyncState {
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "error";
  errorMessage?: string;
}

async function getSyncState(userId: string): Promise<SyncState> {
  const { data } = await supabase
    .from("github_sync")
    .select("last_synced_at, status, error_message")
    .eq("user_id", userId)
    .single();
  if (!data) return { lastSyncedAt: null, status: "idle" };
  return {
    lastSyncedAt: data.last_synced_at,
    status: data.status,
    errorMessage: data.error_message ?? undefined,
  };
}

function isStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > STALE_THRESHOLD_MS;
}

// --- GitHub API ---

interface GitHubSearchItem {
  id: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  comments: number;
  created_at: string;
  updated_at: string;
  user: { login: string };
  assignees: { login: string }[];
  labels: { name: string; color: string }[];
  pull_request?: { merged_at: string | null };
  repository_url: string;
}

function repoFullName(repositoryUrl: string): string {
  // "https://api.github.com/repos/owner/name" -> "owner/name"
  const parts = repositoryUrl.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function determineStatus(item: GitHubSearchItem): GitHubItemStatus {
  if (item.pull_request?.merged_at) return "merged";
  if (item.draft) return "draft";
  if (item.state === "closed") return "closed";
  return "open";
}

function determineRoles(
  item: GitHubSearchItem,
  username: string,
  isReviewRequested: boolean
): GitHubItemRole[] {
  const roles: GitHubItemRole[] = [];
  if (isReviewRequested && item.pull_request) roles.push("reviewer");
  if (item.assignees.some((a) => a.login.toLowerCase() === username.toLowerCase())) roles.push("assignee");
  if (item.user.login.toLowerCase() === username.toLowerCase()) roles.push("author");
  return roles.length > 0 ? roles : ["author"];
}

async function fetchGitHubSearch(
  accessToken: string,
  query: string
): Promise<GitHubSearchItem[]> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (res.status === 401) {
    throw new TokenExpiredError();
  }

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.items ?? [];
}

export class TokenExpiredError extends Error {
  constructor() {
    super("GitHub token expired or revoked");
    this.name = "TokenExpiredError";
  }
}

// --- Sync Orchestration ---

export async function syncGitHubItems(userId: string): Promise<void> {
  const token = await getGitHubToken(userId);
  if (!token) return;

  const syncState = await getSyncState(userId);
  if (syncState.status === "syncing") return;

  // Mark as syncing
  await supabase
    .from("github_sync")
    .update({ status: "syncing", error_message: null })
    .eq("user_id", userId);

  try {
    const { accessToken, githubUsername } = token;

    // Fetch PRs and issues in parallel
    const [prItems, issueItems] = await Promise.all([
      fetchGitHubSearch(
        accessToken,
        `is:pr is:open author:${githubUsername} OR assignee:${githubUsername} OR review-requested:${githubUsername}`
      ),
      fetchGitHubSearch(
        accessToken,
        `is:issue is:open author:${githubUsername} OR assignee:${githubUsername}`
      ),
    ]);

    // Build rows
    const rows: {
      user_id: string;
      github_id: number;
      type: string;
      title: string;
      repo_full_name: string;
      status: string;
      role: string;
      labels: GitHubLabel[];
      html_url: string;
      comment_count: number;
      created_at: string;
      updated_at: string;
    }[] = [];

    // We need to know which items came from review-requested
    // Since GitHub search doesn't distinguish, we do a separate query
    const reviewRequestedIds = new Set<number>();
    const reviewItems = await fetchGitHubSearch(
      accessToken,
      `is:pr is:open review-requested:${githubUsername}`
    );
    for (const item of reviewItems) {
      reviewRequestedIds.add(item.id);
    }

    const processItems = (items: GitHubSearchItem[], type: "pr" | "issue") => {
      for (const item of items) {
        const isReviewRequested = reviewRequestedIds.has(item.id);
        const roles = determineRoles(item, githubUsername, isReviewRequested);
        const status = determineStatus(item);
        const labels = item.labels.map((l) => ({ name: l.name, color: l.color }));
        const repo = repoFullName(item.repository_url);

        for (const role of roles) {
          rows.push({
            user_id: userId,
            github_id: item.id,
            type,
            title: item.title,
            repo_full_name: repo,
            status,
            role,
            labels,
            html_url: item.html_url,
            comment_count: item.comments,
            created_at: item.created_at,
            updated_at: item.updated_at,
          });
        }
      }
    };

    processItems(prItems, "pr");
    processItems(issueItems, "issue");

    // Replace all cached items atomically
    await supabase.from("github_items").delete().eq("user_id", userId);
    if (rows.length > 0) {
      await supabase.from("github_items").insert(rows);
    }

    // Mark sync complete
    await supabase
      .from("github_sync")
      .update({ last_synced_at: new Date().toISOString(), status: "idle" })
      .eq("user_id", userId);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      // Token revoked — clean up
      await deleteGitHubConnection(userId);
      return;
    }

    await supabase
      .from("github_sync")
      .update({
        status: "error",
        error_message: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("user_id", userId);
  }
}

// --- Read Cached Items ---

export async function getGitHubItems(userId: string): Promise<{
  connected: boolean;
  items: GitHubItem[];
  lastSyncedAt: string | null;
  syncStatus: "idle" | "syncing" | "error";
  errorMessage?: string;
}> {
  const token = await getGitHubToken(userId);
  if (!token) {
    return { connected: false, items: [], lastSyncedAt: null, syncStatus: "idle" };
  }

  const syncState = await getSyncState(userId);

  // Auto-sync if stale
  if (isStale(syncState.lastSyncedAt) && syncState.status !== "syncing") {
    await syncGitHubItems(userId);
    // Re-read sync state after sync
    const updatedState = await getSyncState(userId);
    return {
      connected: true,
      items: await fetchCachedItems(userId),
      lastSyncedAt: updatedState.lastSyncedAt,
      syncStatus: updatedState.status,
      errorMessage: updatedState.errorMessage,
    };
  }

  return {
    connected: true,
    items: await fetchCachedItems(userId),
    lastSyncedAt: syncState.lastSyncedAt,
    syncStatus: syncState.status,
    errorMessage: syncState.errorMessage,
  };
}

async function fetchCachedItems(userId: string): Promise<GitHubItem[]> {
  const { data } = await supabase
    .from("github_items")
    .select()
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!data) return [];

  // Deduplicate by github_id, keeping highest-priority role
  const rolePriority: Record<string, number> = { reviewer: 3, assignee: 2, author: 1 };
  const seen = new Map<number, GitHubItem>();

  for (const row of data) {
    const item: GitHubItem = {
      id: row.id,
      githubId: row.github_id,
      type: row.type,
      title: row.title,
      repoFullName: row.repo_full_name,
      status: row.status,
      role: row.role,
      labels: row.labels as GitHubLabel[],
      htmlUrl: row.html_url,
      commentCount: row.comment_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const existing = seen.get(item.githubId);
    if (!existing || (rolePriority[item.role] ?? 0) > (rolePriority[existing.role] ?? 0)) {
      seen.set(item.githubId, item);
    }
  }

  return Array.from(seen.values());
}
```

**Step 2: Commit**

```bash
git add src/lib/github.ts
git commit -m "add github API client and sync logic"
```

---

### Task 4: OAuth Routes

**Files:**
- Create: `src/app/api/auth/github/route.ts`
- Create: `src/app/api/auth/github/callback/route.ts`

**Step 1: Create the OAuth initiation route**

`src/app/api/auth/github/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verify user is logged in
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Generate CSRF state
  const state = crypto.randomUUID();
  cookieStore.set("github_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/github/callback`,
    scope: "repo",
    state,
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
}
```

**Step 2: Create the OAuth callback route**

`src/app/api/auth/github/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { saveGitHubToken } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();

  // Verify user session
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const payload = await verifyJwt(sessionToken);
  if (!payload) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Validate CSRF state
  const state = request.nextUrl.searchParams.get("state");
  const storedState = cookieStore.get("github_oauth_state")?.value;
  cookieStore.delete("github_oauth_state");

  if (!state || state !== storedState) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=invalid_state", request.url));
  }

  // Exchange code for access token
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=no_code", request.url));
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=token_exchange", request.url));
  }

  // Fetch GitHub username
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!userRes.ok) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=user_fetch", request.url));
  }

  const userData = await userRes.json();

  // Store token
  await saveGitHubToken(payload.userId, tokenData.access_token, userData.login);

  return NextResponse.redirect(new URL("/dashboard?tab=github", request.url));
}
```

**Step 3: Commit**

```bash
git add src/app/api/auth/github/
git commit -m "add github OAuth routes"
```

---

### Task 5: GitHub API Routes

**Files:**
- Create: `src/app/api/github/items/route.ts`
- Create: `src/app/api/github/sync/route.ts`
- Create: `src/app/api/github/connection/route.ts`

**Step 1: Create the items route**

`src/app/api/github/items/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { getGitHubItems } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await getGitHubItems(payload.userId);
  return NextResponse.json(result);
}
```

**Step 2: Create the sync route**

`src/app/api/github/sync/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { syncGitHubItems, getGitHubToken } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const githubToken = await getGitHubToken(payload.userId);
  if (!githubToken) {
    return NextResponse.json({ error: "github not connected" }, { status: 400 });
  }

  await syncGitHubItems(payload.userId);
  return NextResponse.json({ ok: true });
}
```

**Step 3: Create the connection route**

`src/app/api/github/connection/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { deleteGitHubConnection } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await deleteGitHubConnection(payload.userId);
  return NextResponse.json({ ok: true });
}
```

**Step 4: Commit**

```bash
git add src/app/api/github/
git commit -m "add github items, sync, and connection API routes"
```

---

### Task 6: useGitHub Hook

**Files:**
- Create: `src/hooks/use-github.ts`

**Step 1: Create the hook**

Reference `src/hooks/use-sessions.ts` for the existing pattern. This hook fetches on mount, exposes sync/disconnect actions, and tracks loading state.

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import type { GitHubState } from "@/lib/types";

const INITIAL_STATE: GitHubState = {
  connected: false,
  items: [],
  lastSyncedAt: null,
  syncStatus: "idle",
};

export function useGitHub() {
  const [state, setState] = useState<GitHubState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/github/items");
      if (res.ok) {
        setState(await res.json());
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const sync = useCallback(async () => {
    setState((prev) => ({ ...prev, syncStatus: "syncing" }));
    try {
      await fetch("/api/github/sync", { method: "POST" });
      await fetchItems();
    } catch {
      setState((prev) => ({ ...prev, syncStatus: "error" }));
    }
  }, [fetchItems]);

  const disconnect = useCallback(async () => {
    await fetch("/api/github/connection", { method: "DELETE" });
    setState(INITIAL_STATE);
  }, []);

  return { ...state, loading, sync, disconnect };
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-github.ts
git commit -m "add useGitHub hook"
```

---

### Task 7: GitHub UI Components

**Files:**
- Create: `src/components/github-item-card.tsx`
- Create: `src/components/connect-github.tsx`
- Create: `src/components/github-tab.tsx`

**Step 1: Create the GitHub item card**

`src/components/github-item-card.tsx`:

Model after `src/components/session-card.tsx` for visual consistency. Same surface color, border, hover state. The card is an anchor tag linking to the GitHub URL.

```typescript
"use client";

import type { GitHubItem } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  open: "#22d3a0",
  draft: "#4a4f5c",
  merged: "#a78bfa",
  closed: "#f87171",
};

const ROLE_COLORS: Record<string, string> = {
  reviewer: "#f0a03c",
  assignee: "#60a5fa",
  author: "#6b7280",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function contrastColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function PrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
    </svg>
  );
}

export function GitHubItemCard({ item }: { item: GitHubItem }) {
  const statusColor = STATUS_COLORS[item.status] ?? STATUS_COLORS.open;
  const roleColor = ROLE_COLORS[item.role] ?? ROLE_COLORS.author;

  return (
    <a
      href={item.htmlUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border border-border bg-surface hover:border-border-subtle hover:bg-surface-raised transition-colors"
    >
      <div className="px-4 py-4">
        {/* Row 1: Icon + Title */}
        <div className="flex items-start gap-2 mb-2">
          <span className="text-text-secondary mt-0.5">
            {item.type === "pr" ? <PrIcon /> : <IssueIcon />}
          </span>
          <span className="text-[14px] font-medium text-text-primary leading-snug line-clamp-2">
            {item.title}
          </span>
        </div>

        {/* Row 2: Repo + Time */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-text-muted font-sans truncate">
            {item.repoFullName}
          </span>
          <span className="text-[11px] text-text-muted tabular-nums shrink-0 ml-2">
            {timeAgo(item.updatedAt)}
          </span>
        </div>

        {/* Row 3: Badges + Labels + Comments */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded font-sans font-medium"
            style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
          >
            {item.status}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded font-sans font-medium"
            style={{ backgroundColor: `${roleColor}20`, color: roleColor }}
          >
            {item.role}
          </span>
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="text-[10px] px-1.5 py-0.5 rounded font-sans"
              style={{
                backgroundColor: `#${label.color}`,
                color: contrastColor(label.color),
              }}
            >
              {label.name}
            </span>
          ))}
          {item.commentCount > 0 && (
            <span className="text-[11px] text-text-muted tabular-nums ml-auto flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
              </svg>
              {item.commentCount}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
```

**Step 2: Create the connect GitHub prompt**

`src/components/connect-github.tsx`:

```typescript
export function ConnectGitHub() {
  return (
    <div className="flex flex-col items-center justify-center py-24 animate-fade-up">
      <svg
        width="32"
        height="32"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="text-text-secondary mb-4"
      >
        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      <p className="text-[13px] text-text-secondary font-sans mb-1">
        Connect your GitHub account
      </p>
      <p className="text-[12px] text-text-muted font-sans mb-6">
        See your open issues and pull requests
      </p>
      <a
        href="/api/auth/github"
        className="text-[12px] uppercase tracking-[0.1em] px-4 py-2 rounded-md bg-surface border border-border hover:border-border-subtle hover:bg-surface-raised transition-colors font-sans font-medium text-text-primary"
      >
        Connect GitHub
      </a>
    </div>
  );
}
```

**Step 3: Create the GitHub tab component**

`src/components/github-tab.tsx`:

This component orchestrates the GitHub tab states: not connected, loading, syncing, data, error, empty.

```typescript
"use client";

import { useGitHub } from "@/hooks/use-github";
import { ConnectGitHub } from "@/components/connect-github";
import { GitHubItemCard } from "@/components/github-item-card";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 animate-pulse">
      <div className="h-4 bg-border rounded w-3/4 mb-3" />
      <div className="h-3 bg-border rounded w-1/2 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 bg-border rounded w-12" />
        <div className="h-4 bg-border rounded w-14" />
      </div>
    </div>
  );
}

export function GitHubTab() {
  const { connected, items, lastSyncedAt, syncStatus, errorMessage, loading, sync, disconnect } =
    useGitHub();

  if (loading) {
    return (
      <div className="grid gap-2 stagger">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!connected) {
    return <ConnectGitHub />;
  }

  const prs = items.filter((i) => i.type === "pr");
  const issues = items.filter((i) => i.type === "issue");
  const isSyncing = syncStatus === "syncing";

  return (
    <div className="animate-fade-up">
      {/* Sync header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-[11px] text-text-muted font-sans">
              Synced {timeAgo(lastSyncedAt)}
            </span>
          )}
          {syncStatus === "error" && (
            <span className="text-[11px] text-error font-sans">
              Sync failed{errorMessage ? `: ${errorMessage}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={sync}
            disabled={isSyncing}
            className="text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshIcon className={isSyncing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={disconnect}
            className="text-[11px] text-text-muted hover:text-error font-sans transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Pull Requests */}
      <div className="mb-6">
        <h2 className="text-[12px] uppercase tracking-[0.15em] text-text-muted font-sans mb-3">
          Pull Requests
          {prs.length > 0 && (
            <span className="ml-2 text-text-secondary">{prs.length}</span>
          )}
        </h2>
        {prs.length === 0 ? (
          <p className="text-[12px] text-text-muted font-sans py-4">
            No open pull requests
          </p>
        ) : (
          <div className="grid gap-2 stagger">
            {prs.map((item) => (
              <GitHubItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Issues */}
      <div>
        <h2 className="text-[12px] uppercase tracking-[0.15em] text-text-muted font-sans mb-3">
          Issues
          {issues.length > 0 && (
            <span className="ml-2 text-text-secondary">{issues.length}</span>
          )}
        </h2>
        {issues.length === 0 ? (
          <p className="text-[12px] text-text-muted font-sans py-4">
            No open issues
          </p>
        ) : (
          <div className="grid gap-2 stagger">
            {issues.map((item) => (
              <GitHubItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/components/github-item-card.tsx src/components/connect-github.tsx src/components/github-tab.tsx
git commit -m "add github tab UI components"
```

---

### Task 8: Dashboard Tab Bar

**Files:**
- Modify: `src/app/dashboard/dashboard-content.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Step 1: Update the dashboard page to pass the tab param**

`src/app/dashboard/page.tsx` — the page is a server component that reads the search param and passes it to the client component:

```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { DashboardContent } from "./dashboard-content";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/");

  const payload = await verifyJwt(token);
  if (!payload) redirect("/");

  const params = await searchParams;
  const tab = params.tab === "github" ? "github" : "sessions";

  return <DashboardContent username={payload.username} initialTab={tab} />;
}
```

**Step 2: Update DashboardContent with tab bar**

`src/app/dashboard/dashboard-content.tsx` — add a tab bar and conditionally render sessions vs GitHub content:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSessions } from "@/hooks/use-sessions";
import { SessionCard } from "@/components/session-card";
import { GitHubTab } from "@/components/github-tab";
import { logout } from "@/app/actions";

type Tab = "sessions" | "github";

export function DashboardContent({
  username,
  initialTab = "sessions",
}: {
  username: string;
  initialTab?: Tab;
}) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const sessions = useSessions();
  const router = useRouter();

  const activeCount = sessions.filter(
    (s) => s.status === "thinking" || s.status === "needs_input"
  ).length;

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/dashboard${tab === "github" ? "?tab=github" : ""}`, {
      scroll: false,
    });
  };

  return (
    <main className="min-h-screen bg-bg bg-grid relative">
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-transparent to-bg pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  activeCount > 0
                    ? "bg-status-thinking led-active"
                    : "bg-status-idle"
                }`}
                style={
                  activeCount > 0
                    ? { color: "var(--color-status-thinking)" }
                    : undefined
                }
              />
              <h1 className="text-[15px] font-medium text-text-primary">
                Dashboard
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-text-muted font-sans">
              {username}
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="text-[11px] uppercase tracking-[0.1em] text-text-muted hover:text-text-secondary font-sans transition-colors"
              >
                Exit
              </button>
            </form>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 mb-6 animate-fade-up border-b border-border">
          <button
            onClick={() => switchTab("sessions")}
            className={`text-[11px] uppercase tracking-[0.15em] font-sans px-3 py-2 -mb-px border-b-2 transition-colors ${
              activeTab === "sessions"
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            Sessions
            {activeCount > 0 && (
              <span className="ml-2 text-status-thinking">{activeCount}</span>
            )}
          </button>
          <button
            onClick={() => switchTab("github")}
            className={`text-[11px] uppercase tracking-[0.15em] font-sans px-3 py-2 -mb-px border-b-2 transition-colors ${
              activeTab === "github"
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            GitHub
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "sessions" ? (
          sessions.length === 0 ? (
            <div className="animate-fade-up flex flex-col items-center justify-center py-24">
              <div className="h-2 w-2 rounded-full bg-status-idle mb-4" />
              <p className="text-[13px] text-text-secondary font-sans mb-1">
                No active sessions
              </p>
              <p className="text-[12px] text-text-muted font-sans">
                Sessions will appear when hooks are configured
              </p>
            </div>
          ) : (
            <div className="grid gap-2 stagger">
              {sessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          )
        ) : (
          <GitHubTab />
        )}
      </div>
    </main>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/dashboard/
git commit -m "add tab bar to dashboard with sessions and github tabs"
```

---

### Task 9: CSS Additions

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Add spin animation and line-clamp utility**

Append to `src/app/globals.css` after the existing scrollbar styles:

```css
/* Spin animation for refresh button */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

/* Line clamp for truncating titles */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Pulse animation for skeleton loading */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}
```

**Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "add spin, line-clamp, and pulse animations"
```

---

### Task 10: Environment Variables & Build Verification

**Step 1: Add env vars to `.env.local`**

You need to create a GitHub OAuth App at https://github.com/settings/developers:
- Application name: Personal Dashboard
- Homepage URL: your deployed URL or http://localhost:3000
- Authorization callback URL: `{BASE_URL}/api/auth/github/callback`

Then add to `.env.local`:
```
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

**Step 2: Verify the build compiles**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

**Step 3: Manual smoke test**

1. Run `npm run dev`
2. Log in to the dashboard
3. Verify the tab bar shows "Sessions" and "GitHub"
4. Click "GitHub" tab — should show "Connect GitHub" prompt
5. Click "Connect GitHub" — should redirect to GitHub OAuth
6. After authorizing — should redirect back to dashboard with GitHub tab active
7. Should see your open PRs and issues
8. Click refresh button — should re-sync
9. Click "Disconnect" — should return to "Connect GitHub" state
10. Verify session tab still works as before

**Step 4: Final commit**

```bash
git add -A
git commit -m "add github integration to personal dashboard"
```
