"use client";

import { useState, useEffect } from "react";
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

function TimeAgo({ timestamp }: { timestamp: number }) {
  const display = useTimeAgo(timestamp);
  return <span className="text-xs text-zinc-500">{display}</span>;
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
        <TimeAgo timestamp={session.statusChangedAt} />
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
