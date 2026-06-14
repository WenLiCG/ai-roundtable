import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { modelCreateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

function serializeModel(model: {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxInputChars: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: model.id,
    name: model.name,
    baseUrl: model.baseUrl,
    model: model.model,
    enabled: model.enabled,
    timeoutMs: model.timeoutMs,
    maxInputChars: model.maxInputChars,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function GET() {
  const db = getDb();
  const models = await db.aiModel.findMany({ orderBy: { createdAt: "asc" } });

  return NextResponse.json({ models: models.map(serializeModel) });
}

export async function POST(request: Request) {
  try {
    const input = modelCreateSchema.parse(await request.json());
    const encrypted = encryptSecret(input.apiKey);
    const db = getDb();

    const model = await db.aiModel.create({
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        enabled: input.enabled,
        timeoutMs: input.timeoutMs,
        maxInputChars: input.maxInputChars,
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
      },
    });

    return NextResponse.json({ model: serializeModel(model) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create model." },
      { status: 400 },
    );
  }
}

