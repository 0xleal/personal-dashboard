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
