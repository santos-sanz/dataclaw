import assert from "node:assert/strict";
import test from "node:test";
import type { PlannerOutput, ToolExecutionAudit } from "@dataclaw/shared";
import { Executor } from "./executor.js";

function createPlan(command: string): PlannerOutput {
  return {
    intent: "test intent",
    language: "sql",
    command,
    requiresApproval: false,
    expectedShape: "table",
    explanationSeed: "Base explanation",
  };
}

function createSqlContext(overrides: Partial<Parameters<Executor["execute"]>[0]> = {}): Parameters<Executor["execute"]>[0] {
  const audits: ToolExecutionAudit[] = [];
  const base: Parameters<Executor["execute"]>[0] = {
    datasetId: "dataset_a",
    yolo: false,
    plan: createPlan("SELECT 1"),
    sourceTables: ["table_a"],
    memoryHintsUsed: [],
    approveCommand: async () => true,
    runSql: async () => "ok",
    runPython: async () => "python ok",
    saveLearning: async () => undefined,
    appendAudit: async (entry) => {
      audits.push(entry);
    },
  };

  return { ...base, ...overrides };
}

test("execute uses python fallback after SQL error and persists learning", async () => {
  const executor = new Executor();
  const savedLearnings: Array<{ symptom: string; command: string; language: "sql" | "python" }> = [];
  const audits: ToolExecutionAudit[] = [];
  let generatedFallback = "";

  const result = await executor.execute(
    createSqlContext({
      plan: createPlan("SELECT count(*) FROM missing_table"),
      runSql: async () => {
        throw new Error("Connection Error: Connection was never established or has been closed already.");
      },
      runPython: async (code) => {
        generatedFallback = code;
        return "fallback rows";
      },
      saveLearning: async (learning) => {
        savedLearnings.push({
          symptom: learning.symptom,
          command: learning.command,
          language: learning.language,
        });
      },
      appendAudit: async (entry) => {
        audits.push(entry);
      },
    }),
  );

  assert.equal(result.fallbackUsed, true);
  assert.equal(result.result, "fallback rows");
  assert.match(result.explanation, /SQL failed, so Python fallback was used/);
  assert.match(generatedFallback, /import duckdb/);
  assert.match(generatedFallback, /python3 -m pip install duckdb/);
  assert.equal(savedLearnings.length, 1);
  assert.match(savedLearnings[0].symptom, /SQL failed: Connection Error/);
  assert.equal(savedLearnings[0].language, "python");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].success, true);
});

test("execute surfaces SQL and fallback failures together", async () => {
  const executor = new Executor();
  const audits: ToolExecutionAudit[] = [];

  await assert.rejects(
    () =>
      executor.execute(
        createSqlContext({
          plan: createPlan("SELECT * FROM broken"),
          runSql: async () => {
            throw new Error("Connection Error: Connection was never established or has been closed already.");
          },
          runPython: async () => {
            throw new Error("ModuleNotFoundError: No module named 'duckdb'");
          },
          appendAudit: async (entry) => {
            audits.push(entry);
          },
        }),
      ),
    /SQL failed: Connection Error: Connection was never established or has been closed already\..*Python fallback also failed: ModuleNotFoundError: No module named 'duckdb'/s,
  );

  assert.equal(audits.length, 1);
  assert.equal(audits[0].success, false);
  assert.match(audits[0].error ?? "", /fallback failed/);
});
