import { spawn } from "node:child_process";
import { ensureDirectory } from "../utils/fs-utils.js";

export class KaggleService {
  async listFiles(dataset: string): Promise<string> {
    return runCommand("kaggle", ["datasets", "files", dataset]);
  }

  async downloadDataset(dataset: string, outputDir: string): Promise<void> {
    ensureDirectory(outputDir);
    await runCommand("kaggle", ["datasets", "download", dataset, "-p", outputDir, "--unzip", "-o"]);
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to execute '${command}'. Ensure it is installed. Root error: ${error.message}`));
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
