import assert from "node:assert/strict";
import test from "node:test";
import type { ModelBuildResult } from "@dataclaw/shared";
import {
  normalizeInteractiveDatasetInput,
  normalizeInteractiveModelInput,
  runModelBuildCommand,
  runModelWebCommand,
} from "./program.js";

function createResult(): ModelBuildResult {
  return {
    request: {
      datasetId: "shop_dataset",
      selectedTables: ["customers"],
      yolo: true,
    },
    plan: {
      strategy: "fallback",
      sqlStatements: ["CREATE OR REPLACE VIEW vw_customers_base AS SELECT * FROM customers"],
      joinPlan: [],
      componentBlueprint: {
        rendererName: "SchemaRenderer",
        rendererDescription: "Renderer",
        themeName: "editorial-data-cockpit",
        styleDirection: "Editorial data cockpit",
        tableComponents: [
          {
            tableName: "customers",
            componentName: "TableCustomers",
            purpose: "Render customers",
          },
        ],
      },
      naming: {
        modelView: "vw_shop_dataset_model",
        baseViews: {
          customers: "vw_customers_base",
        },
      },
      assumptions: [],
      warnings: [],
    },
    artifacts: {
      runId: "2026-02-12T19-00-00-000Z",
      outputDir: "/tmp/dataclaw-model",
      files: [
        {
          id: "sql:model",
          kind: "sql",
          path: "/tmp/dataclaw-model/model.sql",
          description: "Model SQL script",
        },
      ],
    },
    applied: true,
    previewItems: [
      {
        id: "overview",
        title: "Build overview",
        kind: "overview",
        content: "ok",
      },
    ],
  };
}

test("runModelBuildCommand requires interactive TTY", async () => {
  await assert.rejects(
    async () =>
      runModelBuildCommand(
        {
          buildModel: async () => createResult(),
        },
        {
          dataset: "shop_dataset",
          tables: "customers",
          goal: undefined,
          yolo: true,
          web: false,
          port: "4173",
          host: "127.0.0.1",
        },
        {
          isTTY: false,
          writeLine: () => undefined,
          prompt: async () => "",
        },
      ),
    /interactive TTY/,
  );
});

test("runModelBuildCommand rejects empty --tables", async () => {
  await assert.rejects(
    async () =>
      runModelBuildCommand(
        {
          buildModel: async () => createResult(),
        },
        {
          dataset: "shop_dataset",
          tables: " ",
          goal: undefined,
          yolo: true,
          web: false,
          port: "4173",
          host: "127.0.0.1",
        },
        {
          isTTY: true,
          writeLine: () => undefined,
          prompt: async () => "",
        },
      ),
    /requires --tables/,
  );
});

test("runModelBuildCommand runs preview and prints artifact summary", async () => {
  const output: string[] = [];
  let previewCalled = false;

  await runModelBuildCommand(
    {
      buildModel: async () => createResult(),
    },
    {
      dataset: "shop_dataset",
      tables: "customers",
      goal: "Build dashboard model",
      yolo: true,
      web: false,
      port: "4173",
      host: "127.0.0.1",
    },
    {
      isTTY: true,
      writeLine: (line: string) => output.push(line),
      prompt: async () => "",
    },
    async () => {
      previewCalled = true;
    },
  );

  assert.equal(previewCalled, true);
  assert.equal(output.some((line) => line.includes("Model build completed")), true);
  assert.equal(output.some((line) => line.includes("sql:model")), true);
});

test("runModelBuildCommand launches web app when --web is enabled", async () => {
  const output: string[] = [];
  let previewCalled = false;
  let launchedUrl = "";

  await runModelBuildCommand(
    {
      buildModel: async () => createResult(),
    },
    {
      dataset: "shop_dataset",
      tables: "customers",
      goal: undefined,
      yolo: true,
      web: true,
      port: "4300",
      host: "127.0.0.1",
    },
    {
      isTTY: false,
      writeLine: (line: string) => output.push(line),
      prompt: async () => "",
    },
    async () => {
      previewCalled = true;
    },
    async () => {
      launchedUrl = "http://127.0.0.1:4300";
      return {
        url: launchedUrl,
        runId: "2026-02-12T19-00-00-000Z",
        close: async () => undefined,
      };
    },
  );

  assert.equal(previewCalled, false);
  assert.equal(output.some((line) => line.includes("Web app running at")), true);
  assert.equal(launchedUrl, "http://127.0.0.1:4300");
});

test("runModelWebCommand resolves dataset and launches web server", async () => {
  const output: string[] = [];
  let launchInput: { datasetId: string; runId?: string; port: number; host: string } | undefined;

  await runModelWebCommand(
    process.cwd(),
    {
      datasetIdFromAny: (value: string) => `mapped_${value}`,
    },
    {
      dataset: "shop_dataset",
      runId: "2026-02-12T19-00-00-000Z",
      port: "4400",
      host: "127.0.0.1",
    },
    {
      isTTY: true,
      writeLine: (line: string) => output.push(line),
      prompt: async () => "",
    },
    async (input) => {
      launchInput = input;
      return {
        url: "http://127.0.0.1:4400",
        runId: input.runId ?? "latest",
        close: async () => undefined,
      };
    },
  );

  assert.deepEqual(launchInput, {
    datasetId: "mapped_shop_dataset",
    runId: "2026-02-12T19-00-00-000Z",
    port: 4400,
    host: "127.0.0.1",
  });
  assert.equal(output.some((line) => line.includes("Model web app running at")), true);
});

test("normalizeInteractiveModelInput accepts slash and dataclaw-prefixed model commands", () => {
  assert.equal(normalizeInteractiveModelInput("/model build --tables a,b"), "model build --tables a,b");
  assert.equal(normalizeInteractiveModelInput("dataclaw model web --port 4200"), "model web --port 4200");
  assert.equal(normalizeInteractiveModelInput("model help"), "model help");
  assert.equal(normalizeInteractiveModelInput("count rows by class"), null);
});

test("normalizeInteractiveDatasetInput accepts slash and dataclaw-prefixed dataset commands", () => {
  assert.equal(normalizeInteractiveDatasetInput("/dataset search titanic"), "dataset search titanic");
  assert.equal(normalizeInteractiveDatasetInput("dataclaw dataset open 1"), "dataset open 1");
  assert.equal(normalizeInteractiveDatasetInput("dataset help"), "dataset help");
  assert.equal(normalizeInteractiveDatasetInput("/datasets"), null);
  assert.equal(normalizeInteractiveDatasetInput("count rows by class"), null);
});
