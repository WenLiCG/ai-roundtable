import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";

const COOKIE_NAME = "ai_roundtable_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_SETTING_KEY = "access_password_hash";
const DEFAULT_PASSWORD = "admin";
const HASH_ITERATIONS = 210_000;

type SessionPayload = {
  exp: number;
  iat: number;
};

function getSigningSecret() {
  const secret = process.env.APP_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY is required for authentication.");
  }

  return secret;
}

function toBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, 32, "sha256").toString("base64url");

  return `pbkdf2_sha256$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsText, salt, expectedHash] = storedHash.split("$");

  if (algorithm !== "pbkdf2_sha256" || !iterationsText || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsText);

  if (!Number.isInteger(iterations) || iterations < 1) {
    return false;
  }

  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");

  return safeEqual(hash, expectedHash);
}

export async function verifyAccessPassword(db: PrismaClient, password: string) {
  const setting = await db.appSetting.findUnique({ where: { key: PASSWORD_SETTING_KEY } });

  if (!setting) {
    return password === DEFAULT_PASSWORD;
  }

  return verifyPassword(password, setting.value);
}

export async function updateAccessPassword(db: PrismaClient, password: string) {
  await db.appSetting.upsert({
    where: { key: PASSWORD_SETTING_KEY },
    create: {
      key: PASSWORD_SETTING_KEY,
      value: hashPassword(password),
    },
    update: {
      value: hashPassword(password),
    },
  });
}

function createSessionValue() {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function verifySessionValue(value?: string) {
  if (!value) {
    return false;
  }

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature || !safeEqual(sign(encodedPayload), signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;

    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function isAuthenticated() {
  const cookieStore = await cookies();

  return verifySessionValue(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireAuth() {
  if (await isAuthenticated()) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export function attachSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: createSessionValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
