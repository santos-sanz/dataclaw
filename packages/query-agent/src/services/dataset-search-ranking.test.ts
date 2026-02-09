import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveFormatsFromDatasetFiles,
  parseKaggleDatasetSearchCsv,
  rankKaggleDatasets,
} from "./dataset-search-ranking.js";

test("parseKaggleDatasetSearchCsv parses quoted titles with commas", () => {
  const csv = [
    "ref,title,size,lastUpdated,downloadCount,voteCount,usabilityRating",
    'owner/ds,"Dataset, With Comma",1024,2025-01-01T00:00:00Z,150,30,0.9',
  ].join("\n");

  const parsed = parseKaggleDatasetSearchCsv(csv);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].ref, "owner/ds");
  assert.equal(parsed[0].title, "Dataset, With Comma");
  assert.equal(parsed[0].totalBytes, 1024);
  assert.equal(parsed[0].downloadCount, 150);
  assert.equal(parsed[0].voteCount, 30);
  assert.equal(parsed[0].usabilityRating, 0.9);
});

test("rankKaggleDatasets sorts by quality and deterministic tie-breakers", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-01-01T00:00:00Z");
  try {
    const ranked = rankKaggleDatasets([
      {
        ref: "zeta/a",
        title: "A",
        totalBytes: 1000,
        lastUpdated: "2025-12-30T00:00:00Z",
        downloadCount: 100,
        voteCount: 20,
        usabilityRating: 0.9,
      },
      {
        ref: "alpha/b",
        title: "B",
        totalBytes: 1000,
        lastUpdated: "2025-12-30T00:00:00Z",
        downloadCount: 100,
        voteCount: 20,
        usabilityRating: 0.9,
      },
      {
        ref: "mid/c",
        title: "C",
        totalBytes: 1000,
        lastUpdated: "2020-01-01T00:00:00Z",
        downloadCount: 10,
        voteCount: 1,
        usabilityRating: 0.2,
      },
    ]);

    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].ref, "alpha/b");
    assert.equal(ranked[1].ref, "zeta/a");
    assert.equal(ranked[2].ref, "mid/c");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[2].rank, 3);
    assert.equal(ranked[0].quality >= ranked[1].quality, true);
    assert.equal(ranked[1].quality >= ranked[2].quality, true);
  } finally {
    Date.now = originalNow;
  }
});

test("rankKaggleDatasets handles missing numeric values and invalid dates", () => {
  const ranked = rankKaggleDatasets([
    {
      ref: "owner/invalid",
      title: "Invalid",
      totalBytes: null,
      lastUpdated: "not-a-date",
      downloadCount: 0,
      voteCount: 0,
      usabilityRating: null,
    },
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(Number.isFinite(ranked[0].quality), true);
  assert.equal(ranked[0].quality >= 0 && ranked[0].quality <= 100, true);
});

test("deriveFormatsFromDatasetFiles prioritizes by frequency then format priority", () => {
  const formats = deriveFormatsFromDatasetFiles([
    { name: "part-1.csv", totalBytes: 100, creationDate: "" },
    { name: "part-2.csv", totalBytes: 100, creationDate: "" },
    { name: "events.parquet", totalBytes: 100, creationDate: "" },
    { name: "meta.json", totalBytes: 100, creationDate: "" },
  ]);

  assert.deepEqual(formats.slice(0, 3), ["csv", "parquet", "json"]);
});

test("deriveFormatsFromDatasetFiles falls back to unknown for empty input", () => {
  const formats = deriveFormatsFromDatasetFiles([]);
  assert.deepEqual(formats, ["unknown"]);
});
