import test from "node:test";
import assert from "node:assert/strict";
import type { DatasetManifest } from "@dataclaw/shared";
import type { RemoteDatasetDiscoveryResult, RemoteDatasetInspection } from "../services/dataset-service.js";
import { runDatasetDiscoverCommand } from "./program.js";

const BASE_MANIFEST: DatasetManifest = {
  id: "owner_sample",
  source: "owner/sample",
  createdAt: "2026-02-12T00:00:00Z",
  files: [],
  tables: [],
};

function makeDiscoveryResult(page: number = 1, query: string = "sample"): RemoteDatasetDiscoveryResult {
  return {
    query,
    page,
    filters: {
      sortBy: "hottest",
      fileType: "all",
      licenseName: "all",
    },
    results: [
      {
        rank: 1,
        ref: "owner/sample",
        title: "Sample Dataset",
        summary: "Dataset summary",
        fileCount: 3,
        totalBytes: 1024,
        lastUpdated: "2026-01-01T00:00:00Z",
        downloadCount: 100,
        voteCount: 10,
        usabilityRating: 0.9,
        formats: ["csv"],
        quality: 90,
        signals: { usability: 0.9, votes: 0.8, downloads: 0.7, recency: 0.6 },
      },
    ],
  };
}

function makeInspection(): RemoteDatasetInspection {
  return {
    ref: "owner/sample",
    title: "Sample Dataset",
    totalBytes: 1024,
    licenses: [],
    tags: [],
    files: [],
    fileStats: {
      totalFiles: 0,
      totalBytes: 0,
      byFormat: [],
      topFiles: [],
      truncated: false,
    },
  };
}

test("runDatasetDiscoverCommand renders one-shot output when non-interactive", async () => {
  const output: string[] = [];
  const service = {
    discoverRemoteDatasets: async () => makeDiscoveryResult(),
    inspectRemoteDataset: async () => makeInspection(),
    addDataset: async () => BASE_MANIFEST,
  };

  await runDatasetDiscoverCommand(
    service,
    "sample",
    {
      sortBy: "hottest",
      fileType: "all",
      license: "all",
      page: "1",
      interactive: false,
    },
    {
      isTTY: false,
      writeLine: (line) => output.push(line),
      prompt: async () => "",
    },
  );

  assert.equal(output.length > 0, true);
  assert.equal(output[0].includes("Discovery results"), true);
});

test("runDatasetDiscoverCommand supports open and install commands", async () => {
  const output: string[] = [];
  const opened: string[] = [];
  const installed: string[] = [];
  const prompts = ["open 1", "install 1", "quit"];
  const service = {
    discoverRemoteDatasets: async () => makeDiscoveryResult(),
    inspectRemoteDataset: async (ref: string) => {
      opened.push(ref);
      return makeInspection();
    },
    addDataset: async (ref: string) => {
      installed.push(ref);
      return BASE_MANIFEST;
    },
  };

  await runDatasetDiscoverCommand(
    service,
    "sample",
    {
      sortBy: "hottest",
      fileType: "all",
      license: "all",
      page: "1",
      interactive: true,
    },
    {
      isTTY: true,
      writeLine: (line) => output.push(line),
      prompt: async () => prompts.shift() ?? "quit",
    },
  );

  assert.deepEqual(opened, ["owner/sample"]);
  assert.deepEqual(installed, ["owner/sample"]);
  assert.equal(output.some((line) => line.includes("Dataset installed: owner_sample")), true);
});

test("runDatasetDiscoverCommand keeps session alive after invalid command", async () => {
  const output: string[] = [];
  const prompts = ["invalid-cmd", "quit"];
  const service = {
    discoverRemoteDatasets: async () => makeDiscoveryResult(),
    inspectRemoteDataset: async () => makeInspection(),
    addDataset: async () => BASE_MANIFEST,
  };

  await runDatasetDiscoverCommand(
    service,
    "sample",
    {
      sortBy: "hottest",
      fileType: "all",
      license: "all",
      page: "1",
      interactive: true,
    },
    {
      isTTY: true,
      writeLine: (line) => output.push(line),
      prompt: async () => prompts.shift() ?? "quit",
    },
  );

  assert.equal(output.some((line) => line.includes("Unknown command")), true);
});
