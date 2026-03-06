"use client";

import { useState, useEffect, useCallback } from "react";
import type { GitHubState } from "@/lib/types";

const INITIAL_STATE: GitHubState = {
  connected: false,
  items: [],
  lastSyncedAt: null,
  syncStatus: "idle",
};

export function useGitHub() {
  const [state, setState] = useState<GitHubState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/github/items");
      if (res.ok) {
        setState(await res.json());
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const sync = useCallback(async () => {
    setState((prev) => ({ ...prev, syncStatus: "syncing" }));
    try {
      await fetch("/api/github/sync", { method: "POST" });
      await fetchItems();
    } catch {
      setState((prev) => ({ ...prev, syncStatus: "error" }));
    }
  }, [fetchItems]);

  const disconnect = useCallback(async () => {
    await fetch("/api/github/connection", { method: "DELETE" });
    setState(INITIAL_STATE);
  }, []);

  return { ...state, loading, sync, disconnect };
}
