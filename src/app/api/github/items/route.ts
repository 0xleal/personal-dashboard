import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { getGitHubItems } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await getGitHubItems(payload.userId);
  return NextResponse.json(result);
}
