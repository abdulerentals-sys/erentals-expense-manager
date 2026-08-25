import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUserById } from "./store";
import { toPublicUser, type PublicUser } from "./types";

const cookieName = "erentals_session";
const encoder = new TextEncoder();
const maxAge = 60 * 60 * 12;

type SessionPayload = { userId: string; expiresAt: number };

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function authSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return secret;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(authSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

async function verifySignature(payload: string, supplied: string) {
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(authSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", key, base64UrlDecode(supplied), encoder.encode(payload));
  } catch {
    return false;
  }
}

export async function setSession(userId: string) {
  const payload = base64UrlEncode(JSON.stringify({ userId, expiresAt: Date.now() + maxAge * 1000 } satisfies SessionPayload));
  const value = `${payload}.${await signature(payload)}`;
  (await cookies()).set(cookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSession() {
  (await cookies()).set(cookieName, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function getSessionUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature || !(await verifySignature(payload, suppliedSignature))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as SessionPayload;
    if (!parsed.userId || parsed.expiresAt <= Date.now()) return null;
    const user = await findUserById(parsed.userId);
    return user?.status === "Active" ? toPublicUser(user) : null;
  } catch {
    return null;
  }
}

export async function requireDashboardUser(): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}
