import { NextResponse } from "next/server";
import { cancelDiscussion } from "@/lib/discussion-cancel";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  const cancelledInMemory = cancelDiscussion(id);
  const db = getDb();

  await db.modelResponse.updateMany({
    where: {
      discussionId: id,
      status: { in: ["pending", "streaming"] },
    },
    data: {
      status: "cancelled",
      error: "Discussion cancelled by client.",
      completedAt: new Date(),
    },
  });

  await db.discussion.updateMany({
    where: { id, status: "running" },
    data: {
      status: "cancelled",
      error: "Discussion cancelled by client.",
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, cancelledInMemory });
}
