import { join } from "node:path";
import { Command } from "commander";
import dotenv from "dotenv";
import { runInteractiveSession } from "@dataclaw/tui";
import { DatasetService } from "../services/dataset-service.js";
import { AskService } from "../services/ask-service.js";
import { MarkdownMemoryService } from "../services/memory-service.js";
import { renderAskResult } from "./render.js";

dotenv.config({ path: join(process.cwd(), ".env") });

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
    .option("--file-type <type>", "Optional file type filter: all|csv|sqlite|json|bigQuery", "all")
    .option("--page <number>", "Result page number", "1")
    .action(async (query: string, opts: { fileType: string; page: string }) => {
      const page = Number.parseInt(opts.page, 10);
      const output = await datasetService.searchRemoteDatasets(query, opts.fileType, Number.isNaN(page) ? 1 : page);
      console.log(output || "(no datasets)");
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
    .requiredOption("--dataset <datasetId>", "Local dataset id")
    .requiredOption("--prompt <prompt>", "Question to execute")
    .option("--yolo", "Bypass approval gate", false)
    .action(async (opts: { dataset: string; prompt: string; yolo: boolean }) => {
      const result = await askService.ask(opts.dataset, opts.prompt, Boolean(opts.yolo));
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
