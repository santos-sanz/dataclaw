import type { AskResult, PlannerOutput, ToolExecutionAudit } from "@dataclaw/shared";
import { isMutatingPython, isMutatingSql } from "./security.js";

export interface ExecutorContext {
  datasetId: string;
  yolo: boolean;
  plan: PlannerOutput;
  sourceTables: string[];
  memoryHintsUsed: string[];
  approveCommand: (command: string, language: "sql" | "python") => Promise<boolean>;
  runSql: (command: string) => Promise<string>;
  runPython: (code: string) => Promise<string>;
  saveLearning: (input: {
    datasetId: string;
    symptom: string;
    rootCause: string;
    fix: string;
    command: string;
    language: "sql" | "python";
  }) => Promise<void>;
  appendAudit: (entry: ToolExecutionAudit) => Promise<void>;
}

export class Executor {
  async execute(context: ExecutorContext): Promise<AskResult> {
    const mutating = context.plan.language === "sql" ? isMutatingSql(context.plan.command) : isMutatingPython(context.plan.command);

    let approved = !mutating;
    if (mutating && !context.yolo) {
      approved = await context.approveCommand(context.plan.command, context.plan.language);
      if (!approved) {
        await context.appendAudit({
          timestamp: new Date().toISOString(),
          datasetId: context.datasetId,
          command: context.plan.command,
          language: context.plan.language,
          mutating,
          approved,
          yolo: false,
          success: false,
          error: "Command was rejected by user approval gate.",
        });

        return {
          plan: context.plan,
          command: context.plan.command,
          result: "Execution canceled: command was rejected by approval gate.",
          explanation: "A mutating command requires explicit approval.",
          sourceTables: context.sourceTables,
          learningsUsed: context.memoryHintsUsed,
          fallbackUsed: false,
        };
      }
    }

    if (mutating && context.yolo) {
      approved = true;
    }

    try {
      const result =
        context.plan.language === "sql"
          ? await context.runSql(context.plan.command)
          : await context.runPython(context.plan.command);

      await context.appendAudit({
        timestamp: new Date().toISOString(),
        datasetId: context.datasetId,
        command: context.plan.command,
        language: context.plan.language,
        mutating,
        approved,
        yolo: context.yolo,
        success: true,
      });

      return {
        plan: context.plan,
        command: context.plan.command,
        result,
        explanation: context.plan.explanationSeed,
        sourceTables: context.sourceTables,
        learningsUsed: context.memoryHintsUsed,
        fallbackUsed: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (context.plan.language === "sql") {
        try {
          const fallbackCode = generateFallbackPython(context.plan.command, message);
          const fallbackResult = await context.runPython(fallbackCode);
          await context.saveLearning({
            datasetId: context.datasetId,
            symptom: `SQL failed: ${message}`,
            rootCause: "Original SQL could not execute on current schema or engine constraints.",
            fix: "Used Python fallback to answer the query.",
            command: fallbackCode,
            language: "python",
          });

          await context.appendAudit({
            timestamp: new Date().toISOString(),
            datasetId: context.datasetId,
            command: context.plan.command,
            language: "sql",
            mutating,
            approved,
            yolo: context.yolo,
            success: true,
          });

          return {
            plan: context.plan,
            command: context.plan.command,
            result: fallbackResult,
            explanation: `${context.plan.explanationSeed} SQL failed, so Python fallback was used.`,
            sourceTables: context.sourceTables,
            learningsUsed: context.memoryHintsUsed,
            fallbackUsed: true,
          };
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          await context.appendAudit({
            timestamp: new Date().toISOString(),
            datasetId: context.datasetId,
            command: context.plan.command,
            language: "sql",
            mutating,
            approved,
            yolo: context.yolo,
            success: false,
            error: `SQL failed (${message}); fallback failed (${fallbackMessage})`,
          });
          throw new Error(`SQL failed: ${message}. Python fallback also failed: ${fallbackMessage}`);
        }
      }

      await context.appendAudit({
        timestamp: new Date().toISOString(),
        datasetId: context.datasetId,
        command: context.plan.command,
        language: context.plan.language,
        mutating,
        approved,
        yolo: context.yolo,
        success: false,
        error: message,
      });
      throw error;
    }
  }
}

function generateFallbackPython(sql: string, sqlError: string): string {
  return [
    "import duckdb",
    "con = duckdb.connect(database=DB_PATH, read_only=False)",
    `query = '''${sql.replace(/'''/g, "\\'\\'\\'")}'''`,
    "try:",
    "    result = con.execute(query).fetchdf()",
    "    print(result.head(50).to_string(index=False))",
    "except Exception as err:",
    `    raise RuntimeError('Original SQL failed: ${sqlError.replace(/'/g, "\\'")}') from err`,
  ].join("\n");
}
