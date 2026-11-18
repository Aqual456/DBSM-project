import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { compare } from "bcryptjs";
import { z } from "zod";
import { actor, body, checkOrigin, endpoint, hashToken, HttpError, transaction } from "@/lib/api";

const SESSION_SECONDS = 8 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
// Hash of a random string: compared when the e-mail is unknown so response time does not reveal accounts.
const DUMMY_HASH = "$2b$12$csgCpyo6jCP24eNkZGLR/uK9dx9fZjIwk.bw6B.wQYwmlBKng84BG";

const credentials = z.strictObject({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(1)
    .max(72)
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
});

export const GET = endpoint((req) => actor(req));

const login = endpoint(async (req: NextRequest) => {
  checkOrigin(req);
  const d = credentials.parse(await body(req));
  await transaction(async (c) => {
    await c.query("INSERT INTO login_attempts(email) VALUES ($1) ON CONFLICT DO NOTHING", [d.email]);
    const attempt = (await c.query("SELECT * FROM login_attempts WHERE email = $1 FOR UPDATE", [d.email])).rows[0];
    if (Date.now() - new Date(attempt.window_start).getTime() > WINDOW_MS)
      await c.query("UPDATE login_attempts SET attempts = 0, window_start = now() WHERE email = $1", [d.email]);
    else if (attempt.attempts >= MAX_ATTEMPTS)
      throw new HttpError(429, "Too many login attempts. Try again in 15 minutes", "RATE_LIMITED");
    await c.query("UPDATE login_attempts SET attempts = attempts + 1 WHERE email = $1", [d.email]);
  });
  const token = randomBytes(32).toString("hex");
  const ok = await transaction(async (c) => {
    const u = (
      await c.query("SELECT user_id, password_hash FROM app_users WHERE lower(email) = $1 AND is_active", [d.email])
    ).rows[0];
    const valid = await compare(d.password, u?.password_hash?.startsWith("$2") ? u.password_hash : DUMMY_HASH);
    if (!u || !valid) return false;
    await c.query("DELETE FROM login_attempts WHERE email = $1", [d.email]);
    await c.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [u.user_id]);
    await c.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '8 hours')", [
      hashToken(token),
      u.user_id,
    ]);
    return true;
  });
  if (!ok) throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  return NextResponse.json({ signedIn: true, token });
});

// The token is moved from the internal response into an httpOnly cookie; it never reaches client JS.
export async function POST(req: NextRequest) {
  const response = await login(req, undefined);
  const data = await response.json();
  if (!response.ok) return NextResponse.json(data, { status: response.status });
  const result = NextResponse.json({ signedIn: true });
  result.cookies.set("rf_session", data.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return result;
}

const logout = endpoint(async (req) => {
  checkOrigin(req);
  const token = req.cookies.get("rf_session")?.value;
  if (token) await transaction((c) => c.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]));
  return { signedOut: true };
});

export async function DELETE(req: NextRequest) {
  const response = await logout(req, undefined);
  if (response.ok) response.cookies.set("rf_session", "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
