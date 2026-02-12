import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectory } from "../utils/fs-utils.js";
import {
  parseKaggleDatasetFilesCsv,
  parseKaggleDatasetSearchCsv,
  type KaggleDatasetFileRow,
  type KaggleDatasetSearchRow,
} from "./dataset-search-ranking.js";

export type KaggleDatasetSortBy = "hottest" | "votes" | "updated" | "active" | "published";
export type KaggleDatasetLicenseName = "all" | "cc" | "gpl" | "odb" | "other";

export interface KaggleDatasetSearchOptions {
  query?: string;
  page?: number;
  sortBy?: KaggleDatasetSortBy;
  fileType?: string;
  licenseName?: KaggleDatasetLicenseName;
  tags?: string;
  user?: string;
  minSize?: number;
  maxSize?: number;
}

export interface KaggleListFilesPage {
  csv: string;
  nextPageToken?: string;
  rawOutput: string;
}

export interface KaggleListAllFilesResult {
  files: KaggleDatasetFileRow[];
  nextPageToken?: string;
  truncated: boolean;
  pagesFetched: number;
}

export class KaggleService {
  async listFiles(dataset: string): Promise<string> {
    return runKaggleCommand(["datasets", "files", dataset]);
  }

  async listFilesCsv(dataset: string): Promise<string> {
    return runKaggleCommand(["datasets", "files", dataset, "--csv"]);
  }

  async listFilesCsvPage(dataset: string, pageToken?: string, pageSize: number = 1000): Promise<KaggleListFilesPage> {
    const args = ["datasets", "files", dataset, "--csv", "--page-size", String(pageSize)];
    if (pageToken) {
      args.push("--page-token", pageToken);
    }

    const output = await runKaggleCommand(args);
    const parsed = extractPaginatedCsv(output);
    return {
      csv: parsed.csv,
      nextPageToken: parsed.nextPageToken,
      rawOutput: output,
    };
  }

  async listFilesParsed(dataset: string): Promise<KaggleDatasetFileRow[]> {
    const page = await this.listFilesCsvPage(dataset);
    return parseKaggleDatasetFilesCsv(page.csv);
  }

  async listAllFilesParsed(dataset: string, maxPages: number = 10, pageSize: number = 1000): Promise<KaggleListAllFilesResult> {
    const files: KaggleDatasetFileRow[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    while (pageCount < Math.max(1, maxPages)) {
      const page = await this.listFilesCsvPage(dataset, pageToken, pageSize);
      files.push(...parseKaggleDatasetFilesCsv(page.csv));
      pageCount += 1;
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }

    return {
      files,
      nextPageToken: pageToken,
      truncated: Boolean(pageToken),
      pagesFetched: pageCount,
    };
  }

  async downloadDatasetMetadataJson(dataset: string): Promise<Record<string, unknown>> {
    const tempRoot = mkdtempSync(join(tmpdir(), "dataclaw-kaggle-meta-"));
    try {
      await runKaggleCommand(["datasets", "metadata", dataset, "-p", tempRoot]);
      const path = join(tempRoot, "dataset-metadata.json");
      if (!existsSync(path)) {
        throw new Error(`Unable to locate dataset metadata file at '${path}'.`);
      }
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Kaggle metadata payload is not a JSON object.");
      }
      return parsed as Record<string, unknown>;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  async downloadDataset(dataset: string, outputDir: string): Promise<void> {
    ensureDirectory(outputDir);
    await runKaggleCommand(["datasets", "download", dataset, "-p", outputDir, "--unzip", "-o"]);
  }

  async searchDatasets(query: string, fileType?: string, page?: number): Promise<string>;
  async searchDatasets(options: KaggleDatasetSearchOptions): Promise<string>;
  async searchDatasets(
    queryOrOptions: string | KaggleDatasetSearchOptions,
    fileType?: string,
    page: number = 1,
  ): Promise<string> {
    const options = toSearchOptions(queryOrOptions, fileType, page);
    const args = buildDatasetSearchArgs(options);
    return runKaggleCommand(args);
  }

  async searchDatasetsParsed(query: string, fileType?: string, page?: number): Promise<KaggleDatasetSearchRow[]>;
  async searchDatasetsParsed(options: KaggleDatasetSearchOptions): Promise<KaggleDatasetSearchRow[]>;
  async searchDatasetsParsed(
    queryOrOptions: string | KaggleDatasetSearchOptions,
    fileType?: string,
    page: number = 1,
  ): Promise<KaggleDatasetSearchRow[]> {
    const csv =
      typeof queryOrOptions === "string"
        ? await this.searchDatasets(queryOrOptions, fileType, page)
        : await this.searchDatasets(queryOrOptions);
    return parseKaggleDatasetSearchCsv(csv);
  }
}

export function extractPaginatedCsv(output: string): { csv: string; nextPageToken?: string } {
  if (!output.trim()) return { csv: "" };

  const lines = output.split(/\r?\n/);
  const csvLines: string[] = [];
  let nextPageToken: string | undefined;

  for (const line of lines) {
    const match = line.match(/^\s*Next Page Token\s*=\s*(.+)\s*$/i);
    if (match?.[1]) {
      nextPageToken = match[1].trim();
      continue;
    }
    csvLines.push(line);
  }

  return {
    csv: csvLines.join("\n").trim(),
    nextPageToken,
  };
}

function toSearchOptions(
  queryOrOptions: string | KaggleDatasetSearchOptions,
  fileType?: string,
  page: number = 1,
): KaggleDatasetSearchOptions {
  if (typeof queryOrOptions === "string") {
    return {
      query: queryOrOptions,
      fileType,
      page,
    };
  }
  return {
    page: queryOrOptions.page ?? 1,
    ...queryOrOptions,
  };
}

function buildDatasetSearchArgs(options: KaggleDatasetSearchOptions): string[] {
  const args = ["datasets", "list", "--csv"];

  args.push("--page", String(Math.max(1, options.page ?? 1)));

  if (options.query) {
    args.push("--search", options.query);
  }
  if (options.sortBy) {
    args.push("--sort-by", options.sortBy);
  }
  if (options.fileType && options.fileType !== "all") {
    args.push("--file-type", options.fileType);
  }
  if (options.licenseName && options.licenseName !== "all") {
    args.push("--license", options.licenseName);
  }
  if (options.tags) {
    args.push("--tags", options.tags);
  }
  if (options.user) {
    args.push("--user", options.user);
  }
  if (Number.isFinite(options.minSize)) {
    args.push("--min-size", String(options.minSize));
  }
  if (Number.isFinite(options.maxSize)) {
    args.push("--max-size", String(options.maxSize));
  }

  return args;
}

function runKaggleCommand(args: string[]): Promise<string> {
  const env = resolveKaggleEnvironment();
  assertKaggleCredentials(env);
  return runKaggleWithFallback(args, env);
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to execute '${command}'. Ensure the Kaggle CLI is installed and available in PATH. Root error: ${error.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function resolveKaggleEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const localKaggleConfigDir = join(process.cwd(), ".kaggle");
  const localKaggleJson = join(localKaggleConfigDir, "kaggle.json");
  if (existsSync(localKaggleJson) && !env.KAGGLE_CONFIG_DIR) {
    env.KAGGLE_CONFIG_DIR = localKaggleConfigDir;
  }
  return env;
}

function assertKaggleCredentials(env: NodeJS.ProcessEnv): void {
  const hasLegacy = Boolean(env.KAGGLE_USERNAME && env.KAGGLE_KEY);
  const hasToken = Boolean(env.KAGGLE_API_TOKEN);
  const localFile = join(env.KAGGLE_CONFIG_DIR ?? join(process.cwd(), ".kaggle"), "kaggle.json");
  const homeFile = join(homedir(), ".kaggle", "kaggle.json");
  const hasFile = existsSync(localFile) || existsSync(homeFile);

  if (!hasLegacy && !hasToken && !hasFile) {
    throw new Error(
      "Kaggle credentials are missing. Set KAGGLE_USERNAME and KAGGLE_KEY (or KAGGLE_API_TOKEN) in .env, or create .kaggle/kaggle.json.",
    );
  }
}

async function runKaggleWithFallback(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const localUserKaggle = join(homedir(), "Library", "Python");
  const candidateCommands: Array<{ command: string; argsPrefix: string[] }> = [
    ...(env.KAGGLE_BIN ? [{ command: env.KAGGLE_BIN, argsPrefix: [] }] : []),
    { command: "kaggle", argsPrefix: [] },
    { command: join(localUserKaggle, "3.12", "bin", "kaggle"), argsPrefix: [] },
    { command: join(localUserKaggle, "3.11", "bin", "kaggle"), argsPrefix: [] },
    { command: "python3", argsPrefix: ["-m", "kaggle"] },
  ];

  let lastFailure: Error | undefined;

  for (const candidate of candidateCommands) {
    // Skip explicit file candidates that do not exist.
    if (candidate.command.includes("/") && !existsSync(candidate.command)) {
      continue;
    }

    try {
      return await runCommand(candidate.command, [...candidate.argsPrefix, ...args], env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notFound = /ENOENT|Failed to execute/.test(message);
      if (!notFound) {
        throw error;
      }
      lastFailure = error instanceof Error ? error : new Error(message);
    }
  }

  throw (
    lastFailure ??
    new Error("Unable to execute Kaggle CLI. Install it or set KAGGLE_BIN to the kaggle executable path.")
  );
}
