import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureDirectory } from "../utils/fs-utils.js";

export class KaggleService {
  async listFiles(dataset: string): Promise<string> {
    return runKaggleCommand(["datasets", "files", dataset]);
  }

  async downloadDataset(dataset: string, outputDir: string): Promise<void> {
    ensureDirectory(outputDir);
    await runKaggleCommand(["datasets", "download", dataset, "-p", outputDir, "--unzip", "-o"]);
  }

  async searchDatasets(query: string, fileType?: string, page: number = 1): Promise<string> {
    const args = ["datasets", "list", "--search", query, "--page", String(page), "--csv"];
    if (fileType && fileType !== "all") {
      args.push("--file-type", fileType);
    }
    return runKaggleCommand(args);
  }
}

function runKaggleCommand(args: string[]): Promise<string> {
  const env = resolveKaggleEnvironment();
  assertKaggleCredentials(env);
  return runCommand("kaggle", args, env);
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
