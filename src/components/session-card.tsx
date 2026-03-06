"use client";

import { useState, useEffect } from "react";
import { Session } from "@/lib/types";

const STATUS_CONFIG = {
  thinking: {
    label: "THINKING",
    color: "var(--color-status-thinking)",
    ledClass: "led-active",
    stripeClass: "stripe-active",
  },
  needs_input: {
    label: "NEEDS INPUT",
    color: "var(--color-status-input)",
    ledClass: "led-active",
    stripeClass: "stripe-active",
  },
  idle: {
    label: "IDLE",
    color: "var(--color-status-idle)",
    ledClass: "",
    stripeClass: "",
  },
  archived: {
    label: "ENDED",
    color: "var(--color-status-ended)",
    ledClass: "",
    stripeClass: "",
  },
} as const;

function useTimeAgo(timestamp: number): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function TimeAgo({ timestamp }: { timestamp: number }) {
  const display = useTimeAgo(timestamp);
  return <span className="text-[11px] text-text-muted tabular-nums">{display}</span>;
}

export function SessionCard({ session }: { session: Session }) {
  const config = STATUS_CONFIG[session.status];

  return (
    <div className="group relative rounded-lg border border-border bg-surface hover:border-border-subtle hover:bg-surface-raised transition-colors">
      {/* Status stripe */}
      <div
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${config.stripeClass}`}
        style={{ backgroundColor: config.color }}
      />

      <div className="pl-5 pr-4 py-4">
        {/* Header: status + time */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className={`h-[7px] w-[7px] rounded-full ${config.ledClass}`}
              style={{ backgroundColor: config.color, color: config.color }}
            />
            <span
              className="text-[10px] uppercase tracking-[0.15em] font-sans font-medium"
              style={{ color: config.color }}
            >
              {config.label}
            </span>
          </div>
          <TimeAgo timestamp={session.statusChangedAt} />
        </div>

        {/* Project name */}
        <div className="mb-1.5">
          <span className="text-[14px] font-medium text-text-primary">
            {session.project}
          </span>
        </div>

        {/* Activity */}
        <div className="text-[12px] text-text-secondary mb-2 font-sans">
          {session.currentActivity}
        </div>

        {/* Model */}
        <div className="text-[11px] text-text-muted">
          {session.model}
        </div>
      </div>
    </div>
  );
}
