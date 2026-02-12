import test from "node:test";
import assert from "node:assert/strict";
import type { AskResult } from "@dataclaw/shared";
import { renderAskResult } from "./render.js";

function buildSampleAskResult(result: string): AskResult {
  return {
    plan: {
      intent: "Calcular metricas basicas",
      language: "sql",
      command: "SELECT 1;",
      requiresApproval: false,
      expectedShape: "table",
      explanationSeed: "Metricas basicas del dataset.",
    },
    command: "SELECT total, avg_age FROM train_and_test2_csv_0;",
    result,
    explanation: "Se calcularon totales y estadisticas principales.",
    sourceTables: ["train_and_test2_csv_0"],
    learningsUsed: [
      "# Global Memory\n\nThis file stores curated, long-lived learnings that apply across datasets.",
      "## Dataset memory\n- keep explanations concise",
    ],
    fallbackUsed: false,
  };
}

test("renderAskResult formats tabular result as readable ASCII table", () => {
  const output = renderAskResult(
    buildSampleAskResult([
      "total\tavg_age\ttasa_supervivencia_pct",
      "1309\t29.501\t26.13",
      "1400\t31.225\t27.5",
    ].join("\n")),
    { useColor: false, maxWidth: 80, maxColumnWidth: 24 },
  );

  assert.match(output, /\[RESULT\]/);
  assert.match(output, /\|\s+total\s+\|\s+avg_age\s+\|\s+tasa_supervivencia_pct\s+\|/);
  assert.match(output, /\|\s+1309\s+\|\s+29\.501\s+\|\s+26\.13\s+\|/);
  assert.match(output, /SOURCE TABLES/);
  assert.match(output, /LEARNINGS USED/);
});

test("renderAskResult keeps plain text results without table coercion", () => {
  const output = renderAskResult(
    buildSampleAskResult("Execution canceled: command was rejected by approval gate."),
    { useColor: false, maxWidth: 80 },
  );

  assert.match(output, /\[RESULT\]/);
  assert.match(output, /Execution canceled: command was rejected by approval gate\./);
  assert.doesNotMatch(output, /\|\s+-{3,}\s+\|/);
});

test("renderAskResult supports panel section style with Unicode borders", () => {
  const output = renderAskResult(
    buildSampleAskResult("status\tcount\nok\t10"),
    {
      useColor: false,
      maxWidth: 80,
      sectionStyle: "panel",
      useUnicodeBorders: true,
    },
  );

  assert.match(output, /┌/);
  assert.match(output, /│ \[RESULT\]/);
});

test("renderAskResult supports panel section style with ASCII borders", () => {
  const output = renderAskResult(
    buildSampleAskResult("status\tcount\nok\t10"),
    {
      useColor: false,
      maxWidth: 80,
      sectionStyle: "panel",
      useUnicodeBorders: false,
    },
  );

  assert.match(output, /\+/);
  assert.match(output, /\| \[RESULT\]/);
  assert.doesNotMatch(output, /┌|┐|└|┘|│/);
});

test("renderAskResult keeps table lines constrained with long cell values", () => {
  const output = renderAskResult(
    buildSampleAskResult(
      [
        "id\tdescription\tvalue",
        "1\tthis-is-a-very-long-description-value-that-should-be-truncated\t1000",
      ].join("\n"),
    ),
    {
      useColor: false,
      maxWidth: 70,
      maxColumnWidth: 18,
    },
  );

  const tableLines = output
    .split("\n")
    .filter((line) => line.startsWith("| "));

  assert.equal(tableLines.length > 0, true);
  assert.equal(tableLines.every((line) => line.length <= 70), true);
});
