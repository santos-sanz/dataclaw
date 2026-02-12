import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDatasetRoot, type ModelBuildPlan } from "@dataclaw/shared";
import { DuckDbService } from "../services/duckdb-service.js";

export interface LaunchModelWebAppInput {
  cwd: string;
  datasetId: string;
  runId?: string;
  port: number;
  host: string;
}

export interface LaunchModelWebAppResult {
  url: string;
  runId: string;
  close: () => Promise<void>;
}

interface StoredModelManifest {
  request: {
    datasetId: string;
    selectedTables: string[];
    goal?: string;
  };
  plan: ModelBuildPlan;
  artifacts: {
    runId: string;
    outputDir: string;
  };
}

interface RelationPreview {
  name: string;
  rowCount: number | null;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  error?: string;
}

interface ModelWebPayload {
  datasetId: string;
  runId: string;
  goal?: string;
  strategy: string;
  generatedAt: string;
  sqlStatements: string[];
  assumptions: string[];
  warnings: string[];
  relations: RelationPreview[];
}

export async function launchModelWebApp(input: LaunchModelWebAppInput): Promise<LaunchModelWebAppResult> {
  const run = resolveModelRun(input.cwd, input.datasetId, input.runId);
  const dbPath = join(getDatasetRoot(input.datasetId, input.cwd), "canonical.duckdb");
  const duck = new DuckDbService(dbPath);

  const payload: ModelWebPayload = {
    datasetId: run.manifest.request.datasetId,
    runId: run.runId,
    goal: run.manifest.request.goal,
    strategy: run.manifest.plan.strategy,
    generatedAt: readGeneratedAt(run),
    sqlStatements: run.manifest.plan.sqlStatements,
    assumptions: run.manifest.plan.assumptions,
    warnings: run.manifest.plan.warnings,
    relations: await loadRelationPreviews(duck, run.manifest.plan, run.manifest.request.selectedTables),
  };

  const html = renderModelWebHtml();

  const server = createServer((req, res) => {
    handleRequest(req, res, payload, html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => resolve());
  });

  const url = `http://${input.host}:${input.port}`;
  return {
    url,
    runId: run.runId,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function resolveModelRun(cwd: string, datasetId: string, runId?: string): { runId: string; manifest: StoredModelManifest; dir: string } {
  const modelsRoot = join(getDatasetRoot(datasetId, cwd), "models");
  if (!existsSync(modelsRoot)) {
    throw new Error(
      `No model runs found for dataset '${datasetId}'. Build one with '/model build --tables <t1,t2>' (interactive) or 'dataclaw model build --tables <t1,t2>' (CLI).`,
    );
  }

  const targetRunId = runId?.trim() || findLatestRunId(modelsRoot);
  if (!targetRunId) {
    throw new Error(
      `No model runs found for dataset '${datasetId}'. Build one with '/model build --tables <t1,t2>' (interactive) or 'dataclaw model build --tables <t1,t2>' (CLI).`,
    );
  }

  const dir = join(modelsRoot, targetRunId);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Model run '${targetRunId}' does not include manifest.json.`);
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as StoredModelManifest;
  if (!parsed?.plan?.sqlStatements?.length) {
    throw new Error(`Model run '${targetRunId}' manifest is invalid.`);
  }

  return {
    runId: targetRunId,
    manifest: parsed,
    dir,
  };
}

function findLatestRunId(modelsRoot: string): string | undefined {
  const runs = readdirSync(modelsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  return runs[0];
}

async function loadRelationPreviews(
  duck: DuckDbService,
  plan: ModelBuildPlan,
  selectedTables: string[],
): Promise<RelationPreview[]> {
  const relationCandidates = uniqueStrings([
    ...selectedTables,
    ...Object.values(plan.naming.baseViews),
    plan.naming.modelView,
  ]);

  const previews: RelationPreview[] = [];
  for (const relation of relationCandidates) {
    const escaped = quoteIdentifier(relation);
    try {
      const countRows = await duck.queryRows(`SELECT COUNT(*) AS total_rows FROM ${escaped}`);
      const rowCountRaw = Number((countRows[0] as Record<string, unknown> | undefined)?.total_rows ?? 0);
      const rowCount = Number.isFinite(rowCountRaw) ? rowCountRaw : null;
      const rows = await duck.queryRows(`SELECT * FROM ${escaped} LIMIT 50`);
      const columns = rows.length ? Object.keys(rows[0]) : [];
      previews.push({
        name: relation,
        rowCount,
        columns,
        rows,
      });
    } catch (error) {
      previews.push({
        name: relation,
        rowCount: null,
        columns: [],
        rows: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return previews;
}

function readGeneratedAt(run: { dir: string }): string {
  const schemaPath = join(run.dir, "schema.snapshot.json");
  if (!existsSync(schemaPath)) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(schemaPath, "utf-8")) as { generatedAt?: string };
    return parsed.generatedAt ?? "unknown";
  } catch {
    return "unknown";
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse, payload: ModelWebPayload, html: string): void {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (requestUrl.pathname === "/api/model") {
    writeJson(res, payload);
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Not found" }));
}

function writeJson(res: ServerResponse, payload: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(stringifyJsonSafe(payload));
}

export function stringifyJsonSafe(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "bigint") {
      if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
        return Number(value);
      }
      return value.toString();
    }
    return value;
  });
}

function renderModelWebHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DataClaw Model Web</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #1f2432;
      --paper: #f4eee1;
      --panel: #fffaf0;
      --accent: #cf4f2f;
      --accent-2: #0f6f78;
      --muted: #6f6658;
      --line: #d8c8a9;
      --shadow: 0 14px 34px rgba(27, 29, 35, 0.14);
      --radius: 16px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 12%, rgba(207, 79, 47, 0.18), transparent 34%),
        radial-gradient(circle at 88% 8%, rgba(15, 111, 120, 0.18), transparent 35%),
        var(--paper);
      min-height: 100vh;
    }

    .shell {
      width: min(1200px, 95vw);
      margin: 24px auto;
      display: grid;
      gap: 16px;
    }

    .hero {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: linear-gradient(138deg, #fff9ed, #fffef9);
      box-shadow: var(--shadow);
      padding: 18px 22px;
      display: grid;
      gap: 10px;
    }

    .kicker {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 700;
    }

    .hero h1 {
      margin: 0;
      font-family: "Fraunces", serif;
      font-size: clamp(28px, 4.5vw, 48px);
      line-height: 1;
      letter-spacing: 0.02em;
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      background: #fff;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(340px, 1fr) minmax(400px, 1.6fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      padding: 14px;
      display: grid;
      gap: 10px;
    }

    .panel h2 {
      margin: 0;
      font-size: 18px;
      font-family: "Fraunces", serif;
    }

    .code {
      margin: 0;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid #d8d0bf;
      background: #2a2f3a;
      color: #f9ead7;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.45;
    }

    .relation-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .relation-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    .relation-card strong { font-size: 13px; }
    .relation-card span { font-size: 12px; color: var(--muted); }

    .table-controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    select {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 8px 10px;
      color: var(--ink);
      font-weight: 500;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 520px;
    }

    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid #ebe0ca;
      font-size: 12px;
      vertical-align: top;
    }

    th {
      position: sticky;
      top: 0;
      background: #fef6e7;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #594f42;
    }

    .muted { color: var(--muted); }

    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .shell { margin: 14px auto; }
      .hero { padding: 14px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <p class="kicker">DataClaw SQL cockpit</p>
      <h1 id="title">Loading model…</h1>
      <div class="hero-meta" id="meta"></div>
      <p class="muted" id="subtitle"></p>
    </section>

    <section class="layout">
      <article class="panel">
        <h2>SQL statements</h2>
        <div id="sql-list"></div>
      </article>

      <article class="panel">
        <h2>Extracted data preview</h2>
        <div class="relation-grid" id="relation-grid"></div>

        <div class="table-controls">
          <label for="relation-select">Relation</label>
          <select id="relation-select"></select>
          <span class="muted" id="relation-hint"></span>
        </div>

        <div class="table-wrap">
          <table>
            <thead id="table-head"></thead>
            <tbody id="table-body"></tbody>
          </table>
        </div>
      </article>
    </section>
  </main>

  <script>
    const state = { payload: null, selectedRelation: null };

    const titleEl = document.getElementById('title');
    const subtitleEl = document.getElementById('subtitle');
    const metaEl = document.getElementById('meta');
    const sqlListEl = document.getElementById('sql-list');
    const relationGridEl = document.getElementById('relation-grid');
    const relationSelectEl = document.getElementById('relation-select');
    const relationHintEl = document.getElementById('relation-hint');
    const tableHeadEl = document.getElementById('table-head');
    const tableBodyEl = document.getElementById('table-body');

    const escapeHtml = (value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    const fmtCount = (value) => {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
      return new Intl.NumberFormat().format(Number(value));
    };

    function renderMeta(payload) {
      titleEl.textContent = payload.datasetId + ' · model ' + payload.runId;
      subtitleEl.textContent = payload.goal || 'Model generated from SQL statements and rendered for web inspection.';
      const badges = [
        ['strategy', payload.strategy],
        ['generated', payload.generatedAt],
        ['relations', payload.relations.length],
      ];
      metaEl.innerHTML = badges
        .map(([k, v]) => '<span class="badge"><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(v) + '</span>')
        .join('');
    }

    function renderSql(payload) {
      if (!payload.sqlStatements.length) {
        sqlListEl.innerHTML = '<p class="muted">No SQL statements available.</p>';
        return;
      }

      sqlListEl.innerHTML = payload.sqlStatements
        .map((statement, index) => {
          const normalized = String(statement).trim();
          const text = normalized.endsWith(';') ? normalized : normalized + ';';
          return '<p class="muted">Statement ' + (index + 1) + '</p><pre class="code">' + escapeHtml(text) + '</pre>';
        })
        .join('');
    }

    function renderRelationCards(payload) {
      relationGridEl.innerHTML = payload.relations
        .map((relation) => {
          const count = relation.error ? 'error' : fmtCount(relation.rowCount);
          return (
            '<div class="relation-card">' +
              '<strong>' + escapeHtml(relation.name) + '</strong>' +
              '<span>rows: ' + escapeHtml(count) + '</span>' +
              '<span>columns: ' + escapeHtml(relation.columns.length) + '</span>' +
            '</div>'
          );
        })
        .join('');
    }

    function renderRelationOptions(payload) {
      relationSelectEl.innerHTML = payload.relations
        .map((relation) => '<option value="' + escapeHtml(relation.name) + '">' + escapeHtml(relation.name) + '</option>')
        .join('');

      if (!state.selectedRelation && payload.relations.length) {
        state.selectedRelation = payload.relations[0].name;
      }
      relationSelectEl.value = state.selectedRelation || '';
      relationSelectEl.onchange = () => {
        state.selectedRelation = relationSelectEl.value;
        renderTable();
      };
    }

    function renderTable() {
      if (!state.payload) return;
      const relation = state.payload.relations.find((item) => item.name === state.selectedRelation) || state.payload.relations[0];
      if (!relation) {
        relationHintEl.textContent = 'No relation data.';
        tableHeadEl.innerHTML = '';
        tableBodyEl.innerHTML = '';
        return;
      }

      if (relation.error) {
        relationHintEl.textContent = 'Error reading relation: ' + relation.error;
        tableHeadEl.innerHTML = '';
        tableBodyEl.innerHTML = '';
        return;
      }

      relationHintEl.textContent = 'Previewing up to 50 rows from ' + relation.name;
      const cols = relation.columns || [];

      tableHeadEl.innerHTML = '<tr>' + cols.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';

      if (!relation.rows.length) {
        tableBodyEl.innerHTML = '<tr><td class="muted" colspan="' + Math.max(cols.length, 1) + '">(no rows)</td></tr>';
        return;
      }

      tableBodyEl.innerHTML = relation.rows
        .map((row) => {
          const tds = cols.map((col) => {
            const value = row[col];
            const text = value === null || value === undefined ? 'NULL' : JSON.stringify(value);
            return '<td>' + escapeHtml(text) + '</td>';
          }).join('');
          return '<tr>' + tds + '</tr>';
        })
        .join('');
    }

    async function boot() {
      const response = await fetch('/api/model');
      if (!response.ok) {
        throw new Error('Failed to load /api/model');
      }

      const payload = await response.json();
      state.payload = payload;
      renderMeta(payload);
      renderSql(payload);
      renderRelationCards(payload);
      renderRelationOptions(payload);
      renderTable();
    }

    boot().catch((error) => {
      titleEl.textContent = 'Model web failed to load';
      subtitleEl.textContent = String(error);
    });
  </script>
</body>
</html>`;
}

function quoteIdentifier(value: string): string {
  return value
    .split(".")
    .map((part) => `"${part.replace(/"/g, "\"\"")}"`)
    .join(".");
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, self) => self.indexOf(value) === index);
}
