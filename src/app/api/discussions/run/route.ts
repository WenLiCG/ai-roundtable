import { encodeRunEvent } from "@/lib/events";
import { runDiscussion } from "@/lib/discussion-runner";
import { runDiscussionSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const input = runDiscussionSchema.parse(await request.json());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runDiscussion(
          input,
          (event) => controller.enqueue(encoder.encode(encodeRunEvent(event))),
          request.signal,
        );
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            encodeRunEvent({
              type: "discussion_finished",
              discussionId: "unknown",
              status: "failed",
              error: error instanceof Error ? error.message : "Unable to run discussion.",
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

