import type { RemoteDatasetDiscoveryResult } from "../services/dataset-service.js";

const COLUMN_WIDTHS = {
  rank: 3,
  ref: 28,
  title: 28,
  summary: 34,
  formats: 14,
  files: 7,
  size: 10,
  quality: 7,
  signals: 22,
};

export function renderDatasetDiscovery(result: RemoteDatasetDiscoveryResult): string {
  const lines: string[] = [];
  const queryLabel = result.query ? `"${result.query}"` : "(empty)";
  lines.push(`Discovery results: query=${queryLabel} page=${result.page}`);
  lines.push(`Filters: ${renderFilters(result)}`);
  lines.push("");

  if (!result.results.length) {
    lines.push("No datasets found.");
    return lines.join("\n");
  }

  const header = [
    pad("#", COLUMN_WIDTHS.rank),
    pad("ref", COLUMN_WIDTHS.ref),
    pad("title", COLUMN_WIDTHS.title),
    pad("summary", COLUMN_WIDTHS.summary),
    pad("formats", COLUMN_WIDTHS.formats),
    pad("files", COLUMN_WIDTHS.files),
    pad("size", COLUMN_WIDTHS.size),
    pad("quality", COLUMN_WIDTHS.quality),
    pad("signals", COLUMN_WIDTHS.signals),
  ].join("  ");

  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const item of result.results) {
    lines.push(
      [
        pad(String(item.rank), COLUMN_WIDTHS.rank),
        pad(item.ref, COLUMN_WIDTHS.ref),
        pad(item.title, COLUMN_WIDTHS.title),
        pad(item.summary ?? "-", COLUMN_WIDTHS.summary),
        pad(renderFormats(item.formats), COLUMN_WIDTHS.formats),
        pad(renderFileCount(item.fileCount, item.fileCountApproximate), COLUMN_WIDTHS.files),
        pad(formatBytes(item.totalBytes), COLUMN_WIDTHS.size),
        pad(String(item.quality), COLUMN_WIDTHS.quality),
        pad(renderSignals(item), COLUMN_WIDTHS.signals),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

function renderFilters(result: RemoteDatasetDiscoveryResult): string {
  const parts = [
    `sort=${result.filters.sortBy}`,
    `type=${result.filters.fileType}`,
    `license=${result.filters.licenseName}`,
  ];
  if (result.filters.tags) parts.push(`tags=${result.filters.tags}`);
  if (result.filters.user) parts.push(`user=${result.filters.user}`);
  if (Number.isFinite(result.filters.minSize)) parts.push(`min=${result.filters.minSize}`);
  if (Number.isFinite(result.filters.maxSize)) parts.push(`max=${result.filters.maxSize}`);
  return parts.join(" ");
}

function renderFormats(formats: string[]): string {
  if (!formats.length) return "unknown";
  const top = formats.slice(0, 3);
  const extra = formats.length > 3 ? `+${formats.length - 3}` : "";
  return `${top.join(",")}${extra}`;
}

function renderFileCount(value?: number, approximate?: boolean): string {
  if (!Number.isFinite(value)) return "n/a";
  return approximate ? `${value}+` : String(value);
}

function renderSignals(item: { signals: { usability: number; votes: number; downloads: number; recency: number } }): string {
  return [
    `U${toPercent(item.signals.usability)}`,
    `V${toPercent(item.signals.votes)}`,
    `D${toPercent(item.signals.downloads)}`,
    `R${toPercent(item.signals.recency)}`,
  ].join(" ");
}

function toPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(size)}${units[unit]}`;
  return `${size.toFixed(1)}${units[unit]}`;
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ");
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}
