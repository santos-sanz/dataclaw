import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatasetManifest } from "@dataclaw/shared";
import { ensureProjectDirectories, getDatasetRoot, getProjectPaths } from "@dataclaw/shared";
import { readText, safeTableName, writeText } from "../utils/fs-utils.js";
import { DuckDbService } from "./duckdb-service.js";
import {
  deriveFormatsFromDatasetFiles,
  normalizeDatasetFormatToken,
  parseKaggleDatasetMetadataJson,
  rankKaggleDatasets,
  toMetadataSummary,
  type RankedDatasetFormat,
  type RankedKaggleDataset,
  type RemoteDatasetMetadataSummary,
} from "./dataset-search-ranking.js";
import { KaggleService, type KaggleDatasetSearchOptions } from "./kaggle-service.js";

export interface DiscoverRemoteDatasetsOptions extends KaggleDatasetSearchOptions {
  query?: string;
  page?: number;
}

export interface DiscoveredRemoteDataset extends RankedKaggleDataset {
  summary?: string;
  metadataSummary?: RemoteDatasetMetadataSummary;
  fileCount?: number;
  fileCountApproximate?: boolean;
}

export interface RemoteDatasetDiscoveryResult {
  query: string;
  page: number;
  filters: {
    sortBy: string;
    fileType: string;
    licenseName: string;
    tags?: string;
    user?: string;
    minSize?: number;
    maxSize?: number;
  };
  results: DiscoveredRemoteDataset[];
}

export interface RemoteDatasetFileFormatStat {
  format: RankedDatasetFormat;
  count: number;
  totalBytes: number;
}

export interface RemoteDatasetInspection {
  ref: string;
  title: string;
  subtitle?: string;
  description?: string;
  licenses: string[];
  tags: string[];
  owner?: string;
  datasetSlug?: string;
  totalBytes: number | null;
  lastUpdated?: string;
  quality?: number;
  signals?: RankedKaggleDataset["signals"];
  voteCount?: number;
  downloadCount?: number;
  usabilityRating?: number | null;
  files: Array<{
    name: string;
    totalBytes: number | null;
    creationDate: string;
    format: RankedDatasetFormat;
  }>;
  fileStats: {
    totalFiles: number;
    totalBytes: number;
    byFormat: RemoteDatasetFileFormatStat[];
    topFiles: Array<{
      name: string;
      totalBytes: number | null;
      creationDate: string;
      format: RankedDatasetFormat;
    }>;
    truncated: boolean;
    nextPageToken?: string;
  };
}

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
    const discovered = await this.discoverRemoteDatasets({ query, fileType, page });
    return discovered.results;
  }

  async discoverRemoteDatasets(options: DiscoverRemoteDatasetsOptions = {}): Promise<RemoteDatasetDiscoveryResult> {
    const query = options.query ?? "";
    const page = Math.max(1, options.page ?? 1);
    const sortBy = options.sortBy ?? "hottest";
    const fileType = options.fileType ?? "all";
    const licenseName = options.licenseName ?? "all";

    const datasets = await this.kaggleService.searchDatasetsParsed({
      ...options,
      query,
      page,
      sortBy,
      fileType,
      licenseName,
    });

    const assumedFormat = fileType !== "all" ? normalizeDatasetFormatToken(fileType) : undefined;
    const ranked = rankKaggleDatasets(datasets, { assumedFormat }) as DiscoveredRemoteDataset[];
    const topForEnrichment = ranked.slice(0, 8);

    await mapWithConcurrency(topForEnrichment, 4, async (dataset) => {
      try {
        const allFiles = await this.kaggleService.listAllFilesParsed(dataset.ref, 2, 1000);
        const formats = deriveFormatsFromDatasetFiles(allFiles.files);
        const hasSpecificFormats = formats.some((format) => format !== "unknown");
        if (hasSpecificFormats) {
          dataset.formats = formats;
        } else if (!dataset.formats.length) {
          dataset.formats = ["unknown"];
        }

        dataset.fileCount = allFiles.files.length;
        dataset.fileCountApproximate = allFiles.truncated;
      } catch {
        if (!dataset.formats.length) {
          dataset.formats = ["unknown"];
        }
      }

      try {
        const metadataRaw = await this.kaggleService.downloadDatasetMetadataJson(dataset.ref);
        const metadataDetail = parseKaggleDatasetMetadataJson(metadataRaw, { fallbackRef: dataset.ref });
        if (!metadataDetail) return;
        const metadataSummary = toMetadataSummary(metadataDetail);

        dataset.metadataSummary = metadataSummary;
        dataset.summary = metadataSummary.subtitle ?? metadataSummary.descriptionSnippet;
        if (metadataDetail.totalBytes !== null && dataset.totalBytes === null) {
          dataset.totalBytes = metadataDetail.totalBytes;
        }
        if (metadataDetail.lastUpdated && !dataset.lastUpdated) {
          dataset.lastUpdated = metadataDetail.lastUpdated;
        }
      } catch {
        // Best-effort enrichment.
      }
    });

    return {
      query,
      page,
      filters: {
        sortBy,
        fileType,
        licenseName,
        tags: options.tags,
        user: options.user,
        minSize: options.minSize,
        maxSize: options.maxSize,
      },
      results: ranked,
    };
  }

  async inspectRemoteDataset(ref: string): Promise<RemoteDatasetInspection> {
    const [metadataDetail, allFiles, rankedMatch] = await Promise.all([
      this.kaggleService
        .downloadDatasetMetadataJson(ref)
        .then((raw) => parseKaggleDatasetMetadataJson(raw, { fallbackRef: ref }))
        .catch(() => null),
      this.kaggleService
        .listAllFilesParsed(ref, 10, 1000)
        .catch(
          () =>
            ({
              files: [],
              truncated: false,
              pagesFetched: 0,
              nextPageToken: undefined,
            }) as const,
        ),
      this.kaggleService
        .searchDatasetsParsed({ query: ref, page: 1, sortBy: "hottest", fileType: "all", licenseName: "all" })
        .then((rows) => rankKaggleDatasets(rows).find((item) => item.ref === ref))
        .catch(() => undefined),
    ]);

    const filesWithFormat = allFiles.files.map((file) => ({
      ...file,
      format: normalizeDatasetFormatToken(file.name),
    }));
    const formatStats = computeFormatStats(filesWithFormat);
    const fileBytes = filesWithFormat.reduce((sum, file) => sum + (file.totalBytes ?? 0), 0);
    const topFiles = [...filesWithFormat].sort((left, right) => (right.totalBytes ?? -1) - (left.totalBytes ?? -1)).slice(0, 10);

    return {
      ref,
      title: metadataDetail?.title ?? rankedMatch?.title ?? ref,
      subtitle: metadataDetail?.subtitle,
      description: metadataDetail?.description,
      licenses: metadataDetail?.licenses ?? [],
      tags: metadataDetail?.tags ?? [],
      owner: metadataDetail?.owner,
      datasetSlug: metadataDetail?.datasetSlug,
      totalBytes: metadataDetail?.totalBytes ?? rankedMatch?.totalBytes ?? null,
      lastUpdated: metadataDetail?.lastUpdated ?? rankedMatch?.lastUpdated,
      quality: rankedMatch?.quality,
      signals: rankedMatch?.signals,
      voteCount: rankedMatch?.voteCount,
      downloadCount: rankedMatch?.downloadCount,
      usabilityRating: rankedMatch?.usabilityRating,
      files: filesWithFormat,
      fileStats: {
        totalFiles: filesWithFormat.length,
        totalBytes: fileBytes,
        byFormat: formatStats,
        topFiles,
        truncated: allFiles.truncated,
        nextPageToken: allFiles.nextPageToken,
      },
    };
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

function computeFormatStats(
  files: Array<{
    name: string;
    totalBytes: number | null;
    creationDate: string;
    format: RankedDatasetFormat;
  }>,
): RemoteDatasetFileFormatStat[] {
  const stats = new Map<RankedDatasetFormat, RemoteDatasetFileFormatStat>();
  for (const file of files) {
    const current = stats.get(file.format) ?? { format: file.format, count: 0, totalBytes: 0 };
    current.count += 1;
    current.totalBytes += file.totalBytes ?? 0;
    stats.set(file.format, current);
  }

  return [...stats.values()].sort((left, right) => right.count - left.count || right.totalBytes - left.totalBytes);
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
