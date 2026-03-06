import { SignJWT, jwtVerify } from "jose";
import { supabase } from "./supabase";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const SESSION_COOKIE = "session";

export interface JwtPayload {
  userId: string;
  username: string;
}

export async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(): string {
  return crypto.randomUUID();
}

export async function signJwt(payload: JwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      username: payload.username as string,
    };
  } catch {
    return null;
  }
}

export async function resolveUserFromApiKey(
  rawKey: string
): Promise<{ id: string; username: string } | null> {
  const hash = await hashApiKey(rawKey);
  const { data } = await supabase
    .from("users")
    .select("id, username")
    .eq("api_key_hash", hash)
    .single();
  return data;
}

export async function claimInviteCode(
  code: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("invite_codes")
    .update({ used_by: userId })
    .eq("code", code)
    .is("used_by", null)
    .select();
  return (data?.length ?? 0) > 0;
}

export async function createUser(
  username: string,
  apiKeyHash: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("users")
    .insert({ username, api_key_hash: apiKeyHash })
    .select("id")
    .single();
  if (error) return null;
  return data;
}

export async function deleteUser(userId: string): Promise<void> {
  await supabase.from("users").delete().eq("id", userId);
}

export async function lookupUser(
  username: string
): Promise<{ id: string; api_key_hash: string } | null> {
  const { data } = await supabase
    .from("users")
    .select("id, api_key_hash")
    .eq("username", username)
    .single();
  return data;
}

export { COOKIE_MAX_AGE };
