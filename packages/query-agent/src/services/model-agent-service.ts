import { join, basename } from "node:path";
import { isMutatingSql } from "@dataclaw/agent-core";
import { OpenRouterClient, type OpenRouterMessage } from "@dataclaw/ai";
import {
  getDatasetRoot,
  type GeneratedModelArtifactFile,
  type GeneratedModelArtifacts,
  type ModelBuildPlan,
  type ModelBuildRequest,
  type ModelBuildResult,
  type ModelComponentBlueprint,
  type ModelJoinPlanEdge,
  type ModelPreviewItem,
  type ModelTableComponentSpec,
} from "@dataclaw/shared";
import { ensureDirectory, safeTableName, writeText } from "../utils/fs-utils.js";
import { ApprovalService } from "./approval-service.js";
import { DatasetService } from "./dataset-service.js";
import { DuckDbService, type DuckDbTableSchema } from "./duckdb-service.js";

interface LlmModelPlanPayload {
  sqlStatements?: unknown;
  joinPlan?: unknown;
  componentBlueprint?: unknown;
  naming?: unknown;
  assumptions?: unknown;
  warnings?: unknown;
}

interface ModelGenerationClient {
  isConfigured: () => boolean;
  chatJson: <T>(messages: OpenRouterMessage[]) => Promise<T>;
}

export interface ModelAgentServiceDependencies {
  client?: ModelGenerationClient;
  datasetService?: DatasetService;
  approvalService?: Pick<ApprovalService, "ask">;
}

export interface BuildModelInput {
  datasetId: string;
  selectedTables: string[];
  goal?: string;
  yolo: boolean;
}

export interface SchemaSnapshot {
  datasetId: string;
  selectedTables: string[];
  generatedRelations: string[];
  tables: DuckDbTableSchema[];
  generatedAt: string;
}

const MODEL_SYSTEM_PROMPT = `
You are DataClaw Model Agent.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "sqlStatements": ["..."],
  "joinPlan": [
    {
      "left": "string",
      "right": "string",
      "condition": "string",
      "confidence": 0.0,
      "reason": "string"
    }
  ],
  "componentBlueprint": {
    "rendererName": "SchemaRenderer",
    "rendererDescription": "string",
    "themeName": "editorial-data-cockpit",
    "styleDirection": "Editorial data cockpit",
    "tableComponents": [
      {
        "tableName": "string",
        "componentName": "TableSomething",
        "purpose": "string"
      }
    ]
  },
  "naming": {
    "modelView": "vw_dataset_model",
    "baseViews": {
      "source_table": "vw_source_table_base"
    }
  },
  "assumptions": ["..."],
  "warnings": ["..."]
}
Rules:
- DuckDB dialect only.
- Use CREATE OR REPLACE VIEW/TABLE ... AS SELECT ... for modeling statements.
- Never emit DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT/ATTACH/DETACH/COPY TO/PRAGMA.
- Keep sqlStatements executable in order.
- Prefer deterministic naming and stable schema-oriented components.
`;

const FORBIDDEN_SQL_PATTERN = /\b(drop|delete|truncate|alter|update|insert|attach|detach|pragma|vacuum|copy\s+to|call)\b/i;
const ALLOWED_SQL_START_PATTERN =
  /^\s*(create\s+(?:or\s+replace\s+)?(?:view|table)\s+[a-zA-Z_][a-zA-Z0-9_\.\"]*\s+as\s+|with\s+|select\s+)/i;

export class ModelAgentService {
  private readonly client: ModelGenerationClient;
  private readonly datasetService: DatasetService;
  private readonly approvalService: Pick<ApprovalService, "ask">;

  constructor(
    private readonly cwd: string,
    deps: ModelAgentServiceDependencies = {},
  ) {
    this.client = deps.client ?? new OpenRouterClient();
    this.datasetService = deps.datasetService ?? new DatasetService(cwd);
    this.approvalService = deps.approvalService ?? new ApprovalService();
  }

  async buildModel(input: BuildModelInput): Promise<ModelBuildResult> {
    const datasetId = this.datasetService.datasetIdFromAny(input.datasetId);
    const selectedTables = normalizeSelectedTables(input.selectedTables);
    if (!selectedTables.length) {
      throw new Error("Model build requires at least one table in --tables.");
    }

    const manifest = this.datasetService.getManifest(datasetId);
    const knownTables = new Set(manifest.tables.map((table) => table.name));
    const missing = selectedTables.filter((table) => !knownTables.has(table));
    if (missing.length) {
      throw new Error(`Selected tables are not present in dataset manifest: ${missing.join(", ")}`);
    }

    const dbPath = this.datasetService.getDatabasePath(datasetId);
    const duck = new DuckDbService(dbPath);
    const selectedSchemas = await duck.getTableSchemas(selectedTables);
    if (selectedSchemas.length !== selectedTables.length) {
      const loaded = new Set(selectedSchemas.map((schema) => schema.name));
      const unresolved = selectedTables.filter((table) => !loaded.has(table));
      throw new Error(`Unable to describe selected tables in DuckDB: ${unresolved.join(", ")}`);
    }

    const defaultModelViewName = `vw_${safeTableName(datasetId)}_model`;
    let plan: ModelBuildPlan;
    if (this.client.isConfigured()) {
      try {
        const payload = await this.client.chatJson<LlmModelPlanPayload>(
          createModelMessages({ datasetId, selectedTables, selectedSchemas, goal: input.goal, defaultModelViewName }),
        );
        plan = normalizeAndValidateModelPlan(payload, {
          datasetId,
          selectedTables,
          selectedSchemas,
          strategy: "llm",
        });
      } catch (error) {
        plan = buildFallbackModelPlan({
          datasetId,
          selectedTables,
          selectedSchemas,
          defaultModelViewName,
          warning: `LLM model generation failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      plan = buildFallbackModelPlan({
        datasetId,
        selectedTables,
        selectedSchemas,
        defaultModelViewName,
        warning: "OPENROUTER_API_KEY is not configured. Falling back to deterministic model generation.",
      });
    }

    const mutating = plan.sqlStatements.some((statement) => isMutatingSql(statement));
    if (mutating && !input.yolo) {
      const approved = await this.approvalService.ask(plan.sqlStatements.join("\n\n"), "sql");
      if (!approved) {
        throw new Error("Execution canceled: model SQL was rejected by approval gate.");
      }
    }

    await duck.executeStatements(plan.sqlStatements);

    const generatedRelationNames = extractCreatedRelationNames(plan.sqlStatements);
    const schemaSnapshot: SchemaSnapshot = {
      datasetId,
      selectedTables,
      generatedRelations: generatedRelationNames,
      tables: await duck.getTableSchemas(uniqueStrings([...selectedTables, ...generatedRelationNames])),
      generatedAt: new Date().toISOString(),
    };

    const request: ModelBuildRequest = {
      datasetId,
      selectedTables,
      goal: input.goal,
      yolo: input.yolo,
    };

    const runId = createRunId();
    const outputDir = join(getDatasetRoot(datasetId, this.cwd), "models", runId);
    ensureDirectory(outputDir);
    ensureDirectory(join(outputDir, "components"));

    const sqlText = `${plan.sqlStatements.map(ensureSemicolon).join("\n\n")}\n`;
    const planText = `${JSON.stringify(plan, null, 2)}\n`;
    const schemaText = `${JSON.stringify(schemaSnapshot, null, 2)}\n`;

    const componentFiles = renderComponentFiles({
      datasetId,
      runId,
      schemaSnapshot,
      blueprint: plan.componentBlueprint,
    });

    const files: GeneratedModelArtifactFile[] = [];
    const previewItems: ModelPreviewItem[] = [];

    const trackArtifact = (
      id: string,
      kind: GeneratedModelArtifactFile["kind"],
      path: string,
      description: string,
      content: string,
      previewKind: ModelPreviewItem["kind"] = "file",
    ): void => {
      writeText(path, content);
      files.push({ id, kind, path, description });
      previewItems.push({
        id,
        title: description,
        kind: previewKind,
        path,
        content,
      });
    };

    trackArtifact("sql:model", "sql", join(outputDir, "model.sql"), "Model SQL script", sqlText, "sql");
    trackArtifact("json:plan", "json", join(outputDir, "plan.json"), "Normalized model plan", planText, "file");
    trackArtifact("json:schema", "json", join(outputDir, "schema.snapshot.json"), "Schema snapshot", schemaText, "file");

    trackArtifact(
      "ts:types",
      "typescript",
      join(outputDir, "components", "types.ts"),
      "TypeScript contracts",
      componentFiles.typesTs,
      "component",
    );
    trackArtifact(
      "tsx:renderer",
      "tsx",
      join(outputDir, "components", "SchemaRenderer.tsx"),
      "Generic dynamic schema renderer",
      componentFiles.schemaRendererTsx,
      "component",
    );

    for (const item of componentFiles.tableComponents) {
      trackArtifact(
        `tsx:${item.componentName}`,
        "tsx",
        join(outputDir, "components", `${item.componentName}.tsx`),
        `${item.componentName} table component`,
        item.content,
        "component",
      );
    }

    trackArtifact(
      "css:styles",
      "css",
      join(outputDir, "components", "styles.css"),
      "Editorial data cockpit styles",
      componentFiles.stylesCss,
      "component",
    );
    trackArtifact(
      "ts:index",
      "typescript",
      join(outputDir, "components", "index.ts"),
      "Component barrel exports",
      componentFiles.indexTs,
      "component",
    );

    const overviewText = renderOverview({ request, plan, schemaSnapshot, outputDir });
    previewItems.unshift({
      id: "overview",
      title: "Build overview",
      kind: "overview",
      content: overviewText,
    });

    const artifacts: GeneratedModelArtifacts = {
      runId,
      outputDir,
      files,
    };

    const manifestText = `${JSON.stringify({ request, plan, artifacts }, null, 2)}\n`;
    trackArtifact(
      "json:manifest",
      "json",
      join(outputDir, "manifest.json"),
      "Generated artifacts manifest",
      manifestText,
      "file",
    );

    return {
      request,
      plan,
      artifacts,
      applied: true,
      previewItems,
    };
  }
}

interface LlmMessageContext {
  datasetId: string;
  selectedTables: string[];
  selectedSchemas: DuckDbTableSchema[];
  goal?: string;
  defaultModelViewName: string;
}

function createModelMessages(context: LlmMessageContext): OpenRouterMessage[] {
  const userPayload = {
    datasetId: context.datasetId,
    goal: context.goal ?? "Create reusable SQL model and dynamic TSX schema components.",
    selectedTables: context.selectedTables,
    selectedSchemas: context.selectedSchemas,
    namingDefaults: {
      modelView: context.defaultModelViewName,
      baseViews: Object.fromEntries(
        context.selectedTables.map((table) => [table, `vw_${safeTableName(table)}_base`]),
      ),
    },
  };

  return [
    { role: "system", content: MODEL_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(userPayload, null, 2) },
  ];
}

interface PlanNormalizationContext {
  datasetId: string;
  selectedTables: string[];
  selectedSchemas: DuckDbTableSchema[];
  strategy: "llm" | "fallback";
}

export function normalizeAndValidateModelPlan(
  raw: LlmModelPlanPayload,
  context: PlanNormalizationContext,
): ModelBuildPlan {
  const sqlStatementsRaw = Array.isArray(raw.sqlStatements)
    ? raw.sqlStatements.filter((value): value is string => typeof value === "string")
    : [];

  if (!sqlStatementsRaw.length) {
    throw new Error("Model plan did not return sqlStatements.");
  }

  const sqlStatements = sqlStatementsRaw.map(sanitizeSqlStatement);

  const namingInput = isObject(raw.naming) ? raw.naming : {};
  const baseViews = normalizeBaseViews((namingInput.baseViews as unknown) ?? {}, context.selectedTables);
  const modelView =
    typeof namingInput.modelView === "string" && namingInput.modelView.trim()
      ? safeTableName(namingInput.modelView)
      : `vw_${safeTableName(context.datasetId)}_model`;

  const joinPlan = normalizeJoinPlan(raw.joinPlan, context.strategy);
  const componentBlueprint = normalizeComponentBlueprint(
    raw.componentBlueprint,
    context.selectedTables,
    modelView,
  );
  const assumptions = normalizeStringArray(raw.assumptions);
  const warnings = normalizeStringArray(raw.warnings);

  validateSqlReferences(sqlStatements, context.selectedTables);

  return {
    strategy: context.strategy,
    sqlStatements,
    joinPlan,
    componentBlueprint,
    naming: {
      modelView,
      baseViews,
    },
    assumptions,
    warnings,
  };
}

interface FallbackPlanInput {
  datasetId: string;
  selectedTables: string[];
  selectedSchemas: DuckDbTableSchema[];
  defaultModelViewName: string;
  warning: string;
}

export function buildFallbackModelPlan(input: FallbackPlanInput): ModelBuildPlan {
  const baseViews = Object.fromEntries(
    input.selectedTables.map((table) => [table, `vw_${safeTableName(table)}_base`]),
  );

  const sqlStatements: string[] = input.selectedTables.map((table) =>
    `CREATE OR REPLACE VIEW ${baseViews[table]} AS SELECT * FROM ${table}`,
  );

  const modelView = safeTableName(input.defaultModelViewName);
  const joinPlan: ModelJoinPlanEdge[] = [];
  const warnings = [input.warning];

  if (input.selectedTables.length === 1) {
    sqlStatements.push(`CREATE OR REPLACE VIEW ${modelView} AS SELECT * FROM ${baseViews[input.selectedTables[0]]}`);
  } else {
    const schemaByName = new Map(input.selectedSchemas.map((schema) => [schema.name, schema]));
    const anchor = input.selectedTables[0];
    const anchorSchema = schemaByName.get(anchor);

    if (!anchorSchema) {
      throw new Error(`Unable to infer join plan: missing schema for '${anchor}'.`);
    }

    const joins: string[] = [];
    const includedTables = [anchor];

    for (let index = 1; index < input.selectedTables.length; index += 1) {
      const current = input.selectedTables[index];
      const currentSchema = schemaByName.get(current);
      if (!currentSchema) {
        joinPlan.push({
          left: anchor,
          right: current,
          condition: "",
          confidence: 0,
          source: "heuristic",
          skipped: true,
          reason: "Schema was not available in DuckDB.",
        });
        continue;
      }

      const inferred = inferJoinCondition(anchor, anchorSchema, current, currentSchema);
      if (!inferred) {
        joinPlan.push({
          left: anchor,
          right: current,
          condition: "",
          confidence: 0,
          source: "heuristic",
          skipped: true,
          reason: "No confident join key inferred.",
        });
        continue;
      }

      const rightAlias = `t${index}`;
      joins.push(
        `LEFT JOIN ${baseViews[current]} ${rightAlias} ON t0.${inferred.leftColumn} = ${rightAlias}.${inferred.rightColumn}`,
      );
      includedTables.push(current);
      joinPlan.push({
        left: anchor,
        right: current,
        condition: `t0.${inferred.leftColumn} = ${rightAlias}.${inferred.rightColumn}`,
        confidence: inferred.confidence,
        source: "heuristic",
        reason: inferred.reason,
      });
    }

    if (!joins.length) {
      sqlStatements.push(`CREATE OR REPLACE VIEW ${modelView} AS SELECT * FROM ${baseViews[anchor]}`);
      warnings.push("No safe join conditions were inferred; model view falls back to the first base view only.");
    } else {
      sqlStatements.push(
        [
          `CREATE OR REPLACE VIEW ${modelView} AS`,
          `SELECT *`,
          `FROM ${baseViews[anchor]} t0`,
          ...joins,
        ].join("\n"),
      );

      const skipped = input.selectedTables.filter((table) => !includedTables.includes(table));
      if (skipped.length) {
        warnings.push(`Some tables were skipped due to missing join keys: ${skipped.join(", ")}.`);
      }
    }
  }

  const componentBlueprint: ModelComponentBlueprint = {
    rendererName: "SchemaRenderer",
    rendererDescription: "Dynamic renderer for modeled DuckDB relations.",
    themeName: "editorial-data-cockpit",
    styleDirection: "Editorial data cockpit",
    tableComponents: uniqueStrings([...input.selectedTables, modelView]).map((tableName) => ({
      tableName,
      componentName: toComponentName(tableName),
      purpose: `Render modeled rows for ${tableName}.`,
    })),
  };

  return {
    strategy: "fallback",
    sqlStatements: sqlStatements.map(sanitizeSqlStatement),
    joinPlan,
    componentBlueprint,
    naming: {
      modelView,
      baseViews,
    },
    assumptions: [
      "Fallback join heuristics prioritize *_id keys and shared identifier columns.",
      "Generated components are framework-agnostic React TSX with local CSS styling.",
    ],
    warnings,
  };
}

interface InferredJoin {
  leftColumn: string;
  rightColumn: string;
  confidence: number;
  reason: string;
}

function inferJoinCondition(
  leftTable: string,
  leftSchema: DuckDbTableSchema,
  rightTable: string,
  rightSchema: DuckDbTableSchema,
): InferredJoin | null {
  const leftColumns = toColumnLookup(leftSchema.columns);
  const rightColumns = toColumnLookup(rightSchema.columns);

  const leftEntityId = `${singularize(safeTableName(leftTable))}_id`;
  const rightEntityId = `${singularize(safeTableName(rightTable))}_id`;

  if (leftColumns.has("id") && rightColumns.has(leftEntityId)) {
    return {
      leftColumn: leftColumns.get("id")!,
      rightColumn: rightColumns.get(leftEntityId)!,
      confidence: 0.95,
      reason: `Matched ${rightTable}.${leftEntityId} to ${leftTable}.id`,
    };
  }

  if (leftColumns.has(rightEntityId) && rightColumns.has("id")) {
    return {
      leftColumn: leftColumns.get(rightEntityId)!,
      rightColumn: rightColumns.get("id")!,
      confidence: 0.95,
      reason: `Matched ${leftTable}.${rightEntityId} to ${rightTable}.id`,
    };
  }

  const sharedIds = [...leftColumns.keys()].filter((name) => name.endsWith("_id") && rightColumns.has(name)).sort();
  if (sharedIds.length) {
    const key = sharedIds[0];
    return {
      leftColumn: leftColumns.get(key)!,
      rightColumn: rightColumns.get(key)!,
      confidence: 0.8,
      reason: `Matched shared identifier column '${key}'.`,
    };
  }

  const sharedColumns = [...leftColumns.keys()].filter((name) => rightColumns.has(name)).sort();
  if (sharedColumns.includes("id")) {
    return {
      leftColumn: leftColumns.get("id")!,
      rightColumn: rightColumns.get("id")!,
      confidence: 0.7,
      reason: "Matched generic 'id' columns on both tables.",
    };
  }

  return null;
}

function normalizeJoinPlan(input: unknown, strategy: "llm" | "fallback"): ModelJoinPlanEdge[] {
  if (!Array.isArray(input)) return [];
  const source: "llm" | "heuristic" = strategy === "llm" ? "llm" : "heuristic";
  const output: ModelJoinPlanEdge[] = [];

  for (const item of input) {
    if (!isObject(item)) continue;
    const left = typeof item.left === "string" ? item.left.trim() : "";
    const right = typeof item.right === "string" ? item.right.trim() : "";
    const condition = typeof item.condition === "string" ? item.condition.trim() : "";
    if (!left || !right || !condition) continue;

    const confidenceRaw = Number(item.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? clamp(confidenceRaw, 0, 1) : 0.5;
    const reason = typeof item.reason === "string" ? item.reason : undefined;
    const edge: ModelJoinPlanEdge = {
      left,
      right,
      condition,
      confidence,
      source,
    };
    if (reason) {
      edge.reason = reason;
    }
    output.push(edge);
  }

  return output;
}

function normalizeComponentBlueprint(
  input: unknown,
  selectedTables: string[],
  modelView: string,
): ModelComponentBlueprint {
  const objectInput = isObject(input) ? input : {};
  const rendererName =
    typeof objectInput.rendererName === "string" && objectInput.rendererName.trim()
      ? objectInput.rendererName.trim()
      : "SchemaRenderer";
  const rendererDescription =
    typeof objectInput.rendererDescription === "string" && objectInput.rendererDescription.trim()
      ? objectInput.rendererDescription.trim()
      : "Dynamic renderer for modeled dataset relations.";
  const themeName =
    typeof objectInput.themeName === "string" && objectInput.themeName.trim()
      ? objectInput.themeName.trim()
      : "editorial-data-cockpit";
  const styleDirection =
    typeof objectInput.styleDirection === "string" && objectInput.styleDirection.trim()
      ? objectInput.styleDirection.trim()
      : "Editorial data cockpit";

  const defaultTables = uniqueStrings([...selectedTables, modelView]);
  const tableComponentsRaw = Array.isArray(objectInput.tableComponents) ? objectInput.tableComponents : [];
  const parsed: ModelTableComponentSpec[] = tableComponentsRaw
    .map((item) => {
      if (!isObject(item)) return null;
      const tableName = typeof item.tableName === "string" ? item.tableName.trim() : "";
      if (!tableName) return null;
      const componentName =
        typeof item.componentName === "string" && item.componentName.trim()
          ? normalizeComponentName(item.componentName)
          : toComponentName(tableName);
      const purpose =
        typeof item.purpose === "string" && item.purpose.trim()
          ? item.purpose.trim()
          : `Render modeled rows for ${tableName}.`;
      return {
        tableName,
        componentName,
        purpose,
      };
    })
    .filter((item): item is ModelTableComponentSpec => item !== null);

  const existingTables = new Set(parsed.map((item) => item.tableName));
  for (const tableName of defaultTables) {
    if (existingTables.has(tableName)) continue;
    parsed.push({
      tableName,
      componentName: toComponentName(tableName),
      purpose: `Render modeled rows for ${tableName}.`,
    });
  }

  return {
    rendererName: normalizeComponentName(rendererName),
    rendererDescription,
    themeName,
    styleDirection,
    tableComponents: parsed,
  };
}

function normalizeBaseViews(input: unknown, selectedTables: string[]): Record<string, string> {
  const fromInput = isObject(input) ? input : {};
  const output: Record<string, string> = {};

  for (const table of selectedTables) {
    const candidate = fromInput[table];
    if (typeof candidate === "string" && candidate.trim()) {
      output[table] = safeTableName(candidate);
    } else {
      output[table] = `vw_${safeTableName(table)}_base`;
    }
  }

  return output;
}

function validateSqlReferences(statements: string[], selectedTables: string[]): void {
  const known = new Set(selectedTables.map((name) => name.toLowerCase()));

  for (const statement of statements) {
    const created = extractCreatedRelationName(statement);
    const ctes = new Set(extractCteNames(statement).map((name) => name.toLowerCase()));
    const refs = extractRelationReferences(statement);

    const unknown = refs.filter((ref) => !known.has(ref.toLowerCase()) && !ctes.has(ref.toLowerCase()));
    if (unknown.length) {
      throw new Error(`Model SQL references unknown relation(s): ${uniqueStrings(unknown).join(", ")}`);
    }

    if (created) {
      known.add(created.toLowerCase());
    }
  }
}

function extractRelationReferences(statement: string): string[] {
  const refs: string[] = [];
  const regex = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statement)) !== null) {
    const token = match[1];
    if (!token) continue;
    refs.push(lastSegment(token));
  }

  return refs;
}

function extractCteNames(statement: string): string[] {
  const refs: string[] = [];
  const regex = /(?:\bwith\b|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statement)) !== null) {
    const token = match[1];
    if (!token) continue;
    refs.push(token);
  }

  return refs;
}

function extractCreatedRelationName(statement: string): string | undefined {
  const match = statement.match(/^\s*create\s+(?:or\s+replace\s+)?(?:view|table)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s+as\s+/i);
  if (!match?.[1]) return undefined;
  return lastSegment(match[1]);
}

function extractCreatedRelationNames(statements: string[]): string[] {
  return uniqueStrings(
    statements
      .map((statement) => extractCreatedRelationName(statement))
      .filter((name): name is string => Boolean(name)),
  );
}

function sanitizeSqlStatement(statement: string): string {
  const normalized = statement.trim();
  if (!normalized) {
    throw new Error("Model plan contains an empty SQL statement.");
  }

  if (FORBIDDEN_SQL_PATTERN.test(normalized)) {
    throw new Error(`Forbidden SQL detected in model plan: ${normalized}`);
  }

  if (!ALLOWED_SQL_START_PATTERN.test(normalized)) {
    throw new Error(`Unsupported SQL statement for model build: ${normalized}`);
  }

  const withoutTrailing = normalized.endsWith(";") ? normalized.slice(0, -1).trim() : normalized;
  if (withoutTrailing.includes(";")) {
    throw new Error("Each sqlStatements item must contain exactly one SQL statement.");
  }

  return withoutTrailing;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

interface ComponentFileBuildInput {
  datasetId: string;
  runId: string;
  schemaSnapshot: SchemaSnapshot;
  blueprint: ModelComponentBlueprint;
}

interface RenderedComponentFiles {
  typesTs: string;
  schemaRendererTsx: string;
  tableComponents: Array<{ componentName: string; content: string }>;
  stylesCss: string;
  indexTs: string;
}

function renderComponentFiles(input: ComponentFileBuildInput): RenderedComponentFiles {
  const schemaJson = JSON.stringify(
    {
      datasetId: input.datasetId,
      runId: input.runId,
      tables: input.schemaSnapshot.tables,
    },
    null,
    2,
  );

  const typesTs = [
    "export type Scalar = string | number | boolean | null;",
    "",
    "export type DataRow = Record<string, Scalar>;",
    "",
    "export interface ColumnSchema {",
    "  name: string;",
    "  type: string;",
    "}",
    "",
    "export interface TableSchema {",
    "  name: string;",
    "  columns: ColumnSchema[];",
    "}",
    "",
    "export interface SchemaModel {",
    "  datasetId: string;",
    "  runId: string;",
    "  tables: TableSchema[];",
    "}",
    "",
    "export interface TableRenderProps {",
    "  schema: TableSchema;",
    "  rows: DataRow[];",
    "  title?: string;",
    "  subtitle?: string;",
    "}",
    "",
    `export const defaultSchemaModel: SchemaModel = ${schemaJson};`,
    "",
  ].join("\n");

  const schemaRendererTsx = [
    "import React from \"react\";",
    "import type { DataRow, SchemaModel } from \"./types\";",
    "",
    "export interface SchemaRendererProps {",
    "  model: SchemaModel;",
    "  rowsByTable: Record<string, DataRow[]>;",
    "  className?: string;",
    "}",
    "",
    "export function SchemaRenderer({ model, rowsByTable, className }: SchemaRendererProps): JSX.Element {",
    "  return (",
    "    <section className={[\"dc-shell\", className].filter(Boolean).join(\" \")}>",
    "      <header className=\"dc-hero\">",
    "        <p className=\"dc-kicker\">{model.datasetId}</p>",
    "        <h1>Schema cockpit</h1>",
    "        <p>Dynamic model explorer for generated DuckDB relations.</p>",
    "      </header>",
    "      <div className=\"dc-grid\">",
    "        {model.tables.map((table) => {",
    "          const rows = rowsByTable[table.name] ?? [];",
    "          return (",
    "            <article key={table.name} className=\"dc-card\">",
    "              <div className=\"dc-card-head\">",
    "                <h2>{table.name}</h2>",
    "                <span>{rows.length} rows preview</span>",
    "              </div>",
    "              <ul className=\"dc-columns\">",
    "                {table.columns.map((column) => (",
    "                  <li key={`${table.name}-${column.name}`}>",
    "                    <strong>{column.name}</strong>",
    "                    <em>{column.type}</em>",
    "                  </li>",
    "                ))}",
    "              </ul>",
    "            </article>",
    "          );",
    "        })}",
    "      </div>",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n");

  const schemaByTable = new Map(input.schemaSnapshot.tables.map((table) => [table.name, table]));
  const componentSpecs = dedupeComponentSpecs(input.blueprint.tableComponents);

  const tableComponents = componentSpecs.map((spec) => {
    const table = schemaByTable.get(spec.tableName);
    const columns = table?.columns ?? [];
    const columnsLiteral = JSON.stringify(columns, null, 2);

    const content = [
      "import React from \"react\";",
      "import type { TableRenderProps } from \"./types\";",
      "",
      `const defaultColumns = ${columnsLiteral};`,
      "",
      `export function ${spec.componentName}({ schema, rows, title, subtitle }: TableRenderProps): JSX.Element {`,
      "  const effectiveSchema = schema?.columns?.length ? schema : { ...schema, columns: defaultColumns };",
      "  return (",
      "    <article className=\"dc-card dc-table-component\">",
      "      <header className=\"dc-card-head\">",
      `        <h2>{title ?? \"${spec.tableName}\"}</h2>`,
      "        <span>{rows.length} rows preview</span>",
      "      </header>",
      "      {subtitle ? <p className=\"dc-subtitle\">{subtitle}</p> : null}",
      "      <ul className=\"dc-columns\">",
      "        {effectiveSchema.columns.map((column) => (",
      "          <li key={`${effectiveSchema.name}-${column.name}`}>",
      "            <strong>{column.name}</strong>",
      "            <em>{column.type}</em>",
      "          </li>",
      "        ))}",
      "      </ul>",
      "    </article>",
      "  );",
      "}",
      "",
    ].join("\n");

    return {
      componentName: spec.componentName,
      content,
    };
  });

  const stylesCss = [
    ":root {",
    "  --dc-ink: #1f2533;",
    "  --dc-paper: #f6f2e8;",
    "  --dc-panel: #fffdf8;",
    "  --dc-accent: #d24d2f;",
    "  --dc-accent-2: #0f6d7a;",
    "  --dc-border: #d5c8ad;",
    "  --dc-shadow: 0 14px 40px rgba(22, 23, 27, 0.1);",
    "}",
    "",
    ".dc-shell {",
    "  color: var(--dc-ink);",
    "  background:",
    "    radial-gradient(circle at 12% 18%, rgba(210, 77, 47, 0.14), transparent 40%),",
    "    radial-gradient(circle at 82% 16%, rgba(15, 109, 122, 0.14), transparent 36%),",
    "    var(--dc-paper);",
    "  border: 1px solid var(--dc-border);",
    "  border-radius: 18px;",
    "  padding: 1.25rem;",
    "  font-family: \"Avenir Next\", \"Segoe UI\", sans-serif;",
    "}",
    "",
    ".dc-hero h1 {",
    "  margin: 0;",
    "  font-size: clamp(1.8rem, 3vw, 2.4rem);",
    "  letter-spacing: 0.04em;",
    "  text-transform: uppercase;",
    "}",
    "",
    ".dc-kicker {",
    "  margin: 0 0 0.4rem;",
    "  color: var(--dc-accent-2);",
    "  text-transform: uppercase;",
    "  letter-spacing: 0.14em;",
    "  font-size: 0.78rem;",
    "  font-weight: 700;",
    "}",
    "",
    ".dc-grid {",
    "  display: grid;",
    "  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));",
    "  gap: 1rem;",
    "  margin-top: 1rem;",
    "}",
    "",
    ".dc-card {",
    "  background: var(--dc-panel);",
    "  border: 1px solid var(--dc-border);",
    "  border-radius: 14px;",
    "  box-shadow: var(--dc-shadow);",
    "  padding: 0.95rem;",
    "}",
    "",
    ".dc-card-head {",
    "  display: flex;",
    "  align-items: baseline;",
    "  justify-content: space-between;",
    "  gap: 0.75rem;",
    "  margin-bottom: 0.75rem;",
    "}",
    "",
    ".dc-card-head h2 {",
    "  margin: 0;",
    "  font-size: 1rem;",
    "}",
    "",
    ".dc-card-head span {",
    "  font-size: 0.75rem;",
    "  color: #5d5a53;",
    "}",
    "",
    ".dc-columns {",
    "  list-style: none;",
    "  margin: 0;",
    "  padding: 0;",
    "  display: grid;",
    "  gap: 0.45rem;",
    "}",
    "",
    ".dc-columns li {",
    "  display: flex;",
    "  justify-content: space-between;",
    "  gap: 0.8rem;",
    "  border-bottom: 1px dashed #ddd0b7;",
    "  padding-bottom: 0.3rem;",
    "}",
    "",
    ".dc-columns strong {",
    "  font-size: 0.85rem;",
    "}",
    "",
    ".dc-columns em {",
    "  font-size: 0.75rem;",
    "  color: #6f6860;",
    "}",
    "",
    ".dc-subtitle {",
    "  margin-top: -0.2rem;",
    "  margin-bottom: 0.6rem;",
    "  color: #635f57;",
    "  font-size: 0.85rem;",
    "}",
    "",
    "@media (max-width: 700px) {",
    "  .dc-shell {",
    "    padding: 0.9rem;",
    "  }",
    "}",
    "",
  ].join("\n");

  const indexExports = [
    "export * from \"./types\";",
    "export * from \"./SchemaRenderer\";",
    ...tableComponents.map((item) => `export * from \"./${item.componentName}\";`),
    "",
  ];

  return {
    typesTs,
    schemaRendererTsx,
    tableComponents,
    stylesCss,
    indexTs: indexExports.join("\n"),
  };
}

interface OverviewInput {
  request: ModelBuildRequest;
  plan: ModelBuildPlan;
  schemaSnapshot: SchemaSnapshot;
  outputDir: string;
}

function renderOverview(input: OverviewInput): string {
  const lines = [
    "Model build summary",
    "-------------------",
    `Dataset: ${input.request.datasetId}`,
    `Selected tables: ${input.request.selectedTables.join(", ")}`,
    `Goal: ${input.request.goal ?? "(default)"}`,
    `Strategy: ${input.plan.strategy}`,
    `SQL statements: ${input.plan.sqlStatements.length}`,
    `Generated relations: ${input.schemaSnapshot.generatedRelations.join(", ") || "(none)"}`,
    `Artifacts output: ${input.outputDir}`,
  ];

  if (input.plan.warnings.length) {
    lines.push("", "Warnings:", ...input.plan.warnings.map((item) => `- ${item}`));
  }

  if (input.plan.assumptions.length) {
    lines.push("", "Assumptions:", ...input.plan.assumptions.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

function normalizeSelectedTables(input: string[]): string[] {
  return uniqueStrings(
    input
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureSemicolon(statement: string): string {
  const trimmed = statement.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, self) => self.indexOf(value) === index);
}

function normalizeComponentName(input: string): string {
  const lettersOnly = input.replace(/[^a-zA-Z0-9]/g, " ");
  const pascal = lettersOnly
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join("");
  if (!pascal) return "TableComponent";
  return /^[A-Z]/.test(pascal) ? pascal : `C${pascal}`;
}

function toComponentName(tableName: string): string {
  return normalizeComponentName(`table ${tableName}`);
}

function dedupeComponentSpecs(specs: ModelTableComponentSpec[]): ModelTableComponentSpec[] {
  const byTable = new Map<string, ModelTableComponentSpec>();
  for (const spec of specs) {
    if (!byTable.has(spec.tableName)) {
      byTable.set(spec.tableName, {
        ...spec,
        componentName: normalizeComponentName(spec.componentName),
      });
    }
  }
  return [...byTable.values()];
}

function singularize(input: string): string {
  if (input.endsWith("ies")) return `${input.slice(0, -3)}y`;
  if (input.endsWith("s") && input.length > 1) return input.slice(0, -1);
  return input;
}

function toColumnLookup(columns: Array<{ name: string; type: string }>): Map<string, string> {
  return new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function lastSegment(name: string): string {
  const clean = name.trim();
  const pieces = clean.split(".").filter(Boolean);
  return pieces[pieces.length - 1] ?? clean;
}

export function parseTablesFlag(value: string): string[] {
  return normalizeSelectedTables(value.split(","));
}

export function summarizeArtifacts(files: GeneratedModelArtifactFile[]): string {
  return files
    .map((file) => `${file.id}\t${file.kind}\t${basename(file.path)}\t${file.description}`)
    .join("\n");
}
