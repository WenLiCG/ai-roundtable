import { NextResponse } from "next/server";
import { requireAuth, updateAccessPassword, verifyAccessPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { passwordChangeSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const input = passwordChangeSchema.parse(await request.json());
    const db = getDb();
    const currentPasswordMatches = await verifyAccessPassword(db, input.currentPassword);

    if (!currentPasswordMatches) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    await updateAccessPassword(db, input.newPassword);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update password." },
      { status: 400 },
    );
  }
}
