import { describe, expect, it } from "vitest";
import { buildRoundPrompt, stitchResponses } from "@/lib/prompt";

describe("prompt helpers", () => {
  it("stitches successful response content without synthesizing a conclusion", () => {
    expect(
      stitchResponses([
        { modelName: "A", modelRef: "a-1", content: "first" },
        { modelName: "B", modelRef: "b-1", content: "second" },
      ]),
    ).toBe("## 参考 1\n\nfirst\n\n---\n\n## 参考 2\n\nsecond");
  });

  it("uses only the original question in round one", () => {
    expect(
      buildRoundPrompt({
        question: "What matters?",
        roundNumber: 1,
        promptTemplate: "reflect",
        previousStitchedContent: "ignored",
      }),
    ).toBe("What matters?");
  });

  it("adds the custom prompt and previous stitched content after round one", () => {
    const prompt = buildRoundPrompt({
      question: "Q",
      roundNumber: 2,
      promptTemplate: "参考如下信息",
      previousStitchedContent: "## A\nanswer",
    });

    expect(prompt).toContain("参考如下信息");
    expect(prompt).toContain("参考内容：\n## A\nanswer");
    expect(prompt).not.toContain("原始问题");
    expect(prompt).not.toContain("\nQ\n");
  });
});
