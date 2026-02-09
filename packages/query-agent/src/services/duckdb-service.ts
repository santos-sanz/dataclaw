import { basename, relative } from "node:path";
import duckdb from "duckdb";
import type { DatasetManifest, DatasetTable } from "@dataclaw/shared";
import { detectFileType, fileSize, listFilesRecursively, safeTableName } from "../utils/fs-utils.js";

export class DuckDbService {
  constructor(private readonly databasePath: string) {}

  private connect(): duckdb.Database {
    return new duckdb.Database(this.databasePath);
  }

  async query(sql: string): Promise<string> {
    const db = this.connect();
    return new Promise((resolve, reject) => {
      db.all(sql, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }

        if (!rows || rows.length === 0) {
          resolve("(no rows)");
          return;
        }

        const keys = Object.keys(rows[0]);
        const lines = [keys.join("\t")];
        for (const row of rows.slice(0, 50)) {
          lines.push(keys.map((key) => stringifyCell((row as Record<string, unknown>)[key])).join("\t"));
        }
        resolve(lines.join("\n"));
      });
    });
  }

  async ingestDataset(datasetId: string, source: string, rawDir: string): Promise<DatasetManifest> {
    const files = listFilesRecursively(rawDir);
    const db = this.connect();
    const tables: DatasetTable[] = [];

    for (const file of files) {
      const detectedType = detectFileType(file);
      if (detectedType === "other") continue;

      const rel = relative(rawDir, file);
      const tableBase = safeTableName(`${basename(file)}_${tables.length}`);

      if (detectedType === "csv") {
        await this.exec(db, `CREATE OR REPLACE TABLE ${tableBase} AS SELECT * FROM read_csv_auto('${escapeSql(file)}', SAMPLE_SIZE=-1);`);
        tables.push(await this.describeTable(db, tableBase, rel));
      }

      if (detectedType === "parquet") {
        await this.exec(db, `CREATE OR REPLACE TABLE ${tableBase} AS SELECT * FROM read_parquet('${escapeSql(file)}');`);
        tables.push(await this.describeTable(db, tableBase, rel));
      }

      if (detectedType === "json") {
        await this.exec(db, `CREATE OR REPLACE TABLE ${tableBase} AS SELECT * FROM read_json_auto('${escapeSql(file)}');`);
        tables.push(await this.describeTable(db, tableBase, rel));
      }

      if (detectedType === "sqlite") {
        await this.exec(db, "INSTALL sqlite;");
        await this.exec(db, "LOAD sqlite;");
        const sqliteTables = await this.all<{ name: string }>(
          db,
          `SELECT name FROM sqlite_scan('${escapeSql(file)}', 'sqlite_master') WHERE type='table';`,
        );
        for (const sqliteTable of sqliteTables) {
          const mergedName = safeTableName(`${tableBase}_${sqliteTable.name}`);
          await this.exec(
            db,
            `CREATE OR REPLACE TABLE ${mergedName} AS SELECT * FROM sqlite_scan('${escapeSql(file)}', '${escapeSql(sqliteTable.name)}');`,
          );
          tables.push(await this.describeTable(db, mergedName, rel));
        }
      }
    }

    return {
      id: datasetId,
      source,
      createdAt: new Date().toISOString(),
      files: files.map((path) => ({
        path: relative(rawDir, path),
        type: detectFileType(path),
        sizeBytes: fileSize(path),
      })),
      tables,
    };
  }

  async tableNames(): Promise<string[]> {
    const db = this.connect();
    const rows = await this.all<{ table_name: string }>(db, "SELECT table_name FROM information_schema.tables WHERE table_schema='main';");
    return rows.map((row) => row.table_name);
  }

  private async describeTable(db: duckdb.Database, tableName: string, originPath: string): Promise<DatasetTable> {
    const columns = await this.all<{ column_name: string; data_type: string }>(
      db,
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${escapeSql(tableName)}' ORDER BY ordinal_position;`,
    );

    return {
      name: tableName,
      originPath,
      columns: columns.map((column) => ({ name: column.column_name, type: column.data_type })),
    };
  }

  private async exec(db: duckdb.Database, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      db.run(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async all<T>(db: duckdb.Database, sql: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, (error, rows) => {
        if (error) reject(error);
        else resolve((rows ?? []) as T[]);
      });
    });
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
