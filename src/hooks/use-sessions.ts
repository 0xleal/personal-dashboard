"use client";

import { useState, useEffect, useRef } from "react";
import { Session } from "@/lib/types";

export function useSessions(): Session[] {
  const [sessions, setSessions] = useState<Session[]>([]);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    function connect() {
      eventSource = new EventSource("/api/events/stream");

      eventSource.onmessage = (event) => {
        const data: Session[] = JSON.parse(event.data);
        setSessions(data);
      };

      eventSource.onerror = () => {
        eventSource?.close();
        retryTimeoutRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  return sessions;
}
