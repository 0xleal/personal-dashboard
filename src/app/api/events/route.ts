import { NextRequest, NextResponse } from "next/server";
import { processEvent } from "@/lib/store";
import { HookEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const event: HookEvent = await request.json();

  if (!event.session_id || !event.hook_event_name) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  processEvent(event);

  return NextResponse.json({ ok: true });
}
