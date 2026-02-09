import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { renderAskResult, type AskResult } from "@dataclaw/shared";

export interface InteractiveSessionHandlers {
  onAsk: (prompt: string, options: { datasetId: string; yolo: boolean }) => Promise<AskResult>;
  onListDatasets: () => Promise<string[]>;
}

export async function runInteractiveSession(handlers: InteractiveSessionHandlers): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let datasetId = "";
  let yolo = false;

  printBanner();

  while (true) {
    const raw = (await rl.question(`dataclaw${datasetId ? `(${datasetId})` : ""}> `)).trim();
    if (!raw) continue;

    if (raw === "/exit" || raw === "/quit") {
      break;
    }

    if (raw === "/help") {
      printHelp();
      continue;
    }

    if (raw.startsWith("/dataset ")) {
      datasetId = raw.replace("/dataset", "").trim();
      output.write(`Active dataset set to: ${datasetId}\n`);
      continue;
    }

    if (raw === "/datasets") {
      const datasets = await handlers.onListDatasets();
      output.write(datasets.length ? `${datasets.join("\n")}\n` : "No datasets were added yet.\n");
      continue;
    }

    if (raw === "/yolo on") {
      yolo = true;
      output.write("YOLO mode enabled.\n");
      continue;
    }

    if (raw === "/yolo off") {
      yolo = false;
      output.write("YOLO mode disabled.\n");
      continue;
    }

    if (!datasetId) {
      output.write("No active dataset. Use /dataset <dataset-id> before asking questions.\n");
      continue;
    }

    try {
      const result = await handlers.onAsk(raw, { datasetId, yolo });
      renderResult(result);
    } catch (error) {
      output.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  rl.close();
}

function printBanner(): void {
  output.write("DataClaw Interactive Mode\n");
  output.write("Type /help for commands.\n\n");
}

function printHelp(): void {
  output.write([
    "Commands:",
    "  /help            Show this help",
    "  /dataset <id>    Set active dataset",
    "  /datasets        List ingested datasets",
    "  /yolo on|off     Toggle approval bypass",
    "  /exit            Exit interactive mode",
  ].join("\n") + "\n");
}

function renderResult(result: AskResult): void {
  output.write("\n");
  output.write(
    `${renderAskResult(result, {
      maxWidth: output.columns ?? 100,
    })}\n\n`,
  );
}
