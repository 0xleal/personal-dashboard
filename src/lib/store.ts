import { Session, HookEvent } from "./types";

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

const STALE_TIMEOUT = 30 * 60 * 1000;

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
}, 60000);
