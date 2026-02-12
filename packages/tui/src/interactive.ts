import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import boxen from "boxen";
import ora from "ora";
import stringWidth from "string-width";
import { renderAskResult, type AskResult } from "@dataclaw/shared";
import { buildTheme, resolveThemeContext, type CompatibilityMode, type Theme } from "./theme.js";

export interface InteractiveSessionHandlers {
  onAsk: (prompt: string, options: { datasetId: string; yolo: boolean }) => Promise<AskResult>;
  onListDatasets: () => Promise<string[]>;
}

export interface InteractiveSessionOptions {
  compatibility?: CompatibilityMode;
}

export interface PromptRenderState {
  datasetId: string;
  yolo: boolean;
}

export function renderPrompt(state: PromptRenderState, theme: Theme): string {
  const head = theme.style.accent("dataclaw");
  const staticVisibleWidth = stringWidth("dataclaw") + stringWidth("[yolo:off]") + 6;
  const availableDatasetWidth = Math.max(16, theme.context.width - staticVisibleWidth);
  const datasetValue = state.datasetId || "none";
  const datasetText = `dataset:${truncateDisplay(datasetValue, availableDatasetWidth)}`;
  const yoloText = `yolo:${state.yolo ? "on" : "off"}`;

  return [
    head,
    renderBadge(datasetText, state.datasetId ? "accent" : "muted", theme),
    renderBadge(yoloText, state.yolo ? "warn" : "success", theme),
    `${theme.style.muted(theme.symbols.prompt)} `,
  ].join(" ");
}

export function createInteractiveBanner(theme: Theme): string {
  const lines = [
    `${theme.style.accent("DataClaw")}${theme.style.muted(" interactive session")}`,
    `${theme.symbols.bullet} /dataset <id> to choose active dataset`,
    `${theme.symbols.bullet} /datasets to list ingested datasets`,
    `${theme.symbols.bullet} /yolo on|off to toggle approval bypass`,
    `${theme.symbols.bullet} /help for commands, /exit to quit`,
  ];

  return boxen(lines.join("\n"), {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: theme.context.useUnicode ? "round" : "classic",
    borderColor: theme.context.useColor ? "cyan" : undefined,
  });
}

export function formatSystemMessage(
  tone: "info" | "success" | "warn" | "error",
  message: string,
  theme: Theme,
): string {
  const icon =
    tone === "success"
      ? theme.symbols.success
      : tone === "warn"
        ? theme.symbols.warn
        : tone === "error"
          ? theme.symbols.error
          : theme.symbols.info;

  const text = `${icon} ${message}`;
  if (tone === "success") return theme.style.success(text);
  if (tone === "warn") return theme.style.warn(text);
  if (tone === "error") return theme.style.error(text);
  return theme.style.muted(text);
}

export async function runInteractiveSession(
  handlers: InteractiveSessionHandlers,
  options: InteractiveSessionOptions = {},
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let datasetId = "";
  let yolo = false;

  const theme = buildTheme(
    resolveThemeContext({
      compatibility: options.compatibility ?? "auto",
      isTTY: Boolean(input.isTTY && output.isTTY),
      columns: output.columns,
      env: process.env,
    }),
  );

  output.write(`${createInteractiveBanner(theme)}\n\n`);

  while (true) {
    const raw = (await rl.question(renderPrompt({ datasetId, yolo }, theme))).trim();
    if (!raw) continue;

    if (raw === "/exit" || raw === "/quit") {
      break;
    }

    if (raw === "/help") {
      output.write(`${renderHelp(theme)}\n`);
      continue;
    }

    if (raw.startsWith("/dataset ")) {
      datasetId = raw.replace("/dataset", "").trim();
      output.write(`${formatSystemMessage("success", `Active dataset set to: ${datasetId}`, theme)}\n`);
      continue;
    }

    if (raw === "/datasets") {
      const datasets = await handlers.onListDatasets();
      if (!datasets.length) {
        output.write(`${formatSystemMessage("warn", "No datasets were added yet.", theme)}\n`);
        continue;
      }
      output.write(`${theme.style.muted(`${theme.symbols.info} Local datasets:`)}\n`);
      output.write(`${datasets.map((dataset) => `${theme.symbols.bullet} ${dataset}`).join("\n")}\n`);
      continue;
    }

    if (raw === "/yolo on") {
      yolo = true;
      output.write(`${formatSystemMessage("warn", "YOLO mode enabled.", theme)}\n`);
      continue;
    }

    if (raw === "/yolo off") {
      yolo = false;
      output.write(`${formatSystemMessage("info", "YOLO mode disabled.", theme)}\n`);
      continue;
    }

    if (!datasetId) {
      output.write(
        `${formatSystemMessage("error", "No active dataset. Use /dataset <dataset-id> before asking questions.", theme)}\n`,
      );
      continue;
    }

    const spinner = ora({
      text: "Running query...",
      spinner: theme.context.useUnicode ? "dots" : "line",
      isEnabled: Boolean(output.isTTY),
    }).start();

    try {
      const result = await handlers.onAsk(raw, { datasetId, yolo });
      spinner.succeed("Query completed.");
      renderResult(result, theme);
    } catch (error) {
      spinner.fail("Query failed.");
      output.write(
        `${formatSystemMessage("error", `Error: ${error instanceof Error ? error.message : String(error)}`, theme)}\n`,
      );
    }
  }

  rl.close();
}

function renderHelp(theme: Theme): string {
  const lines = [
    theme.style.accent("Commands:"),
    `  /help            ${theme.style.muted("Show this help")}`,
    `  /dataset <id>    ${theme.style.muted("Set active dataset")}`,
    `  /datasets        ${theme.style.muted("List ingested datasets")}`,
    `  /yolo on|off     ${theme.style.muted("Toggle approval bypass")}`,
    `  /exit            ${theme.style.muted("Exit interactive mode")}`,
  ];

  return boxen(lines.join("\n"), {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: theme.context.useUnicode ? "round" : "classic",
    borderColor: theme.context.useColor ? "yellow" : undefined,
  });
}

function renderResult(result: AskResult, theme: Theme): void {
  output.write("\n");
  output.write(
    `${renderAskResult(result, {
      maxWidth: output.columns ?? theme.context.width,
      useColor: theme.context.useColor,
      sectionStyle: "panel",
      useUnicodeBorders: theme.context.useUnicode,
    })}\n\n`,
  );
}

function renderBadge(
  text: string,
  tone: "accent" | "success" | "warn" | "muted",
  theme: Theme,
): string {
  const value = `[${text}]`;
  if (tone === "accent") return theme.style.accent(value);
  if (tone === "success") return theme.style.success(value);
  if (tone === "warn") return theme.style.warn(value);
  return theme.style.muted(value);
}

function truncateDisplay(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) return value;
  const ellipsis = "...";
  const allowed = Math.max(4, maxWidth - stringWidth(ellipsis));
  let out = "";

  for (const char of value) {
    const candidate = `${out}${char}`;
    if (stringWidth(candidate) > allowed) break;
    out = candidate;
  }

  return `${out}${ellipsis}`;
}
