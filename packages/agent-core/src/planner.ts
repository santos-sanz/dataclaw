import { OpenRouterClient } from "@dataclaw/ai";
import type { DatasetManifest, PlannerOutput } from "@dataclaw/shared";
import { isMutatingSql } from "./security.js";

export interface PlannerContext {
  datasetId: string;
  prompt: string;
  manifest: DatasetManifest;
  memoryHints: string[];
}

const PLANNER_SYSTEM_PROMPT = `
You are DataClaw Planner.
Return only valid JSON with the shape:
{
  "intent": "string",
  "language": "sql" | "python",
  "command": "string",
  "requiresApproval": boolean,
  "expectedShape": "table" | "scalar" | "text",
  "explanationSeed": "string"
}
Rules:
- Prefer SQL.
- Use Python only if SQL is not suitable.
- If SQL mutates data, requiresApproval must be true.
- Never include markdown fences.
`;

export class Planner {
  constructor(private readonly client: OpenRouterClient) {}

  async createPlan(context: PlannerContext): Promise<PlannerOutput> {
    if (!this.client.isConfigured()) {
      return heuristicPlan(context.prompt);
    }

    const userPrompt = JSON.stringify(
      {
        datasetId: context.datasetId,
        prompt: context.prompt,
        manifest: context.manifest,
        memoryHints: context.memoryHints,
      },
      null,
      2,
    );

    const plan = await this.client.chatJson<PlannerOutput>([
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);

    if (plan.language === "sql" && plan.requiresApproval === false && isMutatingSql(plan.command)) {
      plan.requiresApproval = true;
    }

    return plan;
  }
}

function heuristicPlan(prompt: string): PlannerOutput {
  const lowered = prompt.toLowerCase();
  const likelyPython = ["plot", "chart", "visual", "complex", "clean"];
  if (likelyPython.some((token) => lowered.includes(token))) {
    return {
      intent: "Use Python fallback for complex analytics.",
      language: "python",
      command: "# Write pandas-compatible code that reads from DuckDB and returns a concise textual answer",
      requiresApproval: false,
      expectedShape: "text",
      explanationSeed: "Python fallback selected because the request looks analytical.",
    };
  }

  return {
    intent: "Run SQL query on canonical DuckDB dataset.",
    language: "sql",
    command: "SELECT * FROM main_table LIMIT 50;",
    requiresApproval: false,
    expectedShape: "table",
    explanationSeed: "Default SQL-first planning path.",
  };
}
