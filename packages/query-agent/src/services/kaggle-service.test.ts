import test from "node:test";
import assert from "node:assert/strict";
import { KaggleService, extractPaginatedCsv, type KaggleListFilesPage } from "./kaggle-service.js";

test("extractPaginatedCsv separates token from csv body", () => {
  const raw = ["Next Page Token = abc123", "name,total_bytes,creationDate", "file.csv,10,2026-01-01"].join("\n");
  const parsed = extractPaginatedCsv(raw);

  assert.equal(parsed.nextPageToken, "abc123");
  assert.equal(parsed.csv, "name,total_bytes,creationDate\nfile.csv,10,2026-01-01");
});

test("listAllFilesParsed follows pagination until token is absent", async () => {
  class FakeKaggleService extends KaggleService {
    private readonly pages: KaggleListFilesPage[] = [
      {
        csv: "name,total_bytes,creationDate\npart-1.csv,10,2026-01-01",
        nextPageToken: "t1",
        rawOutput: "",
      },
      {
        csv: "name,total_bytes,creationDate\npart-2.csv,20,2026-01-02",
        rawOutput: "",
      },
    ];
    private cursor = 0;

    async listFilesCsvPage(): Promise<KaggleListFilesPage> {
      const page = this.pages[this.cursor];
      this.cursor += 1;
      return page;
    }
  }

  const service = new FakeKaggleService();
  const result = await service.listAllFilesParsed("owner/dataset");

  assert.equal(result.files.length, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.nextPageToken, undefined);
  assert.equal(result.pagesFetched, 2);
});

test("listAllFilesParsed marks truncated when max pages reached", async () => {
  class FakeKaggleService extends KaggleService {
    async listFilesCsvPage(): Promise<KaggleListFilesPage> {
      return {
        csv: "name,total_bytes,creationDate\npart.csv,10,2026-01-01",
        nextPageToken: "still-more",
        rawOutput: "",
      };
    }
  }

  const service = new FakeKaggleService();
  const result = await service.listAllFilesParsed("owner/dataset", 1);

  assert.equal(result.files.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.nextPageToken, "still-more");
  assert.equal(result.pagesFetched, 1);
});
