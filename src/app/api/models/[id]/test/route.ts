import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { callOpenAiCompatibleWithRetry } from "@/lib/openai-compatible";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;
  const db = getDb();
  const model = await db.aiModel.findUnique({ where: { id } });

  if (!model) {
    return NextResponse.json({ error: "Model not found." }, { status: 404 });
  }

  const result = await callOpenAiCompatibleWithRetry({
    model: {
      name: model.name,
      baseUrl: model.baseUrl,
      model: model.model,
      timeoutMs: Math.min(model.timeoutMs, 30_000),
      maxInputChars: model.maxInputChars,
      apiKey: decryptSecret({
        ciphertext: model.apiKeyCiphertext,
        iv: model.apiKeyIv,
        authTag: model.apiKeyAuthTag,
      }),
    },
    prompt: "Reply with a short OK if this connection works.",
    signal: request.signal,
    attempts: 1,
  });

  return NextResponse.json(result, { status: result.status === "success" ? 200 : 502 });
}
