import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { attachSessionCookie } from "@/lib/auth";

process.env.APP_ENCRYPTION_KEY = "test-auth-cookie-secret";

describe("auth cookies", () => {
  it("does not mark the session cookie secure on plain http requests", () => {
    const response = NextResponse.json({ ok: true });
    const request = new Request("http://example.com/api/auth/login");

    attachSessionCookie(response, request);

    expect(response.headers.get("set-cookie")).toContain("ai_roundtable_session=");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("marks the session cookie secure on https requests", () => {
    const response = NextResponse.json({ ok: true });
    const request = new Request("https://example.com/api/auth/login");

    attachSessionCookie(response, request);

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
