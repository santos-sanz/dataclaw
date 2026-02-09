import test from "node:test";
import assert from "node:assert/strict";
import type { DatasetManifest } from "@dataclaw/shared";
import type { RankedKaggleDataset } from "../services/dataset-search-ranking.js";
import { runDatasetSearchCommand } from "./program.js";

const BASE_MANIFEST: DatasetManifest = {
  id: "sample_dataset",
  source: "owner/sample",
  createdAt: "2026-02-09T00:00:00Z",
  files: [],
  tables: [],
};

function makeRankedFixtures(): RankedKaggleDataset[] {
  return [
    {
      rank: 1,
      ref: "owner/first",
      title: "First",
      totalBytes: 100,
      lastUpdated: "2026-01-01T00:00:00Z",
      downloadCount: 100,
      voteCount: 10,
      usabilityRating: 0.9,
      formats: ["csv"],
      quality: 90,
      signals: { usability: 0.9, votes: 0.8, downloads: 0.7, recency: 0.95 },
    },
    {
      rank: 2,
      ref: "owner/second",
      title: "Second",
      totalBytes: 200,
      lastUpdated: "2026-01-01T00:00:00Z",
      downloadCount: 90,
      voteCount: 8,
      usabilityRating: 0.8,
      formats: ["json"],
      quality: 80,
      signals: { usability: 0.8, votes: 0.7, downloads: 0.6, recency: 0.9 },
    },
  ];
}

test("runDatasetSearchCommand returns raw output with --raw", async () => {
  const output: string[] = [];
  let rankedCalled = false;

  const service = {
    searchRemoteDatasets: async () => "ref,title\nowner/ds,Dataset",
    searchRemoteDatasetsRanked: async () => {
      rankedCalled = true;
      return [];
    },
    addDataset: async () => BASE_MANIFEST,
  };

  await runDatasetSearchCommand(
    service,
    "query",
    { fileType: "all", page: "1", raw: true, pick: false },
    {
      isTTY: false,
      writeLine: (line) => output.push(line),
      prompt: async () => "",
    },
  );

  assert.equal(output[0], "ref,title\nowner/ds,Dataset");
  assert.equal(rankedCalled, false);
});

test("runDatasetSearchCommand rejects --pick when no interactive TTY", async () => {
  const service = {
    searchRemoteDatasets: async () => "",
    searchRemoteDatasetsRanked: async () => makeRankedFixtures(),
    addDataset: async () => BASE_MANIFEST,
  };

  await assert.rejects(
    async () =>
      runDatasetSearchCommand(service, "query", { fileType: "all", page: "1", raw: false, pick: true }, {
        isTTY: false,
        writeLine: () => undefined,
        prompt: async () => "",
      }),
    /interactive TTY/,
  );
});

test("runDatasetSearchCommand rejects incompatible --raw and --pick flags", async () => {
  const service = {
    searchRemoteDatasets: async () => "",
    searchRemoteDatasetsRanked: async () => makeRankedFixtures(),
    addDataset: async () => BASE_MANIFEST,
  };

  await assert.rejects(
    async () =>
      runDatasetSearchCommand(service, "query", { fileType: "all", page: "1", raw: true, pick: true }, {
        isTTY: true,
        writeLine: () => undefined,
        prompt: async () => "",
      }),
    /cannot be used together/,
  );
});

test("runDatasetSearchCommand installs selected dataset by rank number", async () => {
  const output: string[] = [];
  const installed: string[] = [];
  const service = {
    searchRemoteDatasets: async () => "",
    searchRemoteDatasetsRanked: async () => makeRankedFixtures(),
    addDataset: async (ownerSlug: string) => {
      installed.push(ownerSlug);
      return { ...BASE_MANIFEST, id: "installed_dataset", source: ownerSlug };
    },
  };

  await runDatasetSearchCommand(
    service,
    "query",
    { fileType: "all", page: "1", raw: false, pick: true },
    {
      isTTY: true,
      writeLine: (line) => output.push(line),
      prompt: async () => "2",
    },
  );

  assert.deepEqual(installed, ["owner/second"]);
  assert.equal(output.some((line) => line.includes("Dataset installed: installed_dataset")), true);
});

test("runDatasetSearchCommand does not install on invalid prompt input", async () => {
  let addCalls = 0;
  const output: string[] = [];
  const service = {
    searchRemoteDatasets: async () => "",
    searchRemoteDatasetsRanked: async () => makeRankedFixtures(),
    addDataset: async () => {
      addCalls += 1;
      return BASE_MANIFEST;
    },
  };

  await runDatasetSearchCommand(
    service,
    "query",
    { fileType: "all", page: "1", raw: false, pick: true },
    {
      isTTY: true,
      writeLine: (line) => output.push(line),
      prompt: async () => "bad-value",
    },
  );

  assert.equal(addCalls, 0);
  assert.equal(output.some((line) => line.includes("Invalid selection")), true);
});

test("runDatasetSearchCommand skips install when prompt input is empty", async () => {
  let addCalls = 0;
  const output: string[] = [];
  const service = {
    searchRemoteDatasets: async () => "",
    searchRemoteDatasetsRanked: async () => makeRankedFixtures(),
    addDataset: async () => {
      addCalls += 1;
      return BASE_MANIFEST;
    },
  };

  await runDatasetSearchCommand(
    service,
    "query",
    { fileType: "all", page: "1", raw: false, pick: true },
    {
      isTTY: true,
      writeLine: (line) => output.push(line),
      prompt: async () => "",
    },
  );

  assert.equal(addCalls, 0);
  assert.equal(output.some((line) => line.includes("Install skipped.")), true);
});
