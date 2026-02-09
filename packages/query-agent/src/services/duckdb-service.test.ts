import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DuckDbService } from "./duckdb-service.js";

test("DuckDbService opens a DB connection and returns tabular output", async () => {
  const root = mkdtempSync(join(tmpdir(), "dataclaw-duckdb-"));
  const dbPath = join(root, "sample.duckdb");
  const service = new DuckDbService(dbPath);

  await service.query("CREATE TABLE metrics AS SELECT 1 AS id, 'ok' AS status");
  const output = await service.query("SELECT id, status FROM metrics");

  assert.match(output, /^id\tstatus$/m);
  assert.match(output, /^1\tok$/m);
});

test("DuckDbService reports empty result sets as (no rows)", async () => {
  const root = mkdtempSync(join(tmpdir(), "dataclaw-duckdb-empty-"));
  const dbPath = join(root, "sample.duckdb");
  const service = new DuckDbService(dbPath);

  await service.query("CREATE TABLE events AS SELECT 1 AS id WHERE FALSE");
  const output = await service.query("SELECT * FROM events");

  assert.equal(output, "(no rows)");
});
