import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatasetManifest } from "@dataclaw/shared";
import { ensureProjectDirectories, getDatasetRoot, getProjectPaths } from "@dataclaw/shared";
import { readText, safeTableName, writeText } from "../utils/fs-utils.js";
import { DuckDbService } from "./duckdb-service.js";
import {
  deriveFormatsFromDatasetFiles,
  normalizeDatasetFormatToken,
  rankKaggleDatasets,
  type RankedKaggleDataset,
} from "./dataset-search-ranking.js";
import { KaggleService } from "./kaggle-service.js";

export class DatasetService {
  constructor(
    private readonly cwd: string,
    private readonly kaggleService: KaggleService = new KaggleService(),
  ) {
    ensureProjectDirectories(cwd);
  }

  async addDataset(datasetSlug: string): Promise<DatasetManifest> {
    const datasetId = slugToDatasetId(datasetSlug);
    const datasetRoot = getDatasetRoot(datasetId, this.cwd);
    const rawPath = join(datasetRoot, "raw");
    const dbPath = join(datasetRoot, "canonical.duckdb");

    await this.kaggleService.downloadDataset(datasetSlug, rawPath);

    const duck = new DuckDbService(dbPath);
    const manifest = await duck.ingestDataset(datasetId, datasetSlug, rawPath);

    writeText(join(datasetRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

    const memoryPath = join(datasetRoot, "MEMORY.md");
    if (!existsSync(memoryPath)) {
      writeText(
        memoryPath,
        `# Dataset Memory: ${datasetId}\n\nUse this file for durable, curated dataset-specific learnings.\n`,
      );
    }

    return manifest;
  }

  listDatasets(): string[] {
    const root = getProjectPaths(this.cwd).datasetsRoot;
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  getManifest(datasetId: string): DatasetManifest {
    const path = join(getDatasetRoot(datasetId, this.cwd), "manifest.json");
    if (!existsSync(path)) {
      throw new Error(`Dataset '${datasetId}' is not ingested. Run 'dataclaw dataset add <owner/slug>' first.`);
    }
    return JSON.parse(readText(path)) as DatasetManifest;
  }

  getDatabasePath(datasetId: string): string {
    return join(getDatasetRoot(datasetId, this.cwd), "canonical.duckdb");
  }

  datasetIdFromAny(input: string): string {
    if (this.listDatasets().includes(input)) return input;
    const mapped = slugToDatasetId(input);
    if (this.listDatasets().includes(mapped)) return mapped;
    return input;
  }

  async listRemoteFiles(datasetSlug: string): Promise<string> {
    return this.kaggleService.listFiles(datasetSlug);
  }

  async searchRemoteDatasets(query: string, fileType?: string, page: number = 1): Promise<string> {
    return this.kaggleService.searchDatasets(query, fileType, page);
  }

  async searchRemoteDatasetsRanked(query: string, fileType?: string, page: number = 1): Promise<RankedKaggleDataset[]> {
    const datasets = await this.kaggleService.searchDatasetsParsed(query, fileType, page);
    const assumedFormat = fileType && fileType !== "all" ? normalizeDatasetFormatToken(fileType) : undefined;
    const ranked = rankKaggleDatasets(datasets, { assumedFormat });
    const topForEnrichment = ranked.slice(0, 8);

    await mapWithConcurrency(topForEnrichment, 4, async (dataset) => {
      try {
        const files = await this.kaggleService.listFilesParsed(dataset.ref);
        const formats = deriveFormatsFromDatasetFiles(files);
        const hasSpecificFormats = formats.some((format) => format !== "unknown");
        if (hasSpecificFormats) {
          dataset.formats = formats;
        } else if (!dataset.formats.length) {
          dataset.formats = ["unknown"];
        }
      } catch {
        if (!dataset.formats.length) {
          dataset.formats = ["unknown"];
        }
      }
    });

    return ranked;
  }
}

export function slugToDatasetId(slug: string): string {
  return safeTableName(slug.replace("/", "__"));
}

export function inferSourceTables(manifest: DatasetManifest): string[] {
  return manifest.tables.map((table) => table.name);
}

export function inferMainTable(manifest: DatasetManifest): string {
  return manifest.tables[0]?.name ?? "main_table";
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const size = Math.max(1, Math.floor(concurrency));
  let cursor = 0;

  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}
