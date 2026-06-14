import type { AiModel } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { registerDiscussionController, unregisterDiscussionController } from "@/lib/discussion-cancel";
import type { RunEvent } from "@/lib/events";
import { callOpenAiCompatibleWithRetry } from "@/lib/openai-compatible";
import { buildRoundPrompt, stitchResponses } from "@/lib/prompt";
import type { RunDiscussionInput } from "@/lib/schemas";

type EventWriter = (event: RunEvent) => void | Promise<void>;

function publicModelSnapshot(model: AiModel) {
  return {
    id: model.id,
    name: model.name,
    baseUrl: model.baseUrl,
    model: model.model,
    timeoutMs: model.timeoutMs,
    maxInputChars: model.maxInputChars,
  };
}

function toCallableModel(model: AiModel) {
  return {
    name: model.name,
    baseUrl: model.baseUrl,
    apiKey: decryptSecret({
      ciphertext: model.apiKeyCiphertext,
      iv: model.apiKeyIv,
      authTag: model.apiKeyAuthTag,
    }),
    model: model.model,
    timeoutMs: model.timeoutMs,
    maxInputChars: model.maxInputChars,
  };
}

export async function runDiscussion(
  input: RunDiscussionInput,
  emit: EventWriter,
  signal?: AbortSignal,
) {
  const db = getDb();
  const discussionAbortController = new AbortController();
  const abortListener = () => discussionAbortController.abort("cancelled");
  signal?.addEventListener("abort", abortListener, { once: true });
  const models = await db.aiModel.findMany({
    where: {
      id: { in: input.modelIds },
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (models.length === 0) {
    throw new Error("No enabled models were found for this discussion.");
  }

  const discussion = await db.discussion.create({
    data: {
      question: input.question,
      maxRounds: input.maxRounds,
      promptTemplate: input.promptTemplate,
      selectedModelIds: models.map((model) => model.id),
      selectedModelsSnapshot: models.map(publicModelSnapshot),
      status: "running",
      startedAt: new Date(),
    },
  });

  await emit({ type: "discussion_created", discussionId: discussion.id });
  registerDiscussionController(discussion.id, discussionAbortController);

  let previousStitchedContent = "";

  try {
    for (let roundNumber = 1; roundNumber <= input.maxRounds; roundNumber += 1) {
      if (discussionAbortController.signal.aborted) {
        throw new DOMException("Discussion cancelled.", "AbortError");
      }

      const prompt = buildRoundPrompt({
        question: input.question,
        roundNumber,
        promptTemplate: input.promptTemplate,
        previousStitchedContent,
      });

      const round = await db.discussionRound.create({
        data: {
          discussionId: discussion.id,
          roundNumber,
          prompt,
        },
      });

      await emit({
        type: "round_started",
        discussionId: discussion.id,
        roundId: round.id,
        roundNumber,
        prompt,
      });

      const runModelForRound = async (model: AiModel) => {
          const responseRecord = await db.modelResponse.create({
            data: {
              discussionId: discussion.id,
              roundId: round.id,
              aiModelId: model.id,
              modelName: model.name,
              modelRef: model.model,
              status: "streaming",
            },
          });

          await emit({
            type: "model_started",
            discussionId: discussion.id,
            roundId: round.id,
            roundNumber,
            responseId: responseRecord.id,
            modelId: model.id,
            modelName: model.name,
            modelRef: model.model,
          });

          const result = await callOpenAiCompatibleWithRetry({
            model: toCallableModel(model),
            prompt,
            signal: discussionAbortController.signal,
            attempts: 2,
            onDelta: (delta) =>
              emit({
                type: "content_delta",
                discussionId: discussion.id,
                roundId: round.id,
                roundNumber,
                responseId: responseRecord.id,
                modelId: model.id,
                delta,
              }),
          });

          await db.modelResponse.update({
            where: { id: responseRecord.id },
            data: {
              status: result.status,
              content: result.content,
              error: result.error,
              attemptCount: result.attempts,
              latencyMs: result.latencyMs,
              completedAt: new Date(),
            },
          });

          await emit({
            type: "model_finished",
            discussionId: discussion.id,
            roundId: round.id,
            roundNumber,
            responseId: responseRecord.id,
            modelId: model.id,
            status: result.status,
            content: result.content,
            error: result.error,
            attempts: result.attempts,
            latencyMs: result.latencyMs,
          });

          return {
            modelName: model.name,
            modelRef: model.model,
            content: result.status === "success" ? result.content : "",
          };
        };

      const roundResults =
        input.executionMode === "sequential"
          ? []
          : await Promise.all(models.map((model) => runModelForRound(model)));

      if (input.executionMode === "sequential") {
        for (const model of models) {
          roundResults.push(await runModelForRound(model));
        }
      }

      previousStitchedContent = stitchResponses(roundResults);

      await db.discussionRound.update({
        where: { id: round.id },
        data: {
          stitchedContent: previousStitchedContent,
          completedAt: new Date(),
        },
      });

      await emit({
        type: "round_finished",
        discussionId: discussion.id,
        roundId: round.id,
        roundNumber,
        stitchedContent: previousStitchedContent,
      });
    }

    await db.discussion.update({
      where: { id: discussion.id },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });

    await emit({ type: "discussion_finished", discussionId: discussion.id, status: "completed" });
    return discussion.id;
  } catch (error) {
    const cancelled =
      discussionAbortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    const message = error instanceof Error ? error.message : "Unknown discussion runner error.";

    await db.discussion.update({
      where: { id: discussion.id },
      data: {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "Discussion cancelled by client." : message,
        completedAt: new Date(),
      },
    });

    if (cancelled) {
      await db.modelResponse.updateMany({
        where: {
          discussionId: discussion.id,
          status: { in: ["pending", "streaming"] },
        },
        data: {
          status: "cancelled",
          error: "Discussion cancelled by client.",
          completedAt: new Date(),
        },
      });
    }

    await emit({
      type: "discussion_finished",
      discussionId: discussion.id,
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Discussion cancelled by client." : message,
    });

    if (!cancelled) {
      throw error;
    }

    return discussion.id;
  } finally {
    signal?.removeEventListener("abort", abortListener);
    unregisterDiscussionController(discussion.id);
  }
}
