import { chmodSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const hookFile = join(process.cwd(), ".githooks", "pre-commit");

if (!existsSync(hookFile)) {
  console.warn("[hooks] .githooks/pre-commit not found, skipping git hook setup.");
  process.exit(0);
}

try {
  execSync("git config --local core.hooksPath .githooks", { stdio: "ignore" });
  chmodSync(hookFile, 0o755);
  console.log("[hooks] Installed local git hooks (core.hooksPath=.githooks).");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[hooks] Unable to install git hooks: ${message}`);
}
