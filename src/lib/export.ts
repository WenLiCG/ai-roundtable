import type { Discussion, DiscussionRound, ModelResponse } from "@/generated/prisma/client";

type DiscussionForExport = Discussion & {
  rounds: Array<DiscussionRound & { responses: ModelResponse[] }>;
};

export function discussionToMarkdown(discussion: DiscussionForExport) {
  const lines: string[] = [
    `# AI Roundtable: ${discussion.question.slice(0, 80)}`,
    "",
    `- 状态: ${discussion.status}`,
    `- 轮数上限: ${discussion.maxRounds}`,
    `- 创建时间: ${discussion.createdAt.toISOString()}`,
    "",
    "## 原始问题",
    "",
    discussion.question,
    "",
    "## 自定义多轮提示词",
    "",
    discussion.promptTemplate,
  ];

  for (const round of discussion.rounds) {
    lines.push("", `## 第 ${round.roundNumber} 轮`, "", "### 本轮发送给模型的提示词", "", round.prompt);

    if (round.stitchedContent) {
      lines.push("", "### 本轮成功回答的纯拼接整理", "", round.stitchedContent);
    }

    for (const response of round.responses) {
      lines.push(
        "",
        `### ${response.modelName} (${response.modelRef})`,
        "",
        `- 状态: ${response.status}`,
        `- 重试/尝试次数: ${response.attemptCount}`,
      );

      if (response.error) {
        lines.push(`- 错误: ${response.error}`);
      }

      lines.push("", response.content || "_无成功内容_");
    }
  }

  const finalRound = discussion.rounds.at(-1);
  if (finalRound) {
    lines.push("", "## 最后一轮各 AI 最终答案");

    for (const response of finalRound.responses) {
      lines.push(
        "",
        `### ${response.modelName} (${response.modelRef})`,
        "",
        response.status === "success" ? response.content : `_未成功: ${response.error ?? response.status}_`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

