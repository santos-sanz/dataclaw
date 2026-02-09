# DataClaw Architecture

DataClaw follows a pi-mono-style package split with clear boundaries.

## Packages

- `@dataclaw/shared`: contracts, error types, filesystem paths.
- `@dataclaw/ai`: OpenRouter API wrapper.
- `@dataclaw/agent-core`: planner/executor loop and security checks.
- `@dataclaw/tui`: interactive terminal session UI.
- `@dataclaw/query-agent`: CLI commands, Kaggle/DuckDB integration, memory, audit.

## Query Flow

1. User submits a prompt (`interactive`, `ask`, or `-p`).
2. Dataset manifest and relevant memory entries are loaded.
3. Planner generates structured execution plan (SQL-first).
4. Mutating command detection is applied.
5. Approval gate asks for confirmation unless YOLO mode is enabled.
6. SQL runs on DuckDB. If SQL fails, Python fallback can run.
7. Successful retries save a learning entry in markdown memory.
8. Execution is appended to `audit.jsonl`.

## Memory Model

- Global curated memory: `MEMORY.md`
- Global daily memory: `.dataclaw/memory/global/YYYY-MM-DD.md`
- Dataset curated memory: `.dataclaw/datasets/<dataset_id>/MEMORY.md`
- Dataset daily memory: `.dataclaw/datasets/<dataset_id>/memory/YYYY-MM-DD.md`

## Security Rules

- SQL mutating keywords are blocked behind approval.
- Python mutating patterns are blocked behind approval.
- `--yolo` bypasses approval for one invocation.

## Operational Notes

- DataClaw expects the `kaggle` CLI to be installed and authenticated.
- DuckDB runtime dependency is provided through the `duckdb` Node package.
- Python fallback expects `python3` in PATH and Python package `duckdb` installed.
