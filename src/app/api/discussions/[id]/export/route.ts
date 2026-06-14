import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { discussionToMarkdown } from "@/lib/export";
import { getDb } from "@/lib/db";
import { exportFormatSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;
  const format = exportFormatSchema.parse(new URL(request.url).searchParams.get("format") ?? "md");
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

  if (format === "json") {
    return NextResponse.json(discussion, {
      headers: {
        "Content-Disposition": `attachment; filename="discussion-${id}.json"`,
      },
    });
  }

  return new Response(discussionToMarkdown(discussion), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="discussion-${id}.md"`,
    },
  });
}
