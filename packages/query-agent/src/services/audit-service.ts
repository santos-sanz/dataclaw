import { appendFileSync } from "node:fs";
import { ensureProjectDirectories, getProjectPaths, type ToolExecutionAudit } from "@dataclaw/shared";

export class AuditService {
  constructor(private readonly cwd: string) {
    ensureProjectDirectories(cwd);
  }

  async append(entry: ToolExecutionAudit): Promise<void> {
    const path = getProjectPaths(this.cwd).auditLogPath;
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
  }
}
