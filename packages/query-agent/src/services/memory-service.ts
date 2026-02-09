import { basename, join } from "node:path";
import { ensureDirectory, appendText, listFilesRecursively, readText, sha256, writeText } from "../utils/fs-utils.js";
import { ensureProjectDirectories, getDatasetRoot, getProjectPaths } from "@dataclaw/shared";

export interface LearningInput {
  datasetId: string;
  symptom: string;
  rootCause: string;
  fix: string;
  command: string;
  language: "sql" | "python";
}

export interface MemorySearchResult {
  snippet: string;
  source: string;
  score: number;
}

export class MarkdownMemoryService {
  constructor(private readonly cwd: string) {
    ensureProjectDirectories(cwd);
  }

  async saveLearning(input: LearningInput): Promise<void> {
    const projectPaths = getProjectPaths(this.cwd);
    const datasetRoot = getDatasetRoot(input.datasetId, this.cwd);
    const dailyFile = join(datasetRoot, "memory", `${today()}.md`);
    ensureDirectory(join(datasetRoot, "memory"));

    const fingerprint = sha256(`${input.datasetId}:${input.symptom}:${input.fix}`);
    const existing = this.readAllMemoryText(input.datasetId);
    if (existing.includes(fingerprint)) {
      return;
    }

    const block = [
      `## Learning ${fingerprint.slice(0, 12)}`,
      `- dataset_id: ${input.datasetId}`,
      `- symptom: ${input.symptom}`,
      `- root_cause: ${input.rootCause}`,
      `- fix: ${input.fix}`,
      `- language: ${input.language}`,
      `- command: ${input.command.replace(/\n/g, " ")}`,
      `- confidence: 0.75`,
      `- tags: auto-learning,execution-retry`,
      `- created_at: ${new Date().toISOString()}`,
      `- fingerprint: ${fingerprint}`,
      "",
    ].join("\n");

    appendText(dailyFile, block);

    const globalDailyFile = join(projectPaths.globalMemoryRoot, `${today()}.md`);
    ensureDirectory(projectPaths.globalMemoryRoot);
    appendText(globalDailyFile, block);
  }

  search(query: string, datasetId?: string): MemorySearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const files = this.memoryFiles(datasetId);
    const results: MemorySearchResult[] = [];

    for (const file of files) {
      const text = readText(file);
      const lowered = text.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (lowered.includes(term) ? 1 : 0), 0);
      if (score > 0) {
        results.push({
          snippet: text.split("\n").slice(0, 12).join("\n"),
          source: file,
          score,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 12);
  }

  async curate(datasetId?: string): Promise<string[]> {
    const files = this.memoryFiles(datasetId).filter((file) => file.endsWith(".md") && !file.endsWith("MEMORY.md"));
    const grouped = new Map<string, { count: number; snippet: string }>();

    for (const file of files) {
      const text = readText(file);
      for (const block of text.split("## Learning ")) {
        if (!block.trim()) continue;
        const fingerprintMatch = block.match(/fingerprint:\s*([a-f0-9]+)/i);
        const fingerprint = fingerprintMatch?.[1];
        if (!fingerprint) continue;

        const existing = grouped.get(fingerprint);
        if (existing) {
          existing.count += 1;
          continue;
        }

        grouped.set(fingerprint, { count: 1, snippet: `## Learning ${block.trim()}\n` });
      }
    }

    const promoted = [...grouped.entries()]
      .filter(([, value]) => value.count >= 1)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50);

    const target = datasetId
      ? join(getDatasetRoot(datasetId, this.cwd), "MEMORY.md")
      : join(this.cwd, "MEMORY.md");

    ensureDirectory(join(target, ".."));
    const header = "# Curated Memory\n\n";
    const body = promoted.map(([, value]) => value.snippet).join("\n");
    writeText(target, header + body);

    return promoted.map(([fingerprint]) => fingerprint);
  }

  private memoryFiles(datasetId?: string): string[] {
    const projectPaths = getProjectPaths(this.cwd);
    const files = [projectPaths.globalCuratedMemoryPath];

    try {
      files.push(...listFilesRecursively(projectPaths.globalMemoryRoot));
    } catch {
      // Ignore empty state
    }

    if (datasetId) {
      const root = getDatasetRoot(datasetId, this.cwd);
      files.push(join(root, "MEMORY.md"));
      try {
        files.push(...listFilesRecursively(join(root, "memory")));
      } catch {
        // Ignore empty state
      }
    } else {
      try {
        files.push(...listFilesRecursively(projectPaths.datasetsRoot).filter((path) => basename(path).endsWith(".md")));
      } catch {
        // Ignore empty state
      }
    }

    return [...new Set(files)].filter((path) => {
      try {
        readText(path);
        return true;
      } catch {
        return false;
      }
    });
  }

  private readAllMemoryText(datasetId: string): string {
    return this.memoryFiles(datasetId)
      .map((path) => {
        try {
          return readText(path);
        } catch {
          return "";
        }
      })
      .join("\n");
  }
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}
