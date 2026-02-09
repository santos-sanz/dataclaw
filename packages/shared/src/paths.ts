import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ProjectPaths {
  projectRoot: string;
  stateRoot: string;
  datasetsRoot: string;
  globalMemoryRoot: string;
  globalCuratedMemoryPath: string;
  auditLogPath: string;
}

export function getProjectPaths(cwd: string = process.cwd()): ProjectPaths {
  const projectRoot = resolve(cwd);
  const stateRoot = join(projectRoot, ".dataclaw");
  const datasetsRoot = join(stateRoot, "datasets");
  const globalMemoryRoot = join(stateRoot, "memory", "global");
  const globalCuratedMemoryPath = join(projectRoot, "MEMORY.md");
  const auditLogPath = join(stateRoot, "logs", "audit.jsonl");

  return {
    projectRoot,
    stateRoot,
    datasetsRoot,
    globalMemoryRoot,
    globalCuratedMemoryPath,
    auditLogPath,
  };
}

export function ensureProjectDirectories(cwd: string = process.cwd()): ProjectPaths {
  const p = getProjectPaths(cwd);
  mkdirSync(p.stateRoot, { recursive: true });
  mkdirSync(p.datasetsRoot, { recursive: true });
  mkdirSync(p.globalMemoryRoot, { recursive: true });
  mkdirSync(join(p.stateRoot, "logs"), { recursive: true });
  return p;
}

export function getDatasetRoot(datasetId: string, cwd: string = process.cwd()): string {
  return join(getProjectPaths(cwd).datasetsRoot, datasetId);
}

export function getKaggleCredentialPath(): string {
  return process.env.KAGGLE_CONFIG_DIR
    ? join(process.env.KAGGLE_CONFIG_DIR, "kaggle.json")
    : join(homedir(), ".kaggle", "kaggle.json");
}
