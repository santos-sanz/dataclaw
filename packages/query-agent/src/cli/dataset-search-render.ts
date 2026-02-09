import type { RankedKaggleDataset } from "../services/dataset-search-ranking.js";

const COLUMN_WIDTHS = {
  rank: 3,
  ref: 32,
  title: 44,
  formats: 18,
  size: 10,
  quality: 7,
  signals: 22,
};

export function renderRankedDatasetSearch(results: RankedKaggleDataset[]): string {
  if (!results.length) return "No datasets found.";

  const header = [
    pad("#", COLUMN_WIDTHS.rank),
    pad("ref", COLUMN_WIDTHS.ref),
    pad("title", COLUMN_WIDTHS.title),
    pad("formats", COLUMN_WIDTHS.formats),
    pad("size", COLUMN_WIDTHS.size),
    pad("quality", COLUMN_WIDTHS.quality),
    pad("signals", COLUMN_WIDTHS.signals),
  ].join("  ");

  const divider = "-".repeat(header.length);
  const rows = results.map((dataset) =>
    [
      pad(String(dataset.rank), COLUMN_WIDTHS.rank),
      pad(dataset.ref, COLUMN_WIDTHS.ref),
      pad(dataset.title, COLUMN_WIDTHS.title),
      pad(renderFormats(dataset.formats), COLUMN_WIDTHS.formats),
      pad(formatBytes(dataset.totalBytes), COLUMN_WIDTHS.size),
      pad(String(dataset.quality), COLUMN_WIDTHS.quality),
      pad(renderSignals(dataset), COLUMN_WIDTHS.signals),
    ].join("  "),
  );

  return [header, divider, ...rows].join("\n");
}

function renderFormats(formats: string[]): string {
  if (!formats.length) return "unknown";
  const capped = formats.slice(0, 3);
  const suffix = formats.length > 3 ? `+${formats.length - 3}` : "";
  return `${capped.join(",")}${suffix}`;
}

function renderSignals(dataset: RankedKaggleDataset): string {
  return [
    `U${toPercent(dataset.signals.usability)}`,
    `V${toPercent(dataset.signals.votes)}`,
    `D${toPercent(dataset.signals.downloads)}`,
    `R${toPercent(dataset.signals.recency)}`,
  ].join(" ");
}

function toPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(size)}${units[unitIndex]}`;
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ");
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}
