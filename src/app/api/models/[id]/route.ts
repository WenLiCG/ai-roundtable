import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { modelUpdateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { id } = await context.params;
    const input = modelUpdateSchema.parse(await request.json());
    const db = getDb();
    const encrypted = input.apiKey ? encryptSecret(input.apiKey) : null;

    const model = await db.aiModel.update({
      where: { id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        enabled: input.enabled,
        timeoutMs: input.timeoutMs,
        maxInputChars: input.maxInputChars,
        ...(encrypted
          ? {
              apiKeyCiphertext: encrypted.ciphertext,
              apiKeyIv: encrypted.iv,
              apiKeyAuthTag: encrypted.authTag,
            }
          : {}),
      },
    });

    return NextResponse.json({
      model: {
        id: model.id,
        name: model.name,
        baseUrl: model.baseUrl,
        model: model.model,
        enabled: model.enabled,
        timeoutMs: model.timeoutMs,
        maxInputChars: model.maxInputChars,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update model." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const unauthorized = await requireAuth();

  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;
  const db = getDb();
  await db.aiModel.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
