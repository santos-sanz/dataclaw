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

1. Copy `.env.template` to `.env` and fill OpenRouter settings.
2. Copy `.kaggle/kaggle.json.template` to `.kaggle/kaggle.json` and add Kaggle credentials.
3. Install dependencies: `npm install`.
4. Build: `npm run build`.

## CLI

- `dataclaw`
- `dataclaw -p "<prompt>" --dataset <id>`
- `dataclaw --json -p "<prompt>" --dataset <id>`
- `dataclaw dataset add <owner/slug>`
- `dataclaw dataset files <owner/slug>`
- `dataclaw dataset list`
- `dataclaw ask --dataset <id> "<prompt>" [--yolo]`
- `dataclaw memory search "<query>" [--dataset <id>]`
- `dataclaw memory curate [--dataset <id>]`
