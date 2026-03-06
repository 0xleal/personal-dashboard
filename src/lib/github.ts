import { supabase } from "./supabase";
import {
  GitHubItem,
  GitHubItemRole,
  GitHubItemStatus,
  GitHubItemType,
  GitHubLabel,
  GitHubState,
  GitHubSyncStatus,
} from "./types";

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const ROLE_PRIORITY: Record<GitHubItemRole, number> = {
  reviewer: 0,
  assignee: 1,
  author: 2,
};

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

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

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

  return {
    accessToken: data.access_token as string,
    githubUsername: data.github_username as string,
  };
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
  });

  await supabase.from("github_sync").upsert({
    user_id: userId,
    status: "idle",
    last_synced_at: null,
    error_message: null,
  });
}

export async function deleteGitHubConnection(userId: string): Promise<void> {
  await supabase.from("github_items").delete().eq("user_id", userId);
  await supabase.from("github_sync").delete().eq("user_id", userId);
  await supabase.from("github_tokens").delete().eq("user_id", userId);
}

// --- Sync State ---

async function getSyncState(
  userId: string
): Promise<{
  lastSyncedAt: string | null;
  status: GitHubSyncStatus;
  errorMessage: string | null;
}> {
  const { data } = await supabase
    .from("github_sync")
    .select("last_synced_at, status, error_message")
    .eq("user_id", userId)
    .single();

  if (!data) {
    return { lastSyncedAt: null, status: "idle", errorMessage: null };
  }

  return {
    lastSyncedAt: data.last_synced_at as string | null,
    status: data.status as GitHubSyncStatus,
    errorMessage: data.error_message as string | null,
  };
}

function isStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > STALE_THRESHOLD_MS;
}

// --- GitHub API ---

export class TokenExpiredError extends Error {
  constructor() {
    super("GitHub token expired or revoked");
    this.name = "TokenExpiredError";
  }
}

async function fetchGitHubSearch(
  accessToken: string,
  query: string
): Promise<GitHubSearchItem[]> {
  const url = new URL("https://api.github.com/search/issues");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "100");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (response.status === 401) {
    throw new TokenExpiredError();
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data: GitHubSearchResponse = await response.json();
  return data.items;
}

function repoFullName(repositoryUrl: string): string {
  // https://api.github.com/repos/owner/name -> owner/name
  const parts = repositoryUrl.split("/repos/");
  return parts[1] ?? repositoryUrl;
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

  if (isReviewRequested) {
    roles.push("reviewer");
  }
  if (item.assignees.some((a) => a.login.toLowerCase() === username.toLowerCase())) {
    roles.push("assignee");
  }
  if (item.user.login.toLowerCase() === username.toLowerCase()) {
    roles.push("author");
  }

  if (roles.length === 0) {
    roles.push("author");
  }

  return roles;
}

// --- Sync Orchestration ---

export async function syncGitHubItems(userId: string): Promise<void> {
  const token = await getGitHubToken(userId);
  if (!token) return;

  const syncState = await getSyncState(userId);
  if (syncState.status === "syncing") return;

  await supabase
    .from("github_sync")
    .update({ status: "syncing", error_message: null })
    .eq("user_id", userId);

  try {
    const { accessToken, githubUsername } = token;

    const [prItems, issueItems, reviewRequestedItems] = await Promise.all([
      fetchGitHubSearch(
        accessToken,
        `is:pr is:open author:${githubUsername} OR assignee:${githubUsername} OR review-requested:${githubUsername}`
      ),
      fetchGitHubSearch(
        accessToken,
        `is:issue is:open author:${githubUsername} OR assignee:${githubUsername}`
      ),
      fetchGitHubSearch(
        accessToken,
        `is:pr is:open review-requested:${githubUsername}`
      ),
    ]);

    const reviewRequestedIds = new Set(reviewRequestedItems.map((i) => i.id));

    const rows: Record<string, unknown>[] = [];

    for (const item of prItems) {
      const roles = determineRoles(item, githubUsername, reviewRequestedIds.has(item.id));
      for (const role of roles) {
        rows.push(toItemRow(userId, item, "pr", role));
      }
    }

    for (const item of issueItems) {
      const roles = determineRoles(item, githubUsername, false);
      for (const role of roles) {
        rows.push(toItemRow(userId, item, "issue", role));
      }
    }

    await supabase.from("github_items").delete().eq("user_id", userId);

    if (rows.length > 0) {
      await supabase.from("github_items").insert(rows);
    }

    await supabase
      .from("github_sync")
      .update({
        status: "idle",
        last_synced_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("user_id", userId);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      await deleteGitHubConnection(userId);
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown sync error";
    await supabase
      .from("github_sync")
      .update({ status: "error", error_message: message })
      .eq("user_id", userId);
  }
}

function toItemRow(
  userId: string,
  item: GitHubSearchItem,
  type: GitHubItemType,
  role: GitHubItemRole
): Record<string, unknown> {
  return {
    user_id: userId,
    github_id: item.id,
    type,
    title: item.title,
    repo_full_name: repoFullName(item.repository_url),
    status: determineStatus(item),
    role,
    labels: item.labels.map((l) => ({ name: l.name, color: l.color })),
    html_url: item.html_url,
    comment_count: item.comments,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

// --- Read Cached Items ---

function fromItemRow(row: Record<string, unknown>): GitHubItem {
  return {
    id: row.id as string,
    githubId: row.github_id as number,
    type: row.type as GitHubItemType,
    title: row.title as string,
    repoFullName: row.repo_full_name as string,
    status: row.status as GitHubItemStatus,
    role: row.role as GitHubItemRole,
    labels: row.labels as GitHubLabel[],
    htmlUrl: row.html_url as string,
    commentCount: row.comment_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getGitHubItems(userId: string): Promise<GitHubState> {
  const token = await getGitHubToken(userId);
  if (!token) {
    return {
      connected: false,
      items: [],
      lastSyncedAt: null,
      syncStatus: "idle",
    };
  }

  const syncState = await getSyncState(userId);

  if (isStale(syncState.lastSyncedAt) && syncState.status !== "syncing") {
    await syncGitHubItems(userId);
    const refreshed = await getSyncState(userId);
    Object.assign(syncState, refreshed);
  }

  const { data } = await supabase
    .from("github_items")
    .select()
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const allItems = (data ?? []).map(fromItemRow);

  const deduped = new Map<number, GitHubItem>();
  for (const item of allItems) {
    const existing = deduped.get(item.githubId);
    if (!existing || ROLE_PRIORITY[item.role] < ROLE_PRIORITY[existing.role]) {
      deduped.set(item.githubId, item);
    }
  }

  return {
    connected: true,
    items: Array.from(deduped.values()),
    lastSyncedAt: syncState.lastSyncedAt,
    syncStatus: syncState.status,
    errorMessage: syncState.errorMessage ?? undefined,
  };
}
