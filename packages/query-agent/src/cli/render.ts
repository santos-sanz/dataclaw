import type { AskResult } from "@dataclaw/shared";

export function renderAskResult(result: AskResult): string {
  return [
    "PLAN",
    JSON.stringify(result.plan, null, 2),
    "COMMAND",
    result.command,
    "RESULT",
    result.result,
    "EXPLANATION",
    result.explanation,
    "SOURCE_TABLES",
    result.sourceTables.join(", ") || "(none)",
    "LEARNINGS_USED",
    result.learningsUsed.join(", ") || "(none)",
  ].join("\n");
}
