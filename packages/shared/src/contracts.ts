export type ExecutionLanguage = "sql" | "python";

export interface PlannerOutput {
  intent: string;
  language: ExecutionLanguage;
  command: string;
  requiresApproval: boolean;
  expectedShape: "table" | "scalar" | "text";
  explanationSeed: string;
}

export interface AskResult {
  plan: PlannerOutput;
  command: string;
  result: string;
  explanation: string;
  sourceTables: string[];
  learningsUsed: string[];
  fallbackUsed: boolean;
}

export interface DatasetManifest {
  id: string;
  source: string;
  createdAt: string;
  files: DatasetFile[];
  tables: DatasetTable[];
}

export interface DatasetFile {
  path: string;
  type: "csv" | "parquet" | "sqlite" | "json" | "other";
  sizeBytes: number;
}

export interface DatasetTable {
  name: string;
  originPath: string;
  columns: Array<{ name: string; type: string }>;
}

export interface MemoryEntry {
  title: string;
  datasetId: string;
  symptom: string;
  rootCause: string;
  fix: string;
  confidence: number;
  sqlOrPythonSnippet: string;
  tags: string[];
  createdAt: string;
}

export interface ToolExecutionAudit {
  timestamp: string;
  datasetId: string;
  command: string;
  language: ExecutionLanguage;
  mutating: boolean;
  approved: boolean;
  yolo: boolean;
  success: boolean;
  error?: string;
}
