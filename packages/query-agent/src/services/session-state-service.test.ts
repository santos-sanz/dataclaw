import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { getProjectPaths } from "@dataclaw/shared";
import { SessionStateService } from "./session-state-service.js";

function withTempCwd(fn: (cwd: string) => void | Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "dataclaw-session-state-test-"));
  return Promise.resolve(fn(cwd)).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
}

test("setDefaultDatasetId persists valid session state", async () => {
  await withTempCwd((cwd) => {
    const service = new SessionStateService(cwd);
    service.setDefaultDatasetId("owner_dataset");

    const state = service.readState();
    assert.ok(state);
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.defaultDatasetId, "owner_dataset");
    assert.equal(typeof state.updatedAt, "string");
  });
});

test("resolveDefaultDatasetId clears persisted dataset when not available locally", async () => {
  await withTempCwd((cwd) => {
    const service = new SessionStateService(cwd);
    service.setDefaultDatasetId("owner_dataset");

    const resolved = service.resolveDefaultDatasetId(["other_dataset"]);
    assert.equal(resolved.datasetId, undefined);
    assert.equal(resolved.clearedInvalidDefault, true);

    const path = getProjectPaths(cwd).sessionStatePath;
    assert.equal(existsSync(path), false);
  });
});

test("resolveDefaultDatasetId keeps persisted dataset when available locally", async () => {
  await withTempCwd((cwd) => {
    const service = new SessionStateService(cwd);
    service.setDefaultDatasetId("owner_dataset");

    const resolved = service.resolveDefaultDatasetId(["owner_dataset", "other_dataset"]);
    assert.equal(resolved.datasetId, "owner_dataset");
    assert.equal(resolved.clearedInvalidDefault, false);
  });
});

test("readState returns null for invalid payloads", async () => {
  await withTempCwd((cwd) => {
    const path = getProjectPaths(cwd).sessionStatePath;
    mkdirSync(join(cwd, ".dataclaw"), { recursive: true });
    writeFileSync(path, '{"schemaVersion":1,"defaultDatasetId":42}', "utf-8");

    const service = new SessionStateService(cwd);
    assert.equal(service.readState(), null);
  });
});
