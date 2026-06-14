export type StitchableResponse = {
  modelName: string;
  modelRef: string;
  content: string;
};

export function stitchResponses(responses: StitchableResponse[]) {
  return responses
    .filter((response) => response.content.trim().length > 0)
    .map((response, index) => {
      return [
        `## 参考 ${index + 1}`,
        "",
        response.content.trim(),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export function buildRoundPrompt(params: {
  question: string;
  roundNumber: number;
  promptTemplate: string;
  previousStitchedContent?: string | null;
}) {
  if (params.roundNumber === 1) {
    return params.question;
  }

  return [
    params.promptTemplate.trim(),
    "",
    "参考内容：",
    params.previousStitchedContent?.trim() || "上一轮没有可用的成功回答。",
  ].join("\n");
}
