import type { ModelBuildResult, ModelPreviewItem } from "@dataclaw/shared";

export interface ModelBuildPreviewIo {
  isTTY: boolean;
  writeLine: (line: string) => void;
  prompt: (message: string) => Promise<string>;
}

export async function runModelBuildPreview(result: ModelBuildResult, io: ModelBuildPreviewIo): Promise<void> {
  io.writeLine(renderPreviewHeader(result));
  io.writeLine(renderPreviewHelp());

  const previewById = new Map(result.previewItems.map((item) => [item.id, item]));

  while (true) {
    const answer = (await io.prompt("model> ")).trim();
    if (!answer) continue;

    if (answer === "quit" || answer === "exit") {
      return;
    }
    if (answer === "help") {
      io.writeLine(renderPreviewHelp());
      continue;
    }
    if (answer === "overview") {
      io.writeLine(getOverviewText(result.previewItems));
      continue;
    }
    if (answer === "sql") {
      io.writeLine(renderSqlStatements(result));
      continue;
    }
    if (answer === "components") {
      io.writeLine(renderComponents(result));
      continue;
    }
    if (answer === "files") {
      io.writeLine(renderFiles(result));
      continue;
    }
    if (answer.startsWith("open ")) {
      const id = answer.slice("open ".length).trim();
      const item = previewById.get(id);
      if (!item) {
        io.writeLine(`Unknown item id '${id}'. Use 'components', 'files', or 'sql' to inspect available ids.`);
        continue;
      }
      io.writeLine(renderOpenItem(item));
      continue;
    }

    io.writeLine("Unknown command. Use overview, sql, components, files, open <id>, help, or quit.");
  }
}

function renderPreviewHeader(result: ModelBuildResult): string {
  return [
    "Model build preview",
    "-------------------",
    `Run id: ${result.artifacts.runId}`,
    `Dataset: ${result.request.datasetId}`,
    `Output: ${result.artifacts.outputDir}`,
    `Strategy: ${result.plan.strategy}`,
    "",
  ].join("\n");
}

function renderPreviewHelp(): string {
  return [
    "Preview commands:",
    "  overview         Show build summary",
    "  sql              Show generated SQL statements",
    "  components       List generated component artifacts",
    "  files            List all generated files",
    "  open <id>        Open artifact content by id",
    "  help             Show this help",
    "  quit             Exit preview",
  ].join("\n");
}

function getOverviewText(items: ModelPreviewItem[]): string {
  const overview = items.find((item) => item.kind === "overview");
  return overview?.content ?? "No overview data available.";
}

function renderSqlStatements(result: ModelBuildResult): string {
  const lines = ["Generated SQL:"];
  result.plan.sqlStatements.forEach((statement, index) => {
    lines.push("");
    lines.push(`${index + 1}.`);
    lines.push(statement.trim().endsWith(";") ? statement.trim() : `${statement.trim()};`);
  });

  const sqlArtifact = result.artifacts.files.find((file) => file.kind === "sql");
  if (sqlArtifact) {
    lines.push("");
    lines.push(`Open full SQL with: open ${sqlArtifact.id}`);
  }

  return lines.join("\n");
}

function renderComponents(result: ModelBuildResult): string {
  const components = result.artifacts.files.filter((file) =>
    file.path.includes("/components/") || file.path.includes("\\components\\"),
  );

  if (!components.length) {
    return "No component artifacts were generated.";
  }

  return [
    "Component artifacts:",
    ...components.map((file) => `- ${file.id} (${file.kind}) ${file.path}`),
  ].join("\n");
}

function renderFiles(result: ModelBuildResult): string {
  return [
    "Generated files:",
    ...result.artifacts.files.map((file) => `- ${file.id} (${file.kind}) ${file.path}`),
  ].join("\n");
}

function renderOpenItem(item: ModelPreviewItem): string {
  const lines = [
    `Item: ${item.id}`,
    `Title: ${item.title}`,
  ];
  if (item.path) {
    lines.push(`Path: ${item.path}`);
  }
  lines.push("", item.content.trimEnd());
  return lines.join("\n");
}
