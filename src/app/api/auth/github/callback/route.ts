import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { saveGitHubToken } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();

  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const payload = await verifyJwt(sessionToken);
  if (!payload) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const state = request.nextUrl.searchParams.get("state");
  const storedState = cookieStore.get("github_oauth_state")?.value;
  cookieStore.delete("github_oauth_state");

  if (!state || state !== storedState) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=invalid_state", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=no_code", request.url));
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=token_exchange", request.url));
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!userRes.ok) {
    return NextResponse.redirect(new URL("/dashboard?tab=github&error=user_fetch", request.url));
  }

  const userData = await userRes.json();

  await saveGitHubToken(payload.userId, tokenData.access_token, userData.login);

  return NextResponse.redirect(new URL("/dashboard?tab=github", request.url));
}
