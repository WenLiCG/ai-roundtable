import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: Context) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;
  const db = getDb();
  const discussion = await db.discussion.findUnique({
    where: { id },
    include: {
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          responses: {
            orderBy: { startedAt: "asc" },
          },
        },
      },
    },
  });

  if (!discussion) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  return NextResponse.json({ discussion });
}
