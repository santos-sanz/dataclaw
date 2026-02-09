import { Executor, Planner } from "@dataclaw/agent-core";
import { OpenRouterClient } from "@dataclaw/ai";
import type { AskResult } from "@dataclaw/shared";
import { AuditService } from "./audit-service.js";
import { ApprovalService } from "./approval-service.js";
import { DatasetService, inferMainTable, inferSourceTables } from "./dataset-service.js";
import { DuckDbService } from "./duckdb-service.js";
import { MarkdownMemoryService } from "./memory-service.js";
import { runPythonCode } from "./python-runner.js";

export class AskService {
  private readonly planner: Planner;
  private readonly executor: Executor;
  private readonly datasetService: DatasetService;
  private readonly memoryService: MarkdownMemoryService;
  private readonly approvalService: ApprovalService;
  private readonly auditService: AuditService;

  constructor(private readonly cwd: string) {
    const client = new OpenRouterClient();
    this.planner = new Planner(client);
    this.executor = new Executor();
    this.datasetService = new DatasetService(cwd);
    this.memoryService = new MarkdownMemoryService(cwd);
    this.approvalService = new ApprovalService();
    this.auditService = new AuditService(cwd);
  }

  async ask(datasetInput: string, prompt: string, yolo: boolean): Promise<AskResult> {
    const datasetId = this.datasetService.datasetIdFromAny(datasetInput);
    const manifest = this.datasetService.getManifest(datasetId);
    const dbPath = this.datasetService.getDatabasePath(datasetId);
    const duck = new DuckDbService(dbPath);

    const memoryHints = this.memoryService
      .search(prompt, datasetId)
      .slice(0, 6)
      .map((item) => item.snippet);

    const plan = await this.planner.createPlan({
      datasetId,
      prompt: rewritePromptWithMainTable(prompt, inferMainTable(manifest)),
      manifest,
      memoryHints,
    });

    const result = await this.executor.execute({
      datasetId,
      yolo,
      plan,
      sourceTables: inferSourceTables(manifest),
      memoryHintsUsed: memoryHints,
      approveCommand: (command, language) => this.approvalService.ask(command, language),
      runSql: (sql) => duck.query(sql),
      runPython: (code) => runPythonCode(code, dbPath),
      saveLearning: (learning) =>
        this.memoryService.saveLearning({
          datasetId,
          symptom: learning.symptom,
          rootCause: learning.rootCause,
          fix: learning.fix,
          command: learning.command,
          language: learning.language,
        }),
      appendAudit: (entry) => this.auditService.append(entry),
    });

    return result;
  }
}

function rewritePromptWithMainTable(prompt: string, mainTable: string): string {
  if (prompt.toLowerCase().includes("main_table")) {
    return prompt.replace(/main_table/g, mainTable);
  }
  return `${prompt}\n\nUse '${mainTable}' as the primary table when no table is specified.`;
}
