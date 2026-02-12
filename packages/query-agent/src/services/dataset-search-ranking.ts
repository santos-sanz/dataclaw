export type RankedDatasetFormat = "csv" | "parquet" | "sqlite" | "json" | "bigquery" | "other" | "unknown";

export interface RemoteDatasetMetadataSummary {
  ref: string;
  title: string;
  subtitle?: string;
  descriptionSnippet?: string;
  licenses: string[];
  tags: string[];
}

export interface RemoteDatasetMetadataDetail {
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
}

export interface KaggleDatasetSearchRow {
  ref: string;
  title: string;
  totalBytes: number | null;
  lastUpdated: string;
  downloadCount: number;
  voteCount: number;
  usabilityRating: number | null;
}

export interface KaggleDatasetFileRow {
  name: string;
  totalBytes: number | null;
  creationDate: string;
}

export interface RankedKaggleDataset {
  rank: number;
  ref: string;
  title: string;
  summary?: string;
  fileCount?: number;
  totalBytes: number | null;
  lastUpdated: string;
  downloadCount: number;
  voteCount: number;
  usabilityRating: number | null;
  formats: RankedDatasetFormat[];
  quality: number;
  signals: {
    usability: number;
    votes: number;
    downloads: number;
    recency: number;
  };
}

interface ScoredDataset {
  ref: string;
  title: string;
  totalBytes: number | null;
  lastUpdated: string;
  lastUpdatedMs: number;
  downloadCount: number;
  voteCount: number;
  usabilityRating: number | null;
  quality: number;
  signals: {
    usability: number;
    votes: number;
    downloads: number;
    recency: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORMAT_PRIORITY: RankedDatasetFormat[] = ["csv", "parquet", "json", "sqlite", "bigquery", "other", "unknown"];

export function parseKaggleDatasetSearchCsv(csv: string): KaggleDatasetSearchRow[] {
  const rows = parseCsvRecords(csv, ["ref", "title"]);
  return rows
    .map((row) => {
      const ref = readField(row, ["ref"]);
      if (!ref) return null;
      return {
        ref,
        title: readField(row, ["title"]) ?? ref,
        totalBytes: parseOptionalNumber(readField(row, ["totalbytes", "size"])),
        lastUpdated: readField(row, ["lastupdated"]) ?? "",
        downloadCount: parseCount(readField(row, ["downloadcount"])),
        voteCount: parseCount(readField(row, ["votecount"])),
        usabilityRating: parseOptionalNumber(readField(row, ["usabilityrating"])),
      };
    })
    .filter((item): item is KaggleDatasetSearchRow => item !== null);
}

export function parseKaggleDatasetFilesCsv(csv: string): KaggleDatasetFileRow[] {
  const rows = parseCsvRecords(csv, ["name"]);
  return rows
    .map((row) => {
      const name = readField(row, ["name"]);
      if (!name) return null;
      return {
        name,
        totalBytes: parseOptionalNumber(readField(row, ["total_bytes", "totalbytes", "size"])),
        creationDate: readField(row, ["creationdate"]) ?? "",
      };
    })
    .filter((item): item is KaggleDatasetFileRow => item !== null);
}

export function rankKaggleDatasets(
  datasets: KaggleDatasetSearchRow[],
  opts: { assumedFormat?: RankedDatasetFormat } = {},
): RankedKaggleDataset[] {
  const votesLogs = datasets.map((item) => Math.log10(item.voteCount + 1));
  const downloadsLogs = datasets.map((item) => Math.log10(item.downloadCount + 1));
  const nowMs = Date.now();

  const scored: ScoredDataset[] = datasets.map((item) => {
    const usability = normalizeUsability(item.usabilityRating);
    const votes = minMaxNormalize(Math.log10(item.voteCount + 1), votesLogs);
    const downloads = minMaxNormalize(Math.log10(item.downloadCount + 1), downloadsLogs);
    const lastUpdatedMs = safeDateMs(item.lastUpdated);
    const recency = computeRecency(lastUpdatedMs, nowMs);
    const quality = Math.round(100 * (0.45 * usability + 0.25 * votes + 0.2 * downloads + 0.1 * recency));

    return {
      ref: item.ref,
      title: item.title,
      totalBytes: item.totalBytes,
      lastUpdated: item.lastUpdated,
      lastUpdatedMs,
      downloadCount: item.downloadCount,
      voteCount: item.voteCount,
      usabilityRating: item.usabilityRating,
      quality,
      signals: { usability, votes, downloads, recency },
    };
  });

  scored.sort((left, right) => {
    return (
      right.quality - left.quality ||
      right.signals.usability - left.signals.usability ||
      right.voteCount - left.voteCount ||
      right.downloadCount - left.downloadCount ||
      right.lastUpdatedMs - left.lastUpdatedMs ||
      left.ref.localeCompare(right.ref)
    );
  });

  return scored.map((item, index) => ({
    rank: index + 1,
    ref: item.ref,
    title: item.title,
    totalBytes: item.totalBytes,
    lastUpdated: item.lastUpdated,
    downloadCount: item.downloadCount,
    voteCount: item.voteCount,
    usabilityRating: item.usabilityRating,
    formats: [opts.assumedFormat ?? "unknown"],
    quality: item.quality,
    signals: item.signals,
  }));
}

export function deriveFormatsFromDatasetFiles(files: KaggleDatasetFileRow[]): RankedDatasetFormat[] {
  if (!files.length) return ["unknown"];

  const counts = new Map<RankedDatasetFormat, number>();
  for (const file of files) {
    const format = normalizeDatasetFormatToken(file.name);
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }

  if (!counts.size) return ["unknown"];

  return [...counts.entries()]
    .sort((left, right) => {
      return right[1] - left[1] || FORMAT_PRIORITY.indexOf(left[0]) - FORMAT_PRIORITY.indexOf(right[0]);
    })
    .map(([format]) => format);
}

export function normalizeDatasetFormatToken(value: string): RankedDatasetFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "all") return "unknown";
  if (normalized === "bigquery") return "bigquery";
  if (normalized.endsWith(".csv") || normalized.endsWith(".tsv") || normalized === "csv") return "csv";
  if (normalized.endsWith(".parquet") || normalized === "parquet") return "parquet";
  if (
    normalized.endsWith(".sqlite") ||
    normalized.endsWith(".sqlite3") ||
    normalized.endsWith(".db") ||
    normalized === "sqlite"
  ) {
    return "sqlite";
  }
  if (normalized.endsWith(".json") || normalized.endsWith(".jsonl") || normalized.endsWith(".ndjson") || normalized === "json") {
    return "json";
  }
  if (!normalized) return "unknown";
  return "other";
}

export function parseKaggleDatasetMetadataJson(
  input: unknown,
  opts: { fallbackRef?: string; descriptionSnippetMaxLength?: number } = {},
): RemoteDatasetMetadataDetail | null {
  const root = asRecord(input);
  if (!root) return null;
  const info = asRecord(root.info) ?? root;

  const owner = readString(info, ["ownerUser", "ownerSlug", "owner"]);
  const datasetSlug = readString(info, ["datasetSlug", "slug"]);
  const ref = readString(info, ["ref", "id"]) ?? (owner && datasetSlug ? `${owner}/${datasetSlug}` : opts.fallbackRef ?? "");
  const title = readString(info, ["title"]) ?? ref;

  if (!ref || !title) return null;

  const description = readString(info, ["description"]);
  const subtitle = readString(info, ["subtitle"]);
  const totalBytes = parseOptionalNumber(readString(info, ["totalBytes", "size"]));
  const lastUpdated = readString(info, ["lastUpdated", "updateTime", "lastUpdateTime"]);
  const licenses = readLicenseNames(info.licenses);
  const tags = readKeywordNames(info.keywords);

  return {
    ref,
    title,
    subtitle,
    description,
    licenses,
    tags,
    owner,
    datasetSlug,
    totalBytes,
    lastUpdated,
  };
}

export function toMetadataSummary(
  detail: RemoteDatasetMetadataDetail,
  opts: { descriptionSnippetMaxLength?: number } = {},
): RemoteDatasetMetadataSummary {
  const max = opts.descriptionSnippetMaxLength ?? 140;
  const descriptionSnippet = summarizeText(detail.description, max);

  return {
    ref: detail.ref,
    title: detail.title,
    subtitle: detail.subtitle,
    descriptionSnippet,
    licenses: detail.licenses,
    tags: detail.tags,
  };
}

function parseCsvRecords(csv: string, requiredHeaders: string[]): Array<Record<string, string>> {
  const matrix = parseCsvMatrix(csv);
  if (matrix.length === 0) return [];

  const required = requiredHeaders.map((value) => normalizeHeader(value));
  const headerIndex = matrix.findIndex((row) => {
    const normalized = row.map((column) => normalizeHeader(column));
    return required.every((field) => normalized.includes(field));
  });
  if (headerIndex === -1) return [];

  const header = matrix[headerIndex].map((column) => normalizeHeader(column));
  const rows = matrix.slice(headerIndex + 1);

  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      for (let index = 0; index < header.length; index += 1) {
        const key = header[index];
        if (!key) continue;
        record[key] = row[index] ?? "";
      }
      return record;
    });
}

function parseCsvMatrix(input: string): string[][] {
  if (!input.trim()) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\"") {
      const next = input[i + 1];
      if (inQuotes && next === "\"") {
        currentCell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && input[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.length > 1 || currentRow[0] !== "") {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function readField(record: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (normalized in record) {
      const value = record[normalized]?.trim();
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  return undefined;
}

function readLicenseNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      output.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const name = readString(record, ["name"]);
    if (name) output.push(name);
  }
  return unique(output);
}

function readKeywordNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      output.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const name = readString(record, ["name", "id"]);
    if (name) output.push(name);
  }
  return unique(output);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function summarizeText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  if (compact.length <= maxLength) return compact;
  if (maxLength <= 3) return compact.slice(0, maxLength);
  return `${compact.slice(0, maxLength - 3)}...`;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCount(value: string | undefined): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === null || parsed < 0) return 0;
  return Math.floor(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeUsability(raw: number | null): number {
  if (raw === null || Number.isNaN(raw)) return 0;
  if (raw >= 0 && raw <= 1) return clamp(raw, 0, 1);
  if (raw >= 0 && raw <= 10) return clamp(raw / 10, 0, 1);
  return clamp(raw, 0, 1);
}

function minMaxNormalize(value: number, population: number[]): number {
  if (!population.length) return 0.5;
  const min = Math.min(...population);
  const max = Math.max(...population);
  if (max === min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

function computeRecency(lastUpdatedMs: number, nowMs: number): number {
  if (lastUpdatedMs <= 0) return 0;
  const days = Math.max(0, (nowMs - lastUpdatedMs) / DAY_MS);
  return Math.exp(-days / 365);
}

function safeDateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
