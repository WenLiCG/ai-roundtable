export type RunEvent =
  | { type: "discussion_created"; discussionId: string }
  | { type: "round_started"; discussionId: string; roundId: string; roundNumber: number; prompt: string }
  | {
      type: "model_started";
      discussionId: string;
      roundId: string;
      roundNumber: number;
      responseId: string;
      modelId: string;
      modelName: string;
      modelRef: string;
    }
  | {
      type: "content_delta";
      discussionId: string;
      roundId: string;
      roundNumber: number;
      responseId: string;
      modelId: string;
      delta: string;
    }
  | {
      type: "model_finished";
      discussionId: string;
      roundId: string;
      roundNumber: number;
      responseId: string;
      modelId: string;
      status: "success" | "failed" | "timeout" | "cancelled";
      content: string;
      error?: string;
      attempts: number;
      latencyMs: number;
    }
  | {
      type: "round_finished";
      discussionId: string;
      roundId: string;
      roundNumber: number;
      stitchedContent: string;
    }
  | { type: "discussion_finished"; discussionId: string; status: "completed" | "cancelled" | "failed"; error?: string };

export function encodeRunEvent(event: RunEvent) {
  return `${JSON.stringify(event)}\n`;
}
