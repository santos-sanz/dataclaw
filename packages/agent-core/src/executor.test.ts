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

function createPythonPlan(command: string): PlannerOutput {
  return {
    intent: "python test intent",
    language: "python",
    command,
    requiresApproval: false,
    expectedShape: "text",
    explanationSeed: "Python execution path.",
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

test("execute retries python plans when 'tables' is undefined", async () => {
  const executor = new Executor();
  const calls: string[] = [];
  const audits: ToolExecutionAudit[] = [];
  const savedLearnings: string[] = [];

  const result = await executor.execute(
    createSqlContext({
      plan: createPythonPlan("print(tables[0])"),
      runPython: async (code) => {
        calls.push(code);
        if (calls.length === 1) {
          throw new Error("Traceback (most recent call last):\n  File \"<string>\", line 6, in <module>\nNameError: name 'tables' is not defined");
        }
        return "table_a";
      },
      saveLearning: async (learning) => {
        savedLearnings.push(learning.symptom);
      },
      appendAudit: async (entry) => {
        audits.push(entry);
      },
    }),
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1], /^tables = \["table_a"\]/m);
  assert.match(calls[1], /^main_table = tables\[0\] if tables else None/m);
  assert.equal(result.result, "table_a");
  assert.equal(result.fallbackUsed, true);
  assert.match(result.explanation, /missing 'tables'/);
  assert.equal(savedLearnings.length, 1);
  assert.match(savedLearnings[0], /Python failed: .*NameError/s);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].success, true);
});

test("execute reports both python error and table-context retry error", async () => {
  const executor = new Executor();
  const audits: ToolExecutionAudit[] = [];
  let calls = 0;

  await assert.rejects(
    () =>
      executor.execute(
        createSqlContext({
          plan: createPythonPlan("print(tables[0])"),
          runPython: async () => {
            calls += 1;
            if (calls === 1) {
              throw new Error("NameError: name 'tables' is not defined");
            }
            throw new Error("SyntaxError: invalid syntax");
          },
          appendAudit: async (entry) => {
            audits.push(entry);
          },
        }),
      ),
    /Python failed: NameError: name 'tables' is not defined\. Table-context retry also failed: SyntaxError: invalid syntax/,
  );

  assert.equal(calls, 2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].success, false);
  assert.match(audits[0].error ?? "", /table-context retry failed/);
});
