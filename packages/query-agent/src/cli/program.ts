import { join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import dotenv from "dotenv";
import { runInteractiveSession } from "@dataclaw/tui";
import type { DatasetManifest } from "@dataclaw/shared";
import { DatasetService } from "../services/dataset-service.js";
import type { RankedKaggleDataset } from "../services/dataset-search-ranking.js";
import { AskService } from "../services/ask-service.js";
import { MarkdownMemoryService } from "../services/memory-service.js";
import { renderRankedDatasetSearch } from "./dataset-search-render.js";
import { renderAskResult } from "./render.js";

dotenv.config({ path: join(process.cwd(), ".env") });

interface DatasetSearchService {
  searchRemoteDatasets: (query: string, fileType?: string, page?: number) => Promise<string>;
  searchRemoteDatasetsRanked: (query: string, fileType?: string, page?: number) => Promise<RankedKaggleDataset[]>;
  addDataset: (ownerSlug: string) => Promise<DatasetManifest>;
}

export interface DatasetSearchCommandOptions {
  fileType: string;
  page: string;
  raw: boolean;
  pick: boolean;
}

export interface DatasetSearchIo {
  isTTY: boolean;
  writeLine: (line: string) => void;
  prompt: (message: string) => Promise<string>;
}

export function createProgram(cwd: string = process.cwd()): Command {
  const program = new Command();
  const datasetService = new DatasetService(cwd);
  const askService = new AskService(cwd);
  const memoryService = new MarkdownMemoryService(cwd);

  program
    .name("dataclaw")
    .description("Kaggle-focused query agent powered by OpenRouter and DuckDB")
    .option("-p, --prompt <prompt>", "Run one-shot prompt mode")
    .option("--dataset <datasetId>", "Dataset id for prompt mode")
    .option("--json", "Emit one-shot result as JSON", false)
    .option("--yolo", "Bypass approval gate for mutating commands", false);

  const datasetCommand = program.command("dataset").description("Dataset management commands");

  datasetCommand
    .command("add <ownerSlug>")
    .description("Download Kaggle dataset, ingest into canonical DuckDB, and build manifest")
    .action(async (ownerSlug: string) => {
      const manifest = await datasetService.addDataset(ownerSlug);
      console.log(`Dataset added: ${manifest.id}`);
      console.log(`Tables: ${manifest.tables.map((table) => table.name).join(", ") || "(none)"}`);
    });

  datasetCommand
    .command("files <ownerSlug>")
    .description("List remote files for a Kaggle dataset")
    .action(async (ownerSlug: string) => {
      const output = await datasetService.listRemoteFiles(ownerSlug);
      console.log(output || "(no files)");
    });

  datasetCommand
    .command("search <query>")
    .description("Search remote Kaggle datasets you can work with")
    .option("--file-type <type>", "Optional file type filter: all|csv|sqlite|json|bigQuery|parquet", "all")
    .option("--page <number>", "Result page number", "1")
    .option("--raw", "Print Kaggle CSV output as-is", false)
    .option("--pick", "Interactively pick a ranked dataset and install it", false)
    .action(async (query: string, opts: DatasetSearchCommandOptions) => {
      await runDatasetSearchCommand(datasetService, query, opts);
    });

  datasetCommand
    .command("list")
    .description("List ingested local datasets")
    .action(() => {
      const datasets = datasetService.listDatasets();
      if (!datasets.length) {
        console.log("No local datasets found.");
        return;
      }
      for (const dataset of datasets) {
        console.log(dataset);
      }
    });

  program
    .command("ask")
    .description("Ask a question against a specific dataset")
    .option("--dataset <datasetId>", "Local dataset id")
    .option("--prompt <prompt>", "Question to execute")
    .option("--yolo", "Bypass approval gate", false)
    .action(async (opts: { dataset?: string; prompt?: string; yolo: boolean }) => {
      const globalOpts = program.opts<{ dataset?: string; prompt?: string; yolo?: boolean }>();
      const dataset = opts.dataset ?? globalOpts.dataset;
      const prompt = opts.prompt ?? globalOpts.prompt;

      if (!dataset || !prompt) {
        throw new Error("ask requires --dataset <datasetId> and --prompt <prompt>");
      }

      const result = await askService.ask(dataset, prompt, Boolean(opts.yolo));
      console.log(renderAskResult(result));
    });

  const memoryCommand = program.command("memory").description("Memory management commands");

  memoryCommand
    .command("search <query>")
    .description("Search markdown memory entries")
    .option("--dataset <datasetId>", "Dataset scope")
    .action((query: string, opts: { dataset?: string }) => {
      const hits = memoryService.search(query, opts.dataset);
      if (!hits.length) {
        console.log("No memory matches found.");
        return;
      }

      hits.forEach((hit, index) => {
        console.log(`#${index + 1} score=${hit.score} source=${hit.source}`);
        console.log(hit.snippet);
        console.log("---");
      });
    });

  memoryCommand
    .command("curate")
    .description("Promote memory learnings into curated MEMORY.md")
    .option("--dataset <datasetId>", "Dataset scope")
    .action(async (opts: { dataset?: string }) => {
      const promoted = await memoryService.curate(opts.dataset);
      console.log(`Curated ${promoted.length} learning entries.`);
    });

  program.action(async () => {
    const opts = program.opts<{ prompt?: string; dataset?: string; json?: boolean; yolo?: boolean }>();

    if (opts.prompt) {
      if (!opts.dataset) {
        throw new Error("--dataset is required when using --prompt");
      }
      const result = await askService.ask(opts.dataset, opts.prompt, Boolean(opts.yolo));
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderAskResult(result));
      }
      return;
    }

    await runInteractiveSession({
      onAsk: (prompt, options) => askService.ask(options.datasetId, prompt, options.yolo),
      onListDatasets: async () => datasetService.listDatasets(),
    });
  });

  return program;
}

export async function runDatasetSearchCommand(
  datasetService: DatasetSearchService,
  query: string,
  opts: DatasetSearchCommandOptions,
  io: DatasetSearchIo = createDefaultDatasetSearchIo(),
): Promise<void> {
  const page = Number.parseInt(opts.page, 10);
  const safePage = Number.isNaN(page) ? 1 : page;

  if (opts.raw && opts.pick) {
    throw new Error("--raw and --pick cannot be used together.");
  }

  if (opts.raw) {
    const raw = await datasetService.searchRemoteDatasets(query, opts.fileType, safePage);
    io.writeLine(raw);
    return;
  }

  const ranked = await datasetService.searchRemoteDatasetsRanked(query, opts.fileType, safePage);
  io.writeLine(renderRankedDatasetSearch(ranked));

  if (!opts.pick) return;
  if (!io.isTTY) {
    throw new Error("--pick requires an interactive TTY.");
  }
  if (!ranked.length) {
    io.writeLine("No ranked datasets available to install.");
    return;
  }

  const answer = (await io.prompt("Select dataset to install (rank number, ref, Enter to skip): ")).trim();
  const selection = resolveDatasetPickSelection(answer, ranked);
  if (selection.kind === "skip") {
    io.writeLine("Install skipped.");
    return;
  }
  if (selection.kind === "invalid") {
    io.writeLine(`Invalid selection '${answer}'. Installation skipped.`);
    return;
  }

  const manifest = await datasetService.addDataset(selection.dataset.ref);
  io.writeLine(`Dataset installed: ${manifest.id}`);
  io.writeLine(`Tables: ${manifest.tables.map((table) => table.name).join(", ") || "(none)"}`);
}

export function resolveDatasetPickSelection(
  inputText: string,
  ranked: RankedKaggleDataset[],
): { kind: "skip" } | { kind: "invalid" } | { kind: "selected"; dataset: RankedKaggleDataset } {
  if (!inputText) return { kind: "skip" };

  if (/^\d+$/.test(inputText)) {
    const index = Number.parseInt(inputText, 10);
    if (index >= 1 && index <= ranked.length) {
      return { kind: "selected", dataset: ranked[index - 1] };
    }
    return { kind: "invalid" };
  }

  const direct = ranked.find((item) => item.ref === inputText);
  if (direct) return { kind: "selected", dataset: direct };

  return { kind: "invalid" };
}

function createDefaultDatasetSearchIo(): DatasetSearchIo {
  return {
    isTTY: Boolean(input.isTTY && output.isTTY),
    writeLine: (line: string) => {
      console.log(line);
    },
    prompt: async (message: string) => {
      const rl = readline.createInterface({ input, output });
      try {
        return await rl.question(message);
      } finally {
        rl.close();
      }
    },
  };
}
