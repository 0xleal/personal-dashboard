"use client";

import { useState, useEffect } from "react";
import { Session } from "@/lib/types";

export function useSessions(): Session[] {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions");
        if (res.ok) setSessions(await res.json());
      } catch {
        // retry on next interval
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, []);

  return sessions;
}
