import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { extname, join } from "node:path";

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function fileSize(path: string): number {
  return statSync(path).size;
}

export function listFilesRecursively(root: string): string[] {
  const output: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const items = readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const absolute = join(current, item.name);
      if (item.isDirectory()) {
        stack.push(absolute);
      } else {
        output.push(absolute);
      }
    }
  }

  return output;
}

export function detectFileType(path: string): "csv" | "parquet" | "sqlite" | "json" | "other" {
  const ext = extname(path).toLowerCase();
  if ([".csv", ".tsv"].includes(ext)) return "csv";
  if (ext === ".parquet") return "parquet";
  if ([".sqlite", ".sqlite3", ".db"].includes(ext)) return "sqlite";
  if ([".json", ".ndjson", ".jsonl"].includes(ext)) return "json";
  return "other";
}

export function safeTableName(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "table";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readText(path: string): string {
  return readFileSync(path, "utf-8");
}

export function writeText(path: string, content: string): void {
  writeFileSync(path, content, "utf-8");
}

export function appendText(path: string, content: string): void {
  appendFileSync(path, content, "utf-8");
}
