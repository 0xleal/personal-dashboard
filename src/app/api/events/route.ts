import { NextRequest, NextResponse } from "next/server";
import { processEvent } from "@/lib/store";
import { HookEvent } from "@/lib/types";
import { resolveUserFromApiKey } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await resolveUserFromApiKey(token);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const event: HookEvent = await request.json();

  if (!event.session_id || !event.hook_event_name) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  await processEvent(event, user.id);

  return NextResponse.json({ ok: true });
}
