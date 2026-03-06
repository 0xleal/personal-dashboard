import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const payload = await verifyJwt(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const state = crypto.randomUUID();
  cookieStore.set("github_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/github/callback`,
    scope: "repo",
    state,
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
}
