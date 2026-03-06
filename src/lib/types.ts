export interface User {
  id: string;
  username: string;
}

export type SessionStatus = "thinking" | "needs_input" | "idle" | "archived";

export interface Session {
  sessionId: string;
  status: SessionStatus;
  cwd: string;
  project: string;
  model: string;
  currentActivity: string;
  lastEventAt: number;
  statusChangedAt: number;
}

export interface HookEvent {
  session_id: string;
  cwd: string;
  hook_event_name:
    | "SessionStart"
    | "UserPromptSubmit"
    | "PreToolUse"
    | "Notification"
    | "Stop"
    | "SessionEnd";
  permission_mode?: string;
  transcript_path?: string;
  source?: string;
  model?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
}

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
