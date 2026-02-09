# DataClaw

DataClaw is a TypeScript-first query agent inspired by pi-mono, specialized for Kaggle datasets.

## Features

- Interactive terminal mode and non-interactive print/json modes.
- Kaggle dataset download and file inspection from CLI.
- Canonical storage on DuckDB for supported file formats.
- SQL-first query execution with controlled Python fallback.
- Approval gate for mutating commands, with optional `--yolo` bypass.
- Markdown memory that auto-learns from successful error fixes.

## Monorepo packages

- `packages/shared`: shared schemas, contracts, filesystem paths.
- `packages/ai`: OpenRouter client.
- `packages/agent-core`: planner/executor loop.
- `packages/tui`: interactive terminal UI.
- `packages/query-agent`: DataClaw CLI and tools.

## Installation and Setup

This setup is intended only for laptop/desktop environments (macOS, Linux, or Windows with WSL).

1. Copy `.env.template` to `.env`.
2. Set OpenRouter variables in `.env`:
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL`
3. Configure Kaggle credentials (required to search and download remote datasets):
   - Option A: set `KAGGLE_USERNAME` and `KAGGLE_KEY` in `.env`
   - Option B: set `KAGGLE_API_TOKEN` in `.env`
   - Option C: copy `.kaggle/kaggle.json.template` to `.kaggle/kaggle.json` and fill it
4. Install dependencies: `npm install`.
5. Build: `npm run build`.

## Quick Start

Search remote datasets:

```bash
node packages/query-agent/dist/cli.js dataset search "titanic" --file-type csv
```

Search with ranked quality signals and pick one dataset to install immediately:

```bash
node packages/query-agent/dist/cli.js dataset search "titanic" --pick
```

Search using legacy raw Kaggle CSV output:

```bash
node packages/query-agent/dist/cli.js dataset search "titanic" --raw
```

Download and ingest a dataset:

```bash
node packages/query-agent/dist/cli.js dataset add heptapod/titanic
```

Run a one-shot query:

```bash
node packages/query-agent/dist/cli.js ask --dataset heptapod_titanic --prompt "How many rows are there?"
```

Run interactive mode:

```bash
node packages/query-agent/dist/cli.js
```

## Production Deployment (Laptop/Server)

DataClaw is a CLI-first app. In production, run it on a laptop/server host and use non-interactive commands.

1. Prepare environment and credentials:
   - `.env` with `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and Kaggle credentials.
2. Build once:

```bash
npm ci
npm run build
```

3. Run a production command (example):

```bash
node packages/query-agent/dist/cli.js ask --dataset heptapod_titanic --prompt "Daily KPI summary" --json
```

4. Schedule recurring jobs with `cron` (example every day at 08:00):

```bash
0 8 * * * cd /path/to/dataclaw && node packages/query-agent/dist/cli.js ask --dataset heptapod_titanic --prompt "Daily KPI summary" --json >> /path/to/dataclaw/.dataclaw/logs/cron.log 2>&1
```

5. Store output artifacts in your own pipeline (files, DB, dashboard, webhook).

## CLI Reference

- `dataclaw`
- `dataclaw -p "<prompt>" --dataset <id>`
- `dataclaw --json -p "<prompt>" --dataset <id>`
- `dataclaw dataset search "<query>" [--file-type csv|sqlite|json|bigQuery|parquet|all] [--page <n>] [--pick] [--raw]`
- `dataclaw dataset add <owner/slug>`
- `dataclaw dataset files <owner/slug>`
- `dataclaw dataset list`
- `dataclaw ask --dataset <id> "<prompt>" [--yolo]`
- `dataclaw memory search "<query>" [--dataset <id>]`
- `dataclaw memory curate [--dataset <id>]`

### Dataset Search Ranking

By default, `dataset search` renders a ranked table with:

- `title`, `formats`, `size`, `lastUpdated`, `voteCount`, and `downloadCount`.
- `quality` score (0-100), computed as:
  - `0.45 * usability`
  - `0.25 * normalized log10(votes + 1)`
  - `0.20 * normalized log10(downloads + 1)`
  - `0.10 * recency`, where `recency = exp(-days_since_update / 365)`

Format detection uses a hybrid strategy:

- Base format hint from `--file-type` when present.
- Enrichment for top-ranked results via `kaggle datasets files --csv`.

## Troubleshooting

- Kaggle credential errors:
  - Set `KAGGLE_USERNAME` + `KAGGLE_KEY`, or
  - Set `KAGGLE_API_TOKEN`, or
  - Create `.kaggle/kaggle.json`.
- OpenRouter errors:
  - Confirm `OPENROUTER_API_KEY` is present in `.env`.
