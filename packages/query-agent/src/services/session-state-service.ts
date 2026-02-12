import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getProjectPaths } from "@dataclaw/shared";

export interface SessionState {
  schemaVersion: 1;
  defaultDatasetId: string;
  updatedAt: string;
}

export interface ResolvedDefaultDataset {
  datasetId?: string;
  clearedInvalidDefault: boolean;
}

export class SessionStateService {
  constructor(private readonly cwd: string) {}

  readState(): SessionState | null {
    const path = getProjectPaths(this.cwd).sessionStatePath;
    if (!existsSync(path)) return null;

    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return null;

      const value = parsed as Record<string, unknown>;
      if (value.schemaVersion !== 1) return null;
      if (typeof value.defaultDatasetId !== "string" || value.defaultDatasetId.trim() === "") return null;
      if (typeof value.updatedAt !== "string" || value.updatedAt.trim() === "") return null;

      return {
        schemaVersion: 1,
        defaultDatasetId: value.defaultDatasetId.trim(),
        updatedAt: value.updatedAt.trim(),
      };
    } catch {
      return null;
    }
  }

  resolveDefaultDatasetId(localDatasetIds: string[]): ResolvedDefaultDataset {
    const state = this.readState();
    if (!state) {
      return { datasetId: undefined, clearedInvalidDefault: false };
    }

    if (localDatasetIds.includes(state.defaultDatasetId)) {
      return { datasetId: state.defaultDatasetId, clearedInvalidDefault: false };
    }

    this.clearDefaultDatasetId();
    return { datasetId: undefined, clearedInvalidDefault: true };
  }

  setDefaultDatasetId(datasetId: string): void {
    const normalized = datasetId.trim();
    if (!normalized) {
      throw new Error("defaultDatasetId cannot be empty.");
    }

    const path = getProjectPaths(this.cwd).sessionStatePath;
    mkdirSync(dirname(path), { recursive: true });
    const payload: SessionState = {
      schemaVersion: 1,
      defaultDatasetId: normalized,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(path, payload);
  }

  clearDefaultDatasetId(): void {
    const path = getProjectPaths(this.cwd).sessionStatePath;
    if (!existsSync(path)) return;
    rmSync(path, { force: true });
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, path);
}
