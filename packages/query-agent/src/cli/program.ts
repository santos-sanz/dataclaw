import { join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import dotenv from "dotenv";
import { runInteractiveSession, type InteractiveCommandContext } from "@dataclaw/tui";
import type { DatasetManifest, ModelBuildResult } from "@dataclaw/shared";
import {
  DatasetService,
  type DiscoverRemoteDatasetsOptions,
  type RemoteDatasetDiscoveryResult,
  type RemoteDatasetInspection,
} from "../services/dataset-service.js";
import type { RankedKaggleDataset } from "../services/dataset-search-ranking.js";
import { AskService } from "../services/ask-service.js";
import { MarkdownMemoryService } from "../services/memory-service.js";
import { ModelAgentService, parseTablesFlag, summarizeArtifacts, type BuildModelInput } from "../services/model-agent-service.js";
import { SessionStateService } from "../services/session-state-service.js";
import { renderDatasetDiscovery } from "./dataset-discovery-render.js";
import { renderDatasetInspection } from "./dataset-inspect-render.js";
import { renderRankedDatasetSearch } from "./dataset-search-render.js";
import { runModelBuildPreview } from "./model-build-preview.js";
import { launchModelWebApp, type LaunchModelWebAppResult } from "./model-web-app.js";
import { renderAskResult } from "./render.js";

dotenv.config({ path: join(process.cwd(), ".env") });

interface DatasetSearchService {
  searchRemoteDatasets: (query: string, fileType?: string, page?: number) => Promise<string>;
  searchRemoteDatasetsRanked: (query: string, fileType?: string, page?: number) => Promise<RankedKaggleDataset[]>;
  addDataset: (ownerSlug: string) => Promise<DatasetManifest>;
}

interface DatasetDiscoveryService {
  discoverRemoteDatasets: (options: DiscoverRemoteDatasetsOptions) => Promise<RemoteDatasetDiscoveryResult>;
  inspectRemoteDataset: (ref: string) => Promise<RemoteDatasetInspection>;
  addDataset: (ownerSlug: string) => Promise<DatasetManifest>;
}

interface ModelBuildService {
  buildModel: (input: BuildModelInput) => Promise<ModelBuildResult>;
}

export interface DatasetSearchCommandOptions {
  fileType: string;
  page: string;
  raw: boolean;
  pick: boolean;
}

export interface DatasetDiscoverCommandOptions {
  sortBy: "hottest" | "votes" | "updated" | "active" | "published";
  fileType: string;
  license: "all" | "cc" | "gpl" | "odb" | "other";
  tags?: string;
  user?: string;
  minSize?: string;
  maxSize?: string;
  page: string;
  interactive: boolean;
}

export interface ModelBuildCommandOptions {
  dataset: string;
  tables: string;
  goal?: string;
  yolo: boolean;
  web: boolean;
  port: string;
  host: string;
}

export interface ModelWebCommandOptions {
  dataset: string;
  runId?: string;
  port: string;
  host: string;
}

export interface DatasetSearchIo {
  isTTY: boolean;
  writeLine: (line: string) => void;
  prompt: (message: string) => Promise<string>;
}

type ModelPreviewRunner = (result: ModelBuildResult, io: DatasetSearchIo) => Promise<void>;
type ModelWebLauncher = (input: { datasetId: string; runId?: string; port: number; host: string }) => Promise<LaunchModelWebAppResult>;

export function createProgram(cwd: string = process.cwd()): Command {
  const program = new Command();
  const datasetService = new DatasetService(cwd);
  const askService = new AskService(cwd);
  const memoryService = new MarkdownMemoryService(cwd);
  const modelAgentService = new ModelAgentService(cwd);
  const sessionStateService = new SessionStateService(cwd);

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
      sessionStateService.setDefaultDatasetId(manifest.id);
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
      await runDatasetSearchCommand({
        searchRemoteDatasets: (value, fileType, page) => datasetService.searchRemoteDatasets(value, fileType, page),
        searchRemoteDatasetsRanked: (value, fileType, page) => datasetService.searchRemoteDatasetsRanked(value, fileType, page),
        addDataset: async (ownerSlug) => {
          const manifest = await datasetService.addDataset(ownerSlug);
          sessionStateService.setDefaultDatasetId(manifest.id);
          return manifest;
        },
      }, query, opts);
    });

  datasetCommand
    .command("discover [query]")
    .description("Interactively discover Kaggle datasets with rich inspect/install flow")
    .option("--sort-by <sortBy>", "Sort results: hottest|votes|updated|active|published", "hottest")
    .option("--file-type <type>", "Filter by file type: all|csv|sqlite|json|bigQuery|parquet", "all")
    .option("--license <license>", "License filter: all|cc|gpl|odb|other", "all")
    .option("--tags <tags>", "Comma-separated tags filter")
    .option("--user <owner>", "Filter by owner username")
    .option("--min-size <bytes>", "Minimum dataset size in bytes")
    .option("--max-size <bytes>", "Maximum dataset size in bytes")
    .option("--page <number>", "Initial result page", "1")
    .option("--no-interactive", "Disable interactive navigation")
    .action(async (query: string | undefined, opts: DatasetDiscoverCommandOptions) => {
      await runDatasetDiscoverCommand({
        discoverRemoteDatasets: (discoveryOpts) => datasetService.discoverRemoteDatasets(discoveryOpts),
        inspectRemoteDataset: (ref) => datasetService.inspectRemoteDataset(ref),
        addDataset: async (ownerSlug) => {
          const manifest = await datasetService.addDataset(ownerSlug);
          sessionStateService.setDefaultDatasetId(manifest.id);
          return manifest;
        },
      }, query ?? "", opts);
    });

  datasetCommand
    .command("inspect <ownerSlug>")
    .description("Inspect a remote Kaggle dataset with metadata and file statistics")
    .action(async (ownerSlug: string) => {
      await runDatasetInspectCommand(datasetService, ownerSlug);
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
      const prompt = opts.prompt ?? globalOpts.prompt;
      const datasetInput = opts.dataset ?? globalOpts.dataset;
      const resolvedDataset = resolveDefaultDatasetForExecution(datasetService, sessionStateService, datasetInput);

      if (!resolvedDataset || !prompt) {
        throw new Error(
          "ask requires --prompt <prompt> and a dataset. Use --dataset <datasetId>, '/dataset <id>' in TUI, or 'dataset add <owner/slug>'.",
        );
      }

      const result = await askService.ask(resolvedDataset, prompt, Boolean(opts.yolo));
      sessionStateService.setDefaultDatasetId(datasetService.datasetIdFromAny(resolvedDataset));
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

  const modelCommand = program.command("model").description("Dataset modeling commands");

  modelCommand
    .command("build")
    .description("Generate and apply SQL model, then scaffold dynamic TypeScript React components")
    .requiredOption("--dataset <datasetId>", "Local dataset id")
    .requiredOption("--tables <tables>", "Comma-separated table names to model")
    .option("--goal <goal>", "Optional modeling goal context")
    .option("--yolo", "Bypass approval gate for mutating model SQL", false)
    .option("--web", "Launch web app after build", false)
    .option("--port <port>", "Web app port when using --web", "4173")
    .option("--host <host>", "Web app host when using --web", "127.0.0.1")
    .action(async (opts: ModelBuildCommandOptions) => {
      await runModelBuildCommand(
        modelAgentService,
        opts,
        createDefaultDatasetSearchIo(),
        runModelBuildPreview,
        ({ datasetId, runId, port, host }) => launchModelWebApp({ cwd, datasetId, runId, port, host }),
      );
    });

  modelCommand
    .command("web")
    .description("Launch a local web app to visualize SQL model output")
    .requiredOption("--dataset <datasetId>", "Local dataset id")
    .option("--run-id <runId>", "Specific model run id (defaults to latest)")
    .option("--port <port>", "Web app port", "4173")
    .option("--host <host>", "Web app host", "127.0.0.1")
    .action(async (opts: ModelWebCommandOptions) => {
      await runModelWebCommand(
        cwd,
        datasetService,
        opts,
        createDefaultDatasetSearchIo(),
        ({ datasetId, runId, port, host }) => launchModelWebApp({ cwd, datasetId, runId, port, host }),
      );
    });

  program.action(async () => {
    const opts = program.opts<{ prompt?: string; dataset?: string; json?: boolean; yolo?: boolean }>();

    if (opts.prompt) {
      const resolvedDataset = resolveDefaultDatasetForExecution(datasetService, sessionStateService, opts.dataset);
      if (!resolvedDataset) {
        throw new Error(
          "--prompt requires a dataset. Use --dataset <datasetId>, '/dataset <id>' in TUI, or 'dataset add <owner/slug>'.",
        );
      }
      const result = await askService.ask(resolvedDataset, opts.prompt, Boolean(opts.yolo));
      sessionStateService.setDefaultDatasetId(datasetService.datasetIdFromAny(resolvedDataset));
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderAskResult(result));
      }
      return;
    }

    const persistedDefault = sessionStateService.resolveDefaultDatasetId(datasetService.listDatasets());
    const interactiveDatasetContext: InteractiveDatasetCommandState = {
      lastSearch: undefined,
      currentSelection: undefined,
    };
    const bannerLines = [
      "/model build --tables <t1,t2> to generate SQL model and TSX artifacts",
      "/model web to launch the web dashboard for SQL-extracted data",
      "/dataset search <query> to discover Kaggle datasets from TUI",
    ];
    if (persistedDefault.clearedInvalidDefault) {
      bannerLines.push("Persisted default dataset was removed because it is no longer available locally.");
    }

    await runInteractiveSession({
      onAsk: (prompt, options) => askService.ask(options.datasetId, prompt, options.yolo),
      onListDatasets: async () => datasetService.listDatasets(),
      onCommand: async (command, context) => {
        const datasetHandled = await runInteractiveDatasetCommand({
          command,
          context,
          datasetService,
          sessionStateService,
          state: interactiveDatasetContext,
        });
        if (datasetHandled) return true;

        return runInteractiveModelCommand({
          command,
          context,
          cwd,
          datasetService,
          modelService: modelAgentService,
        });
      },
    }, {
      compatibility: "auto",
      initialDatasetId: persistedDefault.datasetId,
      bannerLines,
      helpLines: [
        `/model help      ${"Show model command help"}`,
        `/model build ... ${"Build model from active dataset (or --dataset)"}`,
        `/model web ...   ${"Open model web app from active dataset (or --dataset)"}`,
        `/dataset help    ${"Show dataset search commands in TUI"}`,
      ],
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

export async function runModelBuildCommand(
  modelService: ModelBuildService,
  opts: ModelBuildCommandOptions,
  io: DatasetSearchIo = createDefaultDatasetSearchIo(),
  previewRunner: ModelPreviewRunner = runModelBuildPreview,
  webLauncher: ModelWebLauncher = async (input) =>
    launchModelWebApp({
      cwd: process.cwd(),
      datasetId: input.datasetId,
      runId: input.runId,
      port: input.port,
      host: input.host,
    }),
): Promise<void> {
  if (!io.isTTY && !opts.web) {
    throw new Error("Model build preview requires an interactive TTY.");
  }

  const dataset = opts.dataset?.trim();
  if (!dataset) {
    throw new Error("model build requires --dataset <datasetId>.");
  }

  const selectedTables = parseTablesFlag(opts.tables ?? "");
  if (!selectedTables.length) {
    throw new Error("model build requires --tables <table1,table2,...> with at least one table.");
  }

  const port = parsePort(opts.port ?? "4173");
  const host = (opts.host ?? "127.0.0.1").trim() || "127.0.0.1";

  const result = await modelService.buildModel({
    datasetId: dataset,
    selectedTables,
    goal: opts.goal?.trim() || undefined,
    yolo: Boolean(opts.yolo),
  });

  io.writeLine(`Model build completed: run=${result.artifacts.runId}`);
  io.writeLine(`Output directory: ${result.artifacts.outputDir}`);
  io.writeLine("Artifacts:");
  io.writeLine(summarizeArtifacts(result.artifacts.files));
  io.writeLine("");

  if (opts.web) {
    const session = await webLauncher({
      datasetId: dataset,
      runId: result.artifacts.runId,
      port,
      host,
    });
    io.writeLine(`Web app running at ${session.url}`);
    io.writeLine("Press Ctrl+C to stop the server.");
    return;
  }

  io.writeLine("Launching model preview. Type 'help' for available commands.");
  await previewRunner(result, io);
}

export async function runModelWebCommand(
  cwd: string,
  datasetService: Pick<DatasetService, "datasetIdFromAny">,
  opts: ModelWebCommandOptions,
  io: DatasetSearchIo = createDefaultDatasetSearchIo(),
  webLauncher: ModelWebLauncher = async (input) =>
    launchModelWebApp({
      cwd,
      datasetId: input.datasetId,
      runId: input.runId,
      port: input.port,
      host: input.host,
    }),
): Promise<void> {
  const datasetInput = opts.dataset?.trim();
  if (!datasetInput) {
    throw new Error("model web requires --dataset <datasetId>.");
  }

  const datasetId = datasetService.datasetIdFromAny(datasetInput);
  const port = parsePort(opts.port ?? "4173");
  const host = (opts.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const runId = opts.runId?.trim() || undefined;

  const session = await webLauncher({
    datasetId,
    runId,
    port,
    host,
  });

  io.writeLine(`Model web app running at ${session.url}`);
  io.writeLine(`Dataset: ${datasetId}`);
  io.writeLine(`Run: ${session.runId}`);
  io.writeLine("Press Ctrl+C to stop the server.");
}

export async function runDatasetInspectCommand(
  datasetService: Pick<DatasetDiscoveryService, "inspectRemoteDataset">,
  ownerSlug: string,
  io: DatasetSearchIo = createDefaultDatasetSearchIo(),
): Promise<void> {
  const inspection = await datasetService.inspectRemoteDataset(ownerSlug);
  io.writeLine(renderDatasetInspection(inspection));
}

export async function runDatasetDiscoverCommand(
  datasetService: DatasetDiscoveryService,
  query: string,
  opts: DatasetDiscoverCommandOptions,
  io: DatasetSearchIo = createDefaultDatasetSearchIo(),
): Promise<void> {
  if (opts.interactive && !io.isTTY) {
    throw new Error("Interactive discovery requires a TTY. Use --no-interactive for one-shot output.");
  }

  const state = {
    query: query.trim(),
    page: parsePositiveInt(opts.page, 1),
  };

  const filters: DiscoverRemoteDatasetsOptions = {
    sortBy: opts.sortBy ?? "hottest",
    fileType: opts.fileType ?? "all",
    licenseName: opts.license ?? "all",
    tags: opts.tags?.trim() || undefined,
    user: opts.user?.trim() || undefined,
    minSize: parseOptionalNonNegativeInt("min-size", opts.minSize),
    maxSize: parseOptionalNonNegativeInt("max-size", opts.maxSize),
  };
  if (Number.isFinite(filters.minSize) && Number.isFinite(filters.maxSize) && (filters.maxSize as number) < (filters.minSize as number)) {
    throw new Error("--max-size must be greater than or equal to --min-size.");
  }

  while (true) {
    const discovered = await datasetService.discoverRemoteDatasets({
      ...filters,
      query: state.query,
      page: state.page,
    });
    io.writeLine(renderDatasetDiscovery(discovered));

    if (!opts.interactive) return;

    let needsRefresh = false;
    while (!needsRefresh) {
      const answer = (await io.prompt("discover> ")).trim();
      if (!answer) continue;

      if (answer === "quit" || answer === "exit") {
        return;
      }
      if (answer === "help") {
        io.writeLine(renderDatasetDiscoverHelp());
        continue;
      }
      if (answer === "next") {
        state.page += 1;
        needsRefresh = true;
        continue;
      }
      if (answer === "prev") {
        state.page = Math.max(1, state.page - 1);
        needsRefresh = true;
        continue;
      }
      if (answer === "search") {
        state.query = "";
        state.page = 1;
        needsRefresh = true;
        continue;
      }
      if (answer.startsWith("search ")) {
        state.query = answer.slice("search ".length).trim();
        state.page = 1;
        needsRefresh = true;
        continue;
      }
      if (answer === "filters") {
        io.writeLine(renderActiveDiscoverFilters(state.query, state.page, filters));
        continue;
      }
      if (answer.startsWith("open ")) {
        const inputText = answer.slice("open ".length).trim();
        const selection = resolveDatasetPickSelection(inputText, discovered.results);
        if (selection.kind !== "selected") {
          io.writeLine(`Invalid selection '${inputText}'.`);
          continue;
        }
        await runDatasetInspectCommand(datasetService, selection.dataset.ref, io);
        continue;
      }
      if (answer.startsWith("install ")) {
        const inputText = answer.slice("install ".length).trim();
        const selection = resolveDatasetPickSelection(inputText, discovered.results);
        if (selection.kind !== "selected") {
          io.writeLine(`Invalid selection '${inputText}'.`);
          continue;
        }
        const manifest = await datasetService.addDataset(selection.dataset.ref);
        io.writeLine(`Dataset installed: ${manifest.id}`);
        io.writeLine(`Tables: ${manifest.tables.map((table) => table.name).join(", ") || "(none)"}`);
        continue;
      }

      io.writeLine("Unknown command. Use help, open, install, next, prev, search, filters, or quit.");
    }
  }
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

function renderDatasetDiscoverHelp(): string {
  return [
    "Discovery commands:",
    "  open <rank|owner/slug>     Inspect dataset details",
    "  install <rank|owner/slug>  Install selected dataset",
    "  next                        Go to next result page",
    "  prev                        Go to previous result page",
    "  search <query>              Replace current search query",
    "  search                      Reset to empty query",
    "  filters                     Show active filters",
    "  quit                        Exit discovery",
  ].join("\n");
}

function renderActiveDiscoverFilters(query: string, page: number, filters: DiscoverRemoteDatasetsOptions): string {
  const queryLabel = query ? `"${query}"` : "(empty)";
  const parts = [
    `query=${queryLabel}`,
    `page=${page}`,
    `sort=${filters.sortBy ?? "hottest"}`,
    `type=${filters.fileType ?? "all"}`,
    `license=${filters.licenseName ?? "all"}`,
  ];
  if (filters.tags) parts.push(`tags=${filters.tags}`);
  if (filters.user) parts.push(`user=${filters.user}`);
  if (Number.isFinite(filters.minSize)) parts.push(`min=${filters.minSize}`);
  if (Number.isFinite(filters.maxSize)) parts.push(`max=${filters.maxSize}`);
  return `Active filters: ${parts.join(" ")}`;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalNonNegativeInt(name: string, value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid --${name} value '${value}'. Expected a non-negative integer.`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid --port value '${value}'. Expected an integer between 1 and 65535.`);
  }
  return parsed;
}

interface InteractiveDatasetCommandState {
  lastSearch?: InteractiveDatasetSearchSnapshot;
  currentSelection?: string;
}

interface InteractiveDatasetSearchSnapshot {
  query: string;
  page: number;
  filters: DiscoverRemoteDatasetsOptions;
  results: RankedKaggleDataset[];
}

interface InteractiveDatasetCommandInput {
  command: string;
  context: InteractiveCommandContext;
  datasetService: Pick<
    DatasetService,
    "discoverRemoteDatasets" | "inspectRemoteDataset" | "addDataset" | "datasetIdFromAny" | "listDatasets"
  >;
  sessionStateService: Pick<SessionStateService, "setDefaultDatasetId">;
  state: InteractiveDatasetCommandState;
}

interface InteractiveModelCommandInput {
  command: string;
  context: InteractiveCommandContext;
  cwd: string;
  datasetService: Pick<DatasetService, "datasetIdFromAny" | "getManifest">;
  modelService: ModelBuildService;
}

async function runInteractiveDatasetCommand(input: InteractiveDatasetCommandInput): Promise<boolean> {
  const normalized = normalizeInteractiveDatasetInput(input.command);
  if (!normalized) return false;

  const tokens = tokenizeShellish(normalized);
  const action = tokens[1]?.toLowerCase();

  if (tokens.length === 1 || action === "help") {
    input.context.writeLine(renderInteractiveDatasetHelp());
    return true;
  }

  if (action === "search") {
    const parsed = parseDatasetSearchInteractiveArgs(tokens.slice(2), input.state.lastSearch?.filters);
    const discovered = await input.datasetService.discoverRemoteDatasets(parsed);
    input.state.lastSearch = toInteractiveDatasetSearchSnapshot(discovered);
    input.context.writeLine(renderDatasetDiscovery(discovered));
    return true;
  }

  if (action === "next" || action === "prev") {
    if (!input.state.lastSearch) {
      input.context.writeLine("No active dataset search. Run '/dataset search <query>' first.");
      return true;
    }
    const nextPage =
      action === "next"
        ? input.state.lastSearch.page + 1
        : Math.max(1, input.state.lastSearch.page - 1);
    const discovered = await input.datasetService.discoverRemoteDatasets({
      ...input.state.lastSearch.filters,
      query: input.state.lastSearch.query,
      page: nextPage,
    });
    input.state.lastSearch = toInteractiveDatasetSearchSnapshot(discovered);
    input.context.writeLine(renderDatasetDiscovery(discovered));
    return true;
  }

  if (action === "filters") {
    if (!input.state.lastSearch) {
      input.context.writeLine("No active dataset search. Run '/dataset search <query>' first.");
      return true;
    }
    input.context.writeLine(
      renderActiveDiscoverFilters(
        input.state.lastSearch.query,
        input.state.lastSearch.page,
        input.state.lastSearch.filters,
      ),
    );
    return true;
  }

  if (action === "open") {
    const value = tokens.slice(2).join(" ").trim();
    if (!value) {
      throw new Error("Usage: /dataset open <rank|owner/slug>");
    }
    const ref = resolveInteractiveDatasetRef(value, input.state.lastSearch?.results ?? []);
    if (!ref) {
      throw new Error(`Invalid dataset selection '${value}'.`);
    }
    input.state.currentSelection = ref;
    await runDatasetInspectCommand(input.datasetService, ref, {
      isTTY: input.context.isTTY,
      writeLine: input.context.writeLine,
      prompt: input.context.prompt,
    });
    return true;
  }

  if (action === "add") {
    const value = tokens.slice(2).join(" ").trim();
    if (!value) {
      throw new Error("Usage: /dataset add <rank|owner/slug>");
    }
    const ref = resolveInteractiveDatasetRef(value, input.state.lastSearch?.results ?? []);
    if (!ref) {
      throw new Error(`Invalid dataset selection '${value}'.`);
    }
    const manifest = await input.datasetService.addDataset(ref);
    input.context.setDatasetId(manifest.id);
    input.sessionStateService.setDefaultDatasetId(manifest.id);
    input.context.writeLine(`Dataset installed: ${manifest.id}`);
    input.context.writeLine(`Tables: ${manifest.tables.map((table) => table.name).join(", ") || "(none)"}`);
    input.context.writeLine(`Active dataset set to: ${manifest.id}`);
    return true;
  }

  if (action && !action.startsWith("--")) {
    const desired = input.datasetService.datasetIdFromAny(tokens.slice(1).join(" ").trim());
    if (!desired) {
      throw new Error("Usage: /dataset <id> or /dataset search <query>");
    }
    const existing = input.datasetService.listDatasets();
    if (!existing.includes(desired)) {
      throw new Error(`Dataset '${desired}' is not available locally. Use /datasets or /dataset add <rank|owner/slug>.`);
    }
    input.context.setDatasetId(desired);
    input.sessionStateService.setDefaultDatasetId(desired);
    input.context.writeLine(`Active dataset set to: ${desired}`);
    return true;
  }

  throw new Error("Unknown /dataset command. Use '/dataset help'.");
}

export function normalizeInteractiveDatasetInput(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (candidate.startsWith("/")) {
    candidate = candidate.slice(1).trim();
  }
  if (/^dataclaw\s+/i.test(candidate)) {
    candidate = candidate.replace(/^dataclaw\s+/i, "").trim();
  }

  if (!/^dataset(?:\s|$)/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function parseDatasetSearchInteractiveArgs(
  args: string[],
  fallback?: DiscoverRemoteDatasetsOptions,
): DiscoverRemoteDatasetsOptions {
  const base: DiscoverRemoteDatasetsOptions = {
    sortBy: fallback?.sortBy ?? "hottest",
    fileType: fallback?.fileType ?? "all",
    licenseName: fallback?.licenseName ?? "all",
    tags: fallback?.tags,
    user: fallback?.user,
    minSize: fallback?.minSize,
    maxSize: fallback?.maxSize,
    query: fallback?.query ?? "",
    page: fallback?.page ?? 1,
  };

  const queryParts: string[] = [];
  let hasExplicitPage = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--sort-by") {
      base.sortBy = readArgValue(args, token, index) as DiscoverRemoteDatasetsOptions["sortBy"];
      index += 1;
      continue;
    }
    if (token === "--file-type") {
      base.fileType = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--license") {
      base.licenseName = readArgValue(args, token, index) as DiscoverRemoteDatasetsOptions["licenseName"];
      index += 1;
      continue;
    }
    if (token === "--tags") {
      base.tags = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--user") {
      base.user = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--min-size") {
      base.minSize = parseOptionalNonNegativeInt("min-size", readArgValue(args, token, index));
      index += 1;
      continue;
    }
    if (token === "--max-size") {
      base.maxSize = parseOptionalNonNegativeInt("max-size", readArgValue(args, token, index));
      index += 1;
      continue;
    }
    if (token === "--page") {
      base.page = parsePositiveInt(readArgValue(args, token, index), 1);
      hasExplicitPage = true;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown flag '${token}' for /dataset search.`);
    }
    queryParts.push(token);
  }

  const query = queryParts.join(" ").trim();
  base.query = query || base.query || "";
  if (query && !hasExplicitPage) {
    base.page = 1;
  }

  if (Number.isFinite(base.minSize) && Number.isFinite(base.maxSize) && (base.maxSize as number) < (base.minSize as number)) {
    throw new Error("--max-size must be greater than or equal to --min-size.");
  }

  return base;
}

function resolveInteractiveDatasetRef(inputText: string, ranked: RankedKaggleDataset[]): string | null {
  if (/^\d+$/.test(inputText)) {
    const pick = resolveDatasetPickSelection(inputText, ranked);
    return pick.kind === "selected" ? pick.dataset.ref : null;
  }
  if (inputText.includes("/")) return inputText;
  const direct = ranked.find((dataset) => dataset.ref === inputText);
  return direct?.ref ?? null;
}

function toInteractiveDatasetSearchSnapshot(result: RemoteDatasetDiscoveryResult): InteractiveDatasetSearchSnapshot {
  return {
    query: result.query,
    page: result.page,
    filters: {
      sortBy: result.filters.sortBy as DiscoverRemoteDatasetsOptions["sortBy"],
      fileType: result.filters.fileType,
      licenseName: result.filters.licenseName as DiscoverRemoteDatasetsOptions["licenseName"],
      tags: result.filters.tags,
      user: result.filters.user,
      minSize: result.filters.minSize,
      maxSize: result.filters.maxSize,
    },
    results: result.results,
  };
}

async function runInteractiveModelCommand(input: InteractiveModelCommandInput): Promise<boolean> {
  const normalized = normalizeInteractiveModelInput(input.command);
  if (!normalized) {
    return false;
  }

  const tokens = tokenizeShellish(normalized);
  const subcommand = tokens[1]?.toLowerCase();
  if (tokens.length === 1 || (tokens.length === 2 && subcommand === "help")) {
    input.context.writeLine(renderInteractiveModelHelp());
    return true;
  }

  const args = tokens.slice(2);
  const io: DatasetSearchIo = {
    isTTY: input.context.isTTY,
    writeLine: input.context.writeLine,
    prompt: input.context.prompt,
  };
  const webLauncher: ModelWebLauncher = ({ datasetId, runId, port, host }) =>
    launchModelWebApp({ cwd: input.cwd, datasetId, runId, port, host });

  if (subcommand === "build") {
    const parsed = parseModelBuildInteractiveArgs(args, input.context);
    if (!parsed.tables.trim()) {
      const mappedDataset = input.datasetService.datasetIdFromAny(parsed.dataset);
      const manifest = input.datasetService.getManifest(mappedDataset);
      if (!manifest.tables.length) {
        throw new Error(`Dataset '${mappedDataset}' has no tables available for model build.`);
      }
      parsed.dataset = mappedDataset;
      parsed.tables = manifest.tables.map((table) => table.name).join(",");
      io.writeLine(`No --tables provided. Using all dataset tables: ${manifest.tables.map((table) => table.name).join(", ")}`);
    }
    await runModelBuildCommand(
      input.modelService,
      parsed,
      io,
      runModelBuildPreview,
      webLauncher,
    );
    return true;
  }

  if (subcommand === "web") {
    const parsed = parseModelWebInteractiveArgs(args, input.context);
    await runModelWebCommand(
      input.cwd,
      input.datasetService,
      parsed,
      io,
      webLauncher,
    );
    return true;
  }

  throw new Error(`Unknown /model subcommand '${subcommand}'. Use '/model help'.`);
}

export function normalizeInteractiveModelInput(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (candidate.startsWith("/")) {
    candidate = candidate.slice(1).trim();
  }
  if (/^dataclaw\s+/i.test(candidate)) {
    candidate = candidate.replace(/^dataclaw\s+/i, "").trim();
  }
  if (!/^model(?:\s|$)/i.test(candidate)) {
    return null;
  }
  return candidate;
}

function parseModelBuildInteractiveArgs(
  args: string[],
  context: InteractiveCommandContext,
): ModelBuildCommandOptions {
  let dataset = context.datasetId;
  let tables = "";
  let goal: string | undefined;
  let yolo = context.yolo;
  let web = false;
  let port = "4173";
  let host = "127.0.0.1";

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--dataset") {
      dataset = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--tables") {
      tables = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--goal") {
      goal = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--port") {
      port = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--host") {
      host = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--web") {
      web = true;
      continue;
    }
    if (token === "--yolo") {
      yolo = true;
      continue;
    }
    if (token === "--no-yolo") {
      yolo = false;
      continue;
    }

    throw new Error(`Unknown flag '${token}' for /model build.`);
  }

  return {
    dataset,
    tables,
    goal,
    yolo,
    web,
    port,
    host,
  };
}

function parseModelWebInteractiveArgs(
  args: string[],
  context: InteractiveCommandContext,
): ModelWebCommandOptions {
  let dataset = context.datasetId;
  let runId: string | undefined;
  let port = "4173";
  let host = "127.0.0.1";

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--dataset") {
      dataset = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--run-id") {
      runId = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--port") {
      port = readArgValue(args, token, index);
      index += 1;
      continue;
    }
    if (token === "--host") {
      host = readArgValue(args, token, index);
      index += 1;
      continue;
    }

    throw new Error(`Unknown flag '${token}' for /model web.`);
  }

  return {
    dataset,
    runId,
    port,
    host,
  };
}

function readArgValue(args: string[], flag: string, index: number): string {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for '${flag}'.`);
  }
  return next;
}

function tokenizeShellish(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    tokens.push(raw.replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

function renderInteractiveModelHelp(): string {
  return [
    "Model commands:",
    "  /model build --tables <t1,t2> [--goal \"text\"] [--web] [--port 4173] [--host 127.0.0.1]",
    "  /model web [--run-id <id>] [--port 4173] [--host 127.0.0.1]",
    "  /model ... commands use active dataset from /dataset unless --dataset is provided.",
  ].join("\n");
}

function renderInteractiveDatasetHelp(): string {
  return [
    "Dataset commands:",
    "  /dataset <id>                                  Set active local dataset and persist as default",
    "  /dataset search <query> [--file-type <type>]  Search Kaggle datasets",
    "  /dataset search ... [--sort-by <value>] [--license <value>] [--tags <csv>] [--user <owner>]",
    "  /dataset search ... [--min-size <bytes>] [--max-size <bytes>] [--page <number>]",
    "  /dataset open <rank|owner/slug>               Inspect remote dataset details",
    "  /dataset add <rank|owner/slug>                Install dataset, set active dataset, persist as default",
    "  /dataset next | /dataset prev                 Navigate last search pagination",
    "  /dataset filters                              Show active filters for last search",
    "  /dataset help                                 Show this help",
  ].join("\n");
}

function resolveDefaultDatasetForExecution(
  datasetService: Pick<DatasetService, "listDatasets">,
  sessionStateService: Pick<SessionStateService, "resolveDefaultDatasetId">,
  explicitDataset?: string,
): string | undefined {
  if (explicitDataset?.trim()) return explicitDataset.trim();
  const persisted = sessionStateService.resolveDefaultDatasetId(datasetService.listDatasets());
  return persisted.datasetId;
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
