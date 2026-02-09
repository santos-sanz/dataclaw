import { spawn } from "node:child_process";

export async function runPythonCode(code: string, dbPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", code], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to execute python3: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Python process exited with code ${code}`));
      } else {
        resolve(stdout.trim() || "(no output)");
      }
    });
  });
}
