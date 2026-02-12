import type { RemoteDatasetInspection } from "../services/dataset-service.js";

export function renderDatasetInspection(
  inspection: RemoteDatasetInspection,
  opts: { maxDescriptionLength?: number } = {},
): string {
  const maxDescriptionLength = opts.maxDescriptionLength ?? 1200;
  const lines: string[] = [];

  lines.push(`Dataset: ${inspection.ref}`);
  lines.push(`Title: ${inspection.title}`);
  if (inspection.subtitle) lines.push(`Subtitle: ${inspection.subtitle}`);
  lines.push(
    `Updated: ${inspection.lastUpdated ?? "n/a"}  Size: ${formatBytes(inspection.totalBytes)}  Files: ${inspection.fileStats.totalFiles}${inspection.fileStats.truncated ? "+" : ""}`,
  );
  lines.push("");

  if (inspection.description) {
    lines.push("Description:");
    lines.push(truncate(inspection.description.replace(/\s+/g, " ").trim(), maxDescriptionLength));
    lines.push("");
  }

  lines.push(`Owner: ${inspection.owner ?? "n/a"}  Slug: ${inspection.datasetSlug ?? "n/a"}`);
  lines.push(`Licenses: ${inspection.licenses.length ? inspection.licenses.join(", ") : "n/a"}`);
  lines.push(`Tags: ${inspection.tags.length ? inspection.tags.join(", ") : "n/a"}`);
  lines.push("");

  if (inspection.llmSummary || inspection.llmRationale || inspection.llmUseCases?.length || inspection.llmCaveats?.length) {
    lines.push("LLM insights:");
    if (inspection.llmSummary) {
      lines.push(`  Summary: ${inspection.llmSummary}`);
    }
    if (inspection.llmRationale) {
      lines.push(`  Rationale: ${inspection.llmRationale}`);
    }
    if (inspection.llmUseCases?.length) {
      lines.push("  Suggested use cases:");
      for (const useCase of inspection.llmUseCases) {
        lines.push(`    - ${useCase}`);
      }
    }
    if (inspection.llmCaveats?.length) {
      lines.push("  Caveats:");
      for (const caveat of inspection.llmCaveats) {
        lines.push(`    - ${caveat}`);
      }
    }
    lines.push("");
  }

  lines.push(
    `Quality signals: quality=${inspection.quality ?? "n/a"} votes=${inspection.voteCount ?? "n/a"} downloads=${inspection.downloadCount ?? "n/a"} usability=${inspection.usabilityRating ?? "n/a"}`,
  );
  if (inspection.signals) {
    lines.push(
      `Signal breakdown: U${toPercent(inspection.signals.usability)} V${toPercent(inspection.signals.votes)} D${toPercent(inspection.signals.downloads)} R${toPercent(inspection.signals.recency)}`,
    );
  }
  lines.push("");

  lines.push("File formats:");
  if (!inspection.fileStats.byFormat.length) {
    lines.push("  (no files)");
  } else {
    for (const stat of inspection.fileStats.byFormat) {
      lines.push(`  - ${stat.format}: count=${stat.count} size=${formatBytes(stat.totalBytes)}`);
    }
  }
  lines.push("");

  lines.push("Largest files:");
  if (!inspection.fileStats.topFiles.length) {
    lines.push("  (no files)");
  } else {
    lines.push("name                            format    size       created");
    lines.push("------------------------------------------------------------");
    for (const file of inspection.fileStats.topFiles.slice(0, 10)) {
      lines.push(
        `${pad(file.name, 30)}  ${pad(file.format, 8)}  ${pad(formatBytes(file.totalBytes), 9)}  ${file.creationDate || "n/a"}`,
      );
    }
  }

  if (inspection.fileStats.truncated && inspection.fileStats.nextPageToken) {
    lines.push("");
    lines.push(`Note: file listing truncated (next page token: ${inspection.fileStats.nextPageToken}).`);
  }

  return lines.join("\n");
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

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return `${value.slice(0, Math.max(0, width - 3))}...`;
  return value.padEnd(width, " ");
}
