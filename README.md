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

## CLI Reference

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

## Android (Termux)

You can run DataClaw on Android with Termux:

```bash
termux-setup-storage
pkg update -y && pkg upgrade -y
pkg install -y git nodejs-lts python clang make pkg-config
python -m pip install --upgrade pip
python -m pip install kaggle
```

Then clone and build:

```bash
git clone https://github.com/santos-sanz/dataclaw.git
cd dataclaw
npm install
npm run build
```

If `kaggle` is not in PATH, DataClaw automatically tries `python3 -m kaggle`.

## Troubleshooting

- Kaggle credential errors:
  - Set `KAGGLE_USERNAME` + `KAGGLE_KEY`, or
  - Set `KAGGLE_API_TOKEN`, or
  - Create `.kaggle/kaggle.json`.
- OpenRouter errors:
  - Confirm `OPENROUTER_API_KEY` is present in `.env`.
