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

## Setup

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

## CLI

- `dataclaw`
- `dataclaw -p "<prompt>" --dataset <id>`
- `dataclaw --json -p "<prompt>" --dataset <id>`
- `dataclaw dataset search "<query>" [--file-type csv|sqlite|json|bigQuery|all] [--page <n>]`
- `dataclaw dataset add <owner/slug>`
- `dataclaw dataset files <owner/slug>`
- `dataclaw dataset list`
- `dataclaw ask --dataset <id> "<prompt>" [--yolo]`
- `dataclaw memory search "<query>" [--dataset <id>]`
- `dataclaw memory curate [--dataset <id>]`
