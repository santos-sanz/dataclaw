import type { AskResult } from "./contracts.js";

export interface AskRenderOptions {
  maxWidth?: number;
  maxColumnWidth?: number;
  maxLearningItems?: number;
  maxLearningPreviewChars?: number;
  useColor?: boolean;
  sectionStyle?: "classic" | "panel";
  useUnicodeBorders?: boolean;
}

const MIN_SECTION_WIDTH = 60;
const DEFAULT_SECTION_WIDTH = 100;
const MAX_SECTION_WIDTH = 160;
const DEFAULT_MAX_COLUMN_WIDTH = 28;
const MIN_COLUMN_WIDTH = 8;
const DEFAULT_MAX_LEARNING_ITEMS = 4;
const DEFAULT_MAX_LEARNING_PREVIEW_CHARS = 160;
const DEFAULT_SECTION_STYLE = "classic";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
};

export function renderAskResult(result: AskResult, options: AskRenderOptions = {}): string {
  const width = clamp(options.maxWidth ?? DEFAULT_SECTION_WIDTH, MIN_SECTION_WIDTH, MAX_SECTION_WIDTH);
  const maxColumnWidth = Math.max(MIN_COLUMN_WIDTH, options.maxColumnWidth ?? DEFAULT_MAX_COLUMN_WIDTH);
  const maxLearningItems = Math.max(1, options.maxLearningItems ?? DEFAULT_MAX_LEARNING_ITEMS);
  const maxLearningPreviewChars = Math.max(60, options.maxLearningPreviewChars ?? DEFAULT_MAX_LEARNING_PREVIEW_CHARS);
  const useColor = options.useColor ?? shouldUseColor();
  const sectionStyle = options.sectionStyle ?? DEFAULT_SECTION_STYLE;
  const useUnicodeBorders = options.useUnicodeBorders ?? shouldUseUnicodeBorders();

  const sections: string[] = [];

  sections.push(
    renderSection(
      "PLAN",
      [
        ...renderKeyValue("Intent", result.plan.intent, width),
        ...renderKeyValue("Language", result.plan.language.toUpperCase(), width),
        ...renderKeyValue("Expected shape", result.plan.expectedShape, width),
        ...renderKeyValue("Requires approval", result.plan.requiresApproval ? "yes" : "no", width),
        ...renderKeyValue("Fallback used", result.fallbackUsed ? "yes" : "no", width),
      ],
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  sections.push(
    renderSection(
      "COMMAND",
      renderCodeBlock(result.command, width),
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  sections.push(
    renderSection(
      "RESULT",
      renderQueryResult(result.result, { width, maxColumnWidth }),
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  sections.push(
    renderSection(
      "EXPLANATION",
      wrapText(result.explanation, width),
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  sections.push(
    renderSection(
      "SOURCE TABLES",
      result.sourceTables.length ? result.sourceTables.map((table) => `- ${table}`) : ["(none)"],
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  sections.push(
    renderSection(
      "LEARNINGS USED",
      renderLearnings(result.learningsUsed, { maxItems: maxLearningItems, maxPreviewChars: maxLearningPreviewChars, width }),
      width,
      useColor,
      sectionStyle,
      useUnicodeBorders,
    ),
  );

  return sections.join("\n\n");
}

function renderSection(
  title: string,
  lines: string[],
  width: number,
  useColor: boolean,
  sectionStyle: "classic" | "panel",
  useUnicodeBorders: boolean,
): string {
  if (sectionStyle === "panel") {
    return renderPanelSection(title, lines, width, useColor, useUnicodeBorders);
  }

  const border = colorize("=".repeat(width), "dim", useColor);
  const label = colorize(`[${title}]`, "cyan", useColor);
  const body = lines.length ? lines.join("\n") : "(none)";
  return [border, label, body].join("\n");
}

function renderPanelSection(
  title: string,
  lines: string[],
  width: number,
  useColor: boolean,
  useUnicodeBorders: boolean,
): string {
  const borderChars = useUnicodeBorders
    ? { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" }
    : { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" };

  const top = colorize(`${borderChars.tl}${borderChars.h.repeat(width + 2)}${borderChars.tr}`, "dim", useColor);
  const bottom = colorize(`${borderChars.bl}${borderChars.h.repeat(width + 2)}${borderChars.br}`, "dim", useColor);
  const heading = renderPanelRow(`[${title}]`, width, useColor, "cyan", borderChars.v);
  const bodyRows = (lines.length ? lines : ["(none)"]).map((line) => renderPanelRow(line, width, useColor, "dim", borderChars.v));

  return [top, heading, ...bodyRows, bottom].join("\n");
}

function renderPanelRow(
  line: string,
  width: number,
  useColor: boolean,
  tone: "cyan" | "dim",
  verticalBorder: string,
): string {
  const normalized = truncate(line, width, "...");
  const padded = normalized.padEnd(width, " ");
  const leftBorder = colorize(verticalBorder, "dim", useColor);
  const rightBorder = colorize(verticalBorder, "dim", useColor);
  const content = colorize(padded, tone, useColor);
  return `${leftBorder} ${content} ${rightBorder}`;
}

function renderCodeBlock(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ["(empty)"];
  return trimmed
    .split(/\r?\n/)
    .flatMap((line) => wrapText(line, width, "  "));
}

function renderKeyValue(key: string, value: string, width: number): string[] {
  return wrapText(value || "(none)", width, `${key}: `);
}

function renderLearnings(
  learnings: string[],
  options: { maxItems: number; maxPreviewChars: number; width: number },
): string[] {
  if (!learnings.length) return ["(none)"];

  const normalized = learnings
    .map((item) => oneLine(item))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, options.maxItems)
    .map((item, index) => truncate(item, options.maxPreviewChars, "..."))
    .flatMap((item, index) => wrapText(item, options.width, `${index + 1}. `));

  return normalized.length ? normalized : ["(none)"];
}

function renderQueryResult(
  resultText: string,
  options: { width: number; maxColumnWidth: number },
): string[] {
  const table = parseTabularResult(resultText);
  if (!table) {
    const compact = resultText.trim();
    return compact ? wrapText(compact, options.width) : ["(empty)"];
  }

  const formattedRows = table.rows.map((row) => row.map((cell) => oneLine(cell)));
  const colCount = table.headers.length;
  const alignRight = new Array<boolean>(colCount).fill(false).map((_, colIndex) =>
    formattedRows.every((row) => isNumericValue(row[colIndex] ?? "")),
  );

  const widths = table.headers.map((header, colIndex) => {
    const maxDataWidth = formattedRows.reduce((acc, row) => Math.max(acc, (row[colIndex] ?? "").length), 0);
    return Math.max((header ?? "").length, maxDataWidth, MIN_COLUMN_WIDTH);
  });

  for (let i = 0; i < widths.length; i += 1) {
    widths[i] = Math.min(widths[i], options.maxColumnWidth);
  }

  fitWidthsToTarget(widths, options.width);

  const renderRow = (cells: string[]): string =>
    `| ${cells
      .map((cell, colIndex) => formatCell(cell, widths[colIndex], alignRight[colIndex]))
      .join(" | ")} |`;

  const headerRow = renderRow(table.headers);
  const divider = `| ${widths.map((colWidth) => "-".repeat(colWidth)).join(" | ")} |`;
  const dataRows = formattedRows.map((row) => renderRow(row));

  return [headerRow, divider, ...dataRows];
}

function fitWidthsToTarget(widths: number[], targetLineWidth: number): void {
  if (!widths.length) return;

  let currentWidth = totalTableLineWidth(widths);
  while (currentWidth > targetLineWidth) {
    let reduced = false;
    for (let i = 0; i < widths.length; i += 1) {
      if (widths[i] > MIN_COLUMN_WIDTH) {
        widths[i] -= 1;
        reduced = true;
        currentWidth = totalTableLineWidth(widths);
        if (currentWidth <= targetLineWidth) return;
      }
    }
    if (!reduced) return;
  }
}

function totalTableLineWidth(widths: number[]): number {
  if (!widths.length) return 0;
  return widths.reduce((acc, width) => acc + width, 0) + (widths.length * 3) + 1;
}

function parseTabularResult(input: string): { headers: string[]; rows: string[][] } | null {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!lines.length) return null;
  if (!lines.every((line) => line.includes("\t"))) return null;

  const parsed = lines.map((line) => line.split("\t"));
  const colCount = parsed[0].length;
  if (colCount <= 1) return null;
  if (!parsed.every((cells) => cells.length === colCount)) return null;

  return {
    headers: parsed[0],
    rows: parsed.slice(1),
  };
}

function formatCell(value: string, width: number, rightAlign: boolean): string {
  const normalized = truncate(oneLine(value), width, "...");
  if (normalized.length >= width) return normalized;
  const padding = " ".repeat(width - normalized.length);
  return rightAlign ? `${padding}${normalized}` : `${normalized}${padding}`;
}

function wrapText(text: string, width: number, prefix: string = ""): string[] {
  const normalized = oneLine(text);
  if (!normalized) return [prefix ? `${prefix}(none)` : "(none)"];

  const availableWidth = Math.max(20, width - prefix.length);
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const token = current ? `${current} ${word}` : word;
    if (token.length <= availableWidth) {
      current = token;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (word.length <= availableWidth) {
      current = word;
      continue;
    }

    const slices = chunkWord(word, availableWidth);
    lines.push(...slices.slice(0, -1));
    current = slices[slices.length - 1] ?? "";
  }

  if (current) lines.push(current);

  return lines.map((line, index) => (index === 0 ? `${prefix}${line}` : `${" ".repeat(prefix.length)}${line}`));
}

function chunkWord(word: string, chunkSize: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += chunkSize) {
    parts.push(word.slice(i, i + chunkSize));
  }
  return parts;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number, suffix: string): string {
  if (text.length <= maxLength) return text;
  const safeLength = Math.max(0, maxLength - suffix.length);
  return `${text.slice(0, safeLength)}${suffix}`;
}

function isNumericValue(value: string): boolean {
  return /^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function shouldUseColor(): boolean {
  if (!process.stdout.isTTY) return false;
  if ("NO_COLOR" in process.env) return false;
  return true;
}

function shouldUseUnicodeBorders(): boolean {
  if (!process.stdout.isTTY) return false;
  return (process.env.TERM ?? "").toLowerCase() !== "dumb";
}

function colorize(text: string, tone: "cyan" | "dim", useColor: boolean): string {
  if (!useColor) return text;
  if (tone === "cyan") return `${ANSI.bold}${ANSI.cyan}${text}${ANSI.reset}`;
  return `${ANSI.dim}${text}${ANSI.reset}`;
}
