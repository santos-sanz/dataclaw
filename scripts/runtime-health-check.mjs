import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(`\n[runtime-check] ${message}\n`);
  process.exit(1);
}

function runNodeDuckDbCheck() {
  const code = `
const duckdb = require("duckdb");
const db = new duckdb.Database(":memory:");
db.all("SELECT 1 AS ok", (error, rows) => {
  if (error) {
    console.error(error.message || String(error));
    process.exit(1);
    return;
  }
  if (!rows || rows.length !== 1 || rows[0].ok !== 1) {
    console.error("DuckDB node smoke test produced unexpected rows.");
    process.exit(1);
    return;
  }
  db.close((closeError) => {
    if (closeError) {
      console.error(closeError.message || String(closeError));
      process.exit(1);
      return;
    }
    process.exit(0);
  });
});
`;

  const result = spawnSync("node", ["-e", code], { encoding: "utf-8" });
  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    fail(`Node DuckDB check failed. ${output}`);
  }
}

function runPythonDuckDbCheck() {
  const code = [
    "import duckdb",
    "con = duckdb.connect(database=':memory:')",
    "result = con.execute('SELECT 1').fetchone()",
    "assert result and result[0] == 1",
    "con.close()",
  ].join("\n");

  const result = spawnSync("python3", ["-c", code], { encoding: "utf-8" });
  if (result.error) {
    fail(`python3 is unavailable (${result.error.message}). Install Python 3 and retry.`);
  }

  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    fail(
      [
        "Python fallback dependency check failed.",
        "Install with: python3 -m pip install duckdb",
        `Details: ${output}`,
      ].join(" "),
    );
  }
}

runNodeDuckDbCheck();
runPythonDuckDbCheck();
console.log("[runtime-check] Node duckdb + python duckdb are healthy.");
