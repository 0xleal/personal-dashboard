import { supabase } from "./supabase";
import { Session, HookEvent } from "./types";

function extractProject(cwd: string): string {
  const segments = cwd.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function toRow(session: Session & { userId: string }) {
  return {
    session_id: session.sessionId,
    user_id: session.userId,
    status: session.status,
    cwd: session.cwd,
    project: session.project,
    model: session.model,
    current_activity: session.currentActivity,
    last_event_at: session.lastEventAt,
    status_changed_at: session.statusChangedAt,
  };
}

function fromRow(row: Record<string, unknown>): Session {
  return {
    sessionId: row.session_id as string,
    status: row.status as Session["status"],
    cwd: row.cwd as string,
    project: row.project as string,
    model: row.model as string,
    currentActivity: row.current_activity as string,
    lastEventAt: row.last_event_at as number,
    statusChangedAt: row.status_changed_at as number,
  };
}

async function upsertSession(
  sessionId: string,
  userId: string,
  updates: Partial<Omit<Session, "sessionId">>
): Promise<void> {
  const now = Date.now();
  const { data: existing } = await supabase
    .from("sessions")
    .select()
    .eq("session_id", sessionId)
    .single();

  if (existing) {
    const prev = fromRow(existing);
    const statusChanged = updates.status && updates.status !== prev.status;
    const merged = {
      ...prev,
      ...updates,
      sessionId,
      userId,
      lastEventAt: now,
      statusChangedAt: statusChanged ? now : prev.statusChangedAt,
    };
    await supabase
      .from("sessions")
      .update(toRow(merged))
      .eq("session_id", sessionId);
  } else {
    const session = {
      sessionId,
      userId,
      status: "idle" as const,
      cwd: "",
      project: "",
      model: "",
      currentActivity: "",
      lastEventAt: now,
      statusChangedAt: now,
      ...updates,
    };
    await supabase.from("sessions").insert(toRow(session));
  }
}

export async function processEvent(
  event: HookEvent,
  userId: string
): Promise<void> {
  const { session_id, hook_event_name, cwd } = event;
  const cwdUpdates = cwd ? { cwd, project: extractProject(cwd) } : {};

  switch (hook_event_name) {
    case "SessionStart":
      await upsertSession(session_id, userId, {
        ...cwdUpdates,
        model: event.model ?? "",
        status: "idle",
        currentActivity: "Session started",
      });
      break;

    case "UserPromptSubmit":
      await upsertSession(session_id, userId, {
        status: "thinking",
        currentActivity: "Processing prompt...",
        ...cwdUpdates,
      });
      break;

    case "PreToolUse":
      await upsertSession(session_id, userId, {
        status: "thinking",
        currentActivity: `Running ${event.tool_name ?? "tool"}`,
        ...cwdUpdates,
      });
      break;

    case "Notification":
      await upsertSession(session_id, userId, {
        status: "needs_input",
        currentActivity:
          event.notification_type === "permission_prompt"
            ? "Waiting for permission"
            : "Waiting for input",
        ...cwdUpdates,
      });
      break;

    case "Stop":
      await upsertSession(session_id, userId, {
        status: "needs_input",
        currentActivity: "Waiting for input",
        ...cwdUpdates,
      });
      break;

    case "SessionEnd":
      await upsertSession(session_id, userId, {
        status: "archived",
        currentActivity: "Session ended",
        ...cwdUpdates,
      });
      return;
  }
}

export async function getAllSessions(userId: string): Promise<Session[]> {
  const now = Date.now();
  const archivedThreshold = now - 24 * 60 * 60 * 1000;
  const staleThreshold = now - 30 * 60 * 1000;
  const thinkingStaleThreshold = now - 2 * 60 * 1000;

  await supabase
    .from("sessions")
    .delete()
    .eq("user_id", userId)
    .eq("status", "archived")
    .lt("last_event_at", archivedThreshold);

  await supabase
    .from("sessions")
    .delete()
    .eq("user_id", userId)
    .neq("status", "archived")
    .lt("last_event_at", staleThreshold);

  await supabase
    .from("sessions")
    .update({
      status: "needs_input",
      current_activity: "Waiting for input",
      status_changed_at: now,
    })
    .eq("user_id", userId)
    .eq("status", "thinking")
    .lt("last_event_at", thinkingStaleThreshold);

  const { data } = await supabase
    .from("sessions")
    .select()
    .eq("user_id", userId)
    .order("last_event_at", { ascending: false });

  return (data ?? []).map(fromRow);
}
