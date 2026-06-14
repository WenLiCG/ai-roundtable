import { writeAppLog } from "@/lib/app-log";

export type OpenAiCompatibleModel = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxInputChars?: number | null;
};

export type ModelCallResult = {
  status: "success" | "failed" | "timeout" | "cancelled";
  content: string;
  error?: string;
  latencyMs: number;
};

export type ModelDeltaHandler = (delta: string) => void | Promise<void>;

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
};

type ParsedModelResponse = {
  content: string;
  rawPreview: string;
  sawSseData: boolean;
};

function normalizeChatCompletionUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

function parseError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "cancelled";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown model call error.";
}

function extractContentFromChunk(chunk: ChatCompletionChunk) {
  if (chunk.error?.message) {
    throw new Error(chunk.error.message);
  }

  return (
    chunk.choices?.[0]?.delta?.content ??
    chunk.choices?.[0]?.message?.content ??
    chunk.choices?.[0]?.text ??
    ""
  );
}

async function readModelResponse(
  body: ReadableStream<Uint8Array>,
  onDelta?: ModelDeltaHandler,
): Promise<ParsedModelResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let raw = "";
  let sawSseData = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    const text = decoder.decode(value, { stream: true });
    raw += text;
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      sawSseData = true;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }

      const chunk = JSON.parse(data) as ChatCompletionChunk;
      const delta = extractContentFromChunk(chunk);
      if (delta) {
        content += delta;
        await onDelta?.(delta);
      }
    }
  }

  if (buffer.trim().startsWith("data:")) {
    sawSseData = true;
    const data = buffer.trim().slice(5).trim();
    if (data && data !== "[DONE]") {
      const chunk = JSON.parse(data) as ChatCompletionChunk;
      const delta = extractContentFromChunk(chunk);
      if (delta) {
        content += delta;
        await onDelta?.(delta);
      }
    }
  }

  if (!content && !sawSseData && raw.trim()) {
    try {
      const json = JSON.parse(raw) as ChatCompletionChunk;
      const extracted = extractContentFromChunk(json);
      if (extracted) {
        content = extracted;
        await onDelta?.(extracted);
      }
    } catch {
      throw new Error(
        `Model endpoint returned non-JSON/non-SSE content. Check that baseUrl is an OpenAI-compatible API endpoint, not a website. raw=${raw.slice(
          0,
          300,
        )}`,
      );
    }
  }

  return {
    content,
    rawPreview: raw.slice(0, 600),
    sawSseData,
  };
}

export async function callOpenAiCompatible(params: {
  model: OpenAiCompatibleModel;
  prompt: string;
  signal?: AbortSignal;
  onDelta?: ModelDeltaHandler;
}): Promise<ModelCallResult> {
  const started = Date.now();

  if (
    params.model.maxInputChars &&
    params.prompt.length > params.model.maxInputChars
  ) {
    return {
      status: "failed",
      content: "",
      error: `Input length ${params.prompt.length} exceeds maxInputChars ${params.model.maxInputChars}.`,
      latencyMs: Date.now() - started,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), params.model.timeoutMs);

  const abortListener = () => controller.abort("cancelled");
  params.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    const url = normalizeChatCompletionUrl(params.model.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.model.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model.model,
        messages: [{ role: "user", content: params.prompt }],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      await writeAppLog("warn", "model_call_http_error", {
        modelName: params.model.name,
        modelRef: params.model.model,
        url,
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        latencyMs: Date.now() - started,
        bodyPreview: body.slice(0, 600),
      });
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    if (!response.body) {
      throw new Error("Model response did not include a readable body.");
    }

    const parsed = await readModelResponse(response.body, params.onDelta);
    const content = parsed.content;

    await writeAppLog(content.trim() ? "info" : "warn", "model_call_completed", {
      modelName: params.model.name,
      modelRef: params.model.model,
      url,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      sawSseData: parsed.sawSseData,
      contentLength: content.length,
      latencyMs: Date.now() - started,
      rawPreview: content.trim() ? undefined : parsed.rawPreview,
    });

    if (!content.trim()) {
      throw new Error(
        `Model returned HTTP 200 but no parseable content. content-type=${response.headers.get(
          "content-type",
        ) ?? "unknown"} raw=${parsed.rawPreview || "<empty>"}`,
      );
    }

    return {
      status: "success",
      content,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const reason = controller.signal.reason;
    const status: ModelCallResult["status"] =
      reason === "timeout"
        ? "timeout"
        : reason === "cancelled" || params.signal?.aborted
          ? "cancelled"
          : "failed";

    const result = {
      status,
      content: "",
      error: parseError(error),
      latencyMs: Date.now() - started,
    };

    await writeAppLog(status === "cancelled" ? "info" : "error", "model_call_failed", {
      modelName: params.model.name,
      modelRef: params.model.model,
      status,
      error: result.error,
      latencyMs: result.latencyMs,
    });

    return result;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abortListener);
  }
}

export async function callOpenAiCompatibleWithRetry(params: {
  model: OpenAiCompatibleModel;
  prompt: string;
  signal?: AbortSignal;
  onDelta?: ModelDeltaHandler;
  attempts?: number;
}) {
  const attempts = params.attempts ?? 2;
  let lastResult: ModelCallResult | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let attemptContent = "";
    const result = await callOpenAiCompatible({
      model: params.model,
      prompt: params.prompt,
      signal: params.signal,
      onDelta: async (delta) => {
        attemptContent += delta;
        await params.onDelta?.(delta);
      },
    });

    lastResult = result.status === "success" ? { ...result, content: result.content || attemptContent } : result;

    if (result.status === "success" || result.status === "cancelled") {
      return { ...lastResult, attempts: attempt };
    }
  }

  return {
    ...(lastResult ?? {
      status: "failed" as const,
      content: "",
      error: "Model call did not run.",
      latencyMs: 0,
    }),
    attempts,
  };
}
