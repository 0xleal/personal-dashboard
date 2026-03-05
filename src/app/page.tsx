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
