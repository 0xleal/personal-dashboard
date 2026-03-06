"use client";

import { useGitHub } from "@/hooks/use-github";
import { ConnectGitHub } from "@/components/connect-github";
import { GitHubItemCard } from "@/components/github-item-card";

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

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 animate-pulse">
      <div className="h-4 bg-border rounded w-3/4 mb-3" />
      <div className="h-3 bg-border rounded w-1/2 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 bg-border rounded w-12" />
        <div className="h-4 bg-border rounded w-14" />
      </div>
    </div>
  );
}

export function GitHubTab() {
  const { connected, items, lastSyncedAt, syncStatus, errorMessage, loading, sync, disconnect } =
    useGitHub();

  if (loading) {
    return (
      <div className="grid gap-2 stagger">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!connected) {
    return <ConnectGitHub />;
  }

  const prs = items.filter((i) => i.type === "pr");
  const issues = items.filter((i) => i.type === "issue");
  const isSyncing = syncStatus === "syncing";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-[11px] text-text-muted font-sans">
              Synced {timeAgo(lastSyncedAt)}
            </span>
          )}
          {syncStatus === "error" && (
            <span className="text-[11px] text-error font-sans">
              Sync failed{errorMessage ? `: ${errorMessage}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={sync}
            disabled={isSyncing}
            className="text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshIcon className={isSyncing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={disconnect}
            className="text-[11px] text-text-muted hover:text-error font-sans transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-[12px] uppercase tracking-[0.15em] text-text-muted font-sans mb-3">
          Pull Requests
          {prs.length > 0 && (
            <span className="ml-2 text-text-secondary">{prs.length}</span>
          )}
        </h2>
        {prs.length === 0 ? (
          <p className="text-[12px] text-text-muted font-sans py-4">
            No open pull requests
          </p>
        ) : (
          <div className="grid gap-2 stagger">
            {prs.map((item) => (
              <GitHubItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[12px] uppercase tracking-[0.15em] text-text-muted font-sans mb-3">
          Issues
          {issues.length > 0 && (
            <span className="ml-2 text-text-secondary">{issues.length}</span>
          )}
        </h2>
        {issues.length === 0 ? (
          <p className="text-[12px] text-text-muted font-sans py-4">
            No open issues
          </p>
        ) : (
          <div className="grid gap-2 stagger">
            {issues.map((item) => (
              <GitHubItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
