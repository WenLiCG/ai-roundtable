import { NextResponse } from "next/server";
import { attachSessionCookie, verifyAccessPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loginSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const authenticated = await verifyAccessPassword(getDb(), input.password);

    if (!authenticated) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    attachSessionCookie(response);

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in." },
      { status: 400 },
    );
  }
}
