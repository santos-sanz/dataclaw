import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatasetManifest } from "@dataclaw/shared";
import { buildFallbackModelPlan, ModelAgentService, normalizeAndValidateModelPlan } from "./model-agent-service.js";
import { DuckDbService } from "./duckdb-service.js";

function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "dataclaw-model-service-test-"));
  return fn(cwd).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
}

test("normalizeAndValidateModelPlan rejects forbidden SQL", () => {
  assert.throws(
    () =>
      normalizeAndValidateModelPlan(
        {
          sqlStatements: ["DROP TABLE users"],
        },
        {
          datasetId: "shop_dataset",
          selectedTables: ["customers"],
          selectedSchemas: [{ name: "customers", columns: [{ name: "id", type: "INTEGER" }] }],
          strategy: "llm",
        },
      ),
    /Forbidden SQL/,
  );
});

test("buildFallbackModelPlan infers join by *_id columns", () => {
  const plan = buildFallbackModelPlan({
    datasetId: "shop_dataset",
    selectedTables: ["customers", "orders"],
    selectedSchemas: [
      {
        name: "customers",
        columns: [
          { name: "id", type: "INTEGER" },
          { name: "name", type: "VARCHAR" },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "order_id", type: "INTEGER" },
          { name: "customer_id", type: "INTEGER" },
        ],
      },
    ],
    defaultModelViewName: "vw_shop_dataset_model",
    warning: "fallback",
  });

  assert.equal(plan.strategy, "fallback");
  assert.equal(plan.sqlStatements.some((statement) => statement.includes("LEFT JOIN")), true);
  assert.equal(plan.joinPlan.length >= 1, true);
  assert.equal(plan.joinPlan[0].confidence >= 0.8, true);
});

test("ModelAgentService buildModel writes artifacts and applies fallback SQL", async () => {
  await withTempCwd(async (cwd) => {
    const datasetId = "shop_dataset";
    const datasetRoot = join(cwd, ".dataclaw", "datasets", datasetId);
    const dbPath = join(datasetRoot, "canonical.duckdb");
    mkdirSync(datasetRoot, { recursive: true });

    const duck = new DuckDbService(dbPath);
    await duck.query("CREATE TABLE customers AS SELECT 1 AS id, 'Alice' AS name");
    await duck.query("CREATE TABLE orders AS SELECT 101 AS order_id, 1 AS customer_id, 42.0 AS total");

    const manifest: DatasetManifest = {
      id: datasetId,
      source: "owner/shop",
      createdAt: "2026-02-12T00:00:00Z",
      files: [],
      tables: [
        {
          name: "customers",
          originPath: "raw/customers.csv",
          columns: [
            { name: "id", type: "INTEGER" },
            { name: "name", type: "VARCHAR" },
          ],
        },
        {
          name: "orders",
          originPath: "raw/orders.csv",
          columns: [
            { name: "order_id", type: "INTEGER" },
            { name: "customer_id", type: "INTEGER" },
            { name: "total", type: "DOUBLE" },
          ],
        },
      ],
    };

    writeFileSync(join(datasetRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const service = new ModelAgentService(cwd, {
      client: {
        isConfigured: () => false,
        chatJson: async () => {
          throw new Error("not configured");
        },
      },
      approvalService: {
        ask: async () => true,
      },
    });

    const result = await service.buildModel({
      datasetId,
      selectedTables: ["customers", "orders"],
      yolo: true,
    });

    assert.equal(result.applied, true);
    assert.equal(existsSync(join(result.artifacts.outputDir, "model.sql")), true);
    assert.equal(existsSync(join(result.artifacts.outputDir, "components", "SchemaRenderer.tsx")), true);
    assert.equal(existsSync(join(result.artifacts.outputDir, "manifest.json")), true);

    const viewOutput = await duck.query(`SELECT * FROM ${result.plan.naming.modelView}`);
    assert.match(viewOutput, /customer_id/);

    const manifestOut = readFileSync(join(result.artifacts.outputDir, "manifest.json"), "utf-8");
    assert.match(manifestOut, /\"files\"/);
    assert.match(manifestOut, /\"sql:model\"/);
  });
});

test("ModelAgentService rejects model execution when approval is denied", async () => {
  await withTempCwd(async (cwd) => {
    const datasetId = "shop_dataset";
    const datasetRoot = join(cwd, ".dataclaw", "datasets", datasetId);
    const dbPath = join(datasetRoot, "canonical.duckdb");
    mkdirSync(datasetRoot, { recursive: true });

    const duck = new DuckDbService(dbPath);
    await duck.query("CREATE TABLE customers AS SELECT 1 AS id");

    const manifest: DatasetManifest = {
      id: datasetId,
      source: "owner/shop",
      createdAt: "2026-02-12T00:00:00Z",
      files: [],
      tables: [
        {
          name: "customers",
          originPath: "raw/customers.csv",
          columns: [{ name: "id", type: "INTEGER" }],
        },
      ],
    };

    writeFileSync(join(datasetRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const service = new ModelAgentService(cwd, {
      client: {
        isConfigured: () => false,
        chatJson: async () => {
          throw new Error("not configured");
        },
      },
      approvalService: {
        ask: async () => false,
      },
    });

    await assert.rejects(
      async () =>
        service.buildModel({
          datasetId,
          selectedTables: ["customers"],
          yolo: false,
        }),
      /rejected by approval gate/,
    );
  });
});
