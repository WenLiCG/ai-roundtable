import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const discussions = await db.discussion.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      rounds: {
        select: { id: true },
      },
      responses: {
        select: { id: true, status: true },
      },
    },
  });

  return NextResponse.json({
    discussions: discussions.map((discussion) => ({
      id: discussion.id,
      question: discussion.question,
      status: discussion.status,
      maxRounds: discussion.maxRounds,
      createdAt: discussion.createdAt,
      completedAt: discussion.completedAt,
      roundCount: discussion.rounds.length,
      responseCount: discussion.responses.length,
      failedCount: discussion.responses.filter((response) => response.status !== "success").length,
    })),
  });
}

