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
