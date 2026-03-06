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
        <div className="flex items-start gap-2 mb-2">
          <span className="text-text-secondary mt-0.5">
            {item.type === "pr" ? <PrIcon /> : <IssueIcon />}
          </span>
          <span className="text-[14px] font-medium text-text-primary leading-snug line-clamp-2">
            {item.title}
          </span>
        </div>

        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-text-muted font-sans truncate">
            {item.repoFullName}
          </span>
          <span className="text-[11px] text-text-muted tabular-nums shrink-0 ml-2">
            {timeAgo(item.updatedAt)}
          </span>
        </div>

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
