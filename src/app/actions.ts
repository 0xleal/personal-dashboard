"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  hashApiKey,
  generateApiKey,
  signJwt,
  createUser,
  deleteUser,
  lookupUser,
  claimInviteCode,
  SESSION_COOKIE,
  COOKIE_MAX_AGE,
} from "@/lib/auth";

export type AuthState = {
  error?: string;
  apiKey?: string;
} | null;

export async function register(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const username = formData.get("username") as string | null;
  const inviteCode = formData.get("invite_code") as string | null;

  if (!username?.trim() || !inviteCode?.trim()) {
    return { error: "Username and invite code are required" };
  }

  const trimmedUsername = username.trim().toLowerCase();

  if (!/^[a-z0-9_-]{3,30}$/.test(trimmedUsername)) {
    return {
      error:
        "Username must be 3-30 characters, lowercase letters, numbers, hyphens, or underscores",
    };
  }

  const rawKey = generateApiKey();
  const hash = await hashApiKey(rawKey);
  const user = await createUser(trimmedUsername, hash);

  if (!user) {
    return { error: "Username already taken" };
  }

  // Atomically claim invite code — if it fails, clean up the user
  const claimed = await claimInviteCode(inviteCode.trim(), user.id);
  if (!claimed) {
    await deleteUser(user.id);
    return { error: "Invalid or already used invite code" };
  }

  return { apiKey: rawKey };
}

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const username = formData.get("username") as string | null;
  const apiKey = formData.get("api_key") as string | null;

  if (!username?.trim() || !apiKey?.trim()) {
    return { error: "Username and API key are required" };
  }

  const user = await lookupUser(username.trim().toLowerCase());
  if (!user) {
    return { error: "Invalid credentials" };
  }

  const hash = await hashApiKey(apiKey.trim());
  if (hash !== user.api_key_hash) {
    return { error: "Invalid credentials" };
  }

  const jwt = await signJwt({ userId: user.id, username: username.trim().toLowerCase() });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/dashboard");
}

export async function logout(): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/");
}
