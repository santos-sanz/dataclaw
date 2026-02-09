import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownMemoryService } from "./memory-service.js";

test("saveLearning writes daily markdown and deduplicates by fingerprint", async () => {
  const root = mkdtempSync(join(tmpdir(), "dataclaw-memory-"));
  const service = new MarkdownMemoryService(root);

  await service.saveLearning({
    datasetId: "dataset_a",
    symptom: "Type mismatch",
    rootCause: "Column is TEXT",
    fix: "Cast to INT",
    command: "SELECT CAST(x AS INT) FROM t",
    language: "sql",
  });

  await service.saveLearning({
    datasetId: "dataset_a",
    symptom: "Type mismatch",
    rootCause: "Column is TEXT",
    fix: "Cast to INT",
    command: "SELECT CAST(x AS INT) FROM t",
    language: "sql",
  });

  const today = new Date().toISOString().split("T")[0];
  const dailyPath = join(root, ".dataclaw", "datasets", "dataset_a", "memory", `${today}.md`);
  assert.equal(existsSync(dailyPath), true);

  const content = readFileSync(dailyPath, "utf-8");
  const count = content.split("## Learning ").length - 1;
  assert.equal(count, 1);
});

test("curate promotes learnings into curated memory file", async () => {
  const root = mkdtempSync(join(tmpdir(), "dataclaw-memory-curate-"));
  const service = new MarkdownMemoryService(root);

  await service.saveLearning({
    datasetId: "dataset_b",
    symptom: "SQL failed",
    rootCause: "Wrong date format",
    fix: "Use strptime",
    command: "SELECT strptime(x, '%Y-%m-%d') FROM t",
    language: "sql",
  });

  const fingerprints = await service.curate("dataset_b");
  assert.equal(fingerprints.length >= 1, true);

  const curatedPath = join(root, ".dataclaw", "datasets", "dataset_b", "MEMORY.md");
  const curated = readFileSync(curatedPath, "utf-8");
  assert.match(curated, /Curated Memory/);
});
