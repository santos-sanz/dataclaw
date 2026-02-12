import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatasetService } from "./dataset-service.js";

function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "dataclaw-dataset-service-test-"));
  return fn(cwd).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
}

test("discoverRemoteDatasets enriches results and tolerates enrichment failures", async () => {
  await withTempCwd(async (cwd) => {
    const fakeKaggle = {
      searchDatasetsParsed: async () => [
        {
          ref: "owner/ok",
          title: "Dataset OK",
          totalBytes: 100,
          lastUpdated: "2026-01-01T00:00:00Z",
          downloadCount: 10,
          voteCount: 5,
          usabilityRating: 0.8,
        },
        {
          ref: "owner/fail",
          title: "Dataset Fail",
          totalBytes: null,
          lastUpdated: "2026-01-01T00:00:00Z",
          downloadCount: 2,
          voteCount: 1,
          usabilityRating: 0.4,
        },
      ],
      listAllFilesParsed: async (ref: string) => {
        if (ref === "owner/fail") {
          throw new Error("boom");
        }
        return {
          files: [{ name: "part.csv", totalBytes: 10, creationDate: "2026-01-01T00:00:00Z" }],
          truncated: false,
          pagesFetched: 1,
        };
      },
      downloadDatasetMetadataJson: async (ref: string) => {
        if (ref === "owner/fail") {
          throw new Error("boom");
        }
        return {
          info: {
            ownerUser: "owner",
            datasetSlug: "ok",
            title: "Dataset OK",
            subtitle: "Short subtitle",
            licenses: [{ name: "CC0-1.0" }],
          },
        };
      },
    };

    const service = new DatasetService(cwd, fakeKaggle as never);
    const discovered = await service.discoverRemoteDatasets({ query: "sample", page: 1, fileType: "csv" });

    assert.equal(discovered.results.length, 2);
    const ok = discovered.results.find((item) => item.ref === "owner/ok");
    const fail = discovered.results.find((item) => item.ref === "owner/fail");
    assert.ok(ok);
    assert.ok(fail);
    assert.equal(ok.fileCount, 1);
    assert.equal(ok.summary, "Short subtitle");
    assert.equal(Array.isArray(fail.formats), true);
  });
});

test("inspectRemoteDataset returns metadata and file statistics", async () => {
  await withTempCwd(async (cwd) => {
    const fakeKaggle = {
      downloadDatasetMetadataJson: async () => ({
        info: {
          ownerUser: "owner",
          datasetSlug: "sample",
          title: "Sample Dataset",
          subtitle: "Demo subtitle",
          description: "Demo description",
          licenses: [{ name: "CC0-1.0" }],
          keywords: [{ name: "finance" }],
        },
      }),
      listAllFilesParsed: async () => ({
        files: [
          { name: "a.csv", totalBytes: 100, creationDate: "2026-01-01T00:00:00Z" },
          { name: "b.parquet", totalBytes: 200, creationDate: "2026-01-02T00:00:00Z" },
          { name: "c.csv", totalBytes: 50, creationDate: "2026-01-03T00:00:00Z" },
        ],
        truncated: false,
        pagesFetched: 1,
      }),
      searchDatasetsParsed: async () => [
        {
          ref: "owner/sample",
          title: "Sample Dataset",
          totalBytes: 350,
          lastUpdated: "2026-01-04T00:00:00Z",
          downloadCount: 100,
          voteCount: 20,
          usabilityRating: 0.9,
        },
      ],
    };

    const service = new DatasetService(cwd, fakeKaggle as never);
    const inspection = await service.inspectRemoteDataset("owner/sample");

    assert.equal(inspection.title, "Sample Dataset");
    assert.equal(inspection.fileStats.totalFiles, 3);
    assert.equal(inspection.fileStats.totalBytes, 350);
    assert.equal(inspection.fileStats.byFormat[0].format, "csv");
    assert.equal(inspection.fileStats.byFormat[0].count, 2);
    assert.equal(inspection.files[0].format.length > 0, true);
  });
});
