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

export interface ModelBuildRequest {
  datasetId: string;
  selectedTables: string[];
  goal?: string;
  yolo: boolean;
}

export interface ModelJoinPlanEdge {
  left: string;
  right: string;
  condition: string;
  confidence: number;
  source: "llm" | "heuristic";
  skipped?: boolean;
  reason?: string;
}

export interface ModelTableComponentSpec {
  tableName: string;
  componentName: string;
  purpose: string;
}

export interface ModelComponentBlueprint {
  rendererName: string;
  rendererDescription: string;
  tableComponents: ModelTableComponentSpec[];
  themeName: string;
  styleDirection: string;
}

export interface ModelBuildPlan {
  strategy: "llm" | "fallback";
  sqlStatements: string[];
  joinPlan: ModelJoinPlanEdge[];
  componentBlueprint: ModelComponentBlueprint;
  naming: {
    modelView: string;
    baseViews: Record<string, string>;
  };
  assumptions: string[];
  warnings: string[];
}

export interface GeneratedModelArtifactFile {
  id: string;
  kind: "sql" | "json" | "typescript" | "tsx" | "css";
  path: string;
  description: string;
}

export interface GeneratedModelArtifacts {
  runId: string;
  outputDir: string;
  files: GeneratedModelArtifactFile[];
}

export interface ModelPreviewItem {
  id: string;
  title: string;
  kind: "overview" | "sql" | "component" | "file";
  path?: string;
  content: string;
}

export interface ModelBuildResult {
  request: ModelBuildRequest;
  plan: ModelBuildPlan;
  artifacts: GeneratedModelArtifacts;
  applied: boolean;
  previewItems: ModelPreviewItem[];
}
