# DataClaw CLI Cookbook

Practical recipes for using DataClaw in real scenarios.

## Conventions used in this guide

```bash
DC="npm exec dataclaw --"
DATASET=heptapod_titanic
```

## 0) Install and launch quick reference

Install and build:

```bash
git clone <REPO_URL>
cd dataclaw
npm install
npm run build
cp .env.template .env
```

Launch in one-shot CLI mode:

```bash
$DC --dataset $DATASET -p "Count rows"
```

Launch in one-shot JSON mode:

```bash
$DC --dataset $DATASET -p "Count rows by Survived" --json
```

If a default dataset was already selected, `--dataset` can be omitted:

```bash
$DC -p "Count rows by Survived" --json
```

Launch Terminal UI:

```bash
$DC
```

The interactive shell uses a styled banner, semantic status messages, and panel rendering with automatic ANSI/ASCII compatibility fallback.

## 1) Minimum flow: discover -> inspect -> install -> query

```bash
$DC dataset discover "titanic" --file-type csv --no-interactive
$DC dataset inspect heptapod/titanic
$DC dataset add heptapod/titanic
$DC ask --dataset $DATASET --prompt "How many rows are there?"
```

## 2) Interactive discovery flow (single command)

```bash
$DC dataset discover "customer churn" --sort-by votes --file-type parquet
```

Inside discovery:

- `open 1` to inspect ranked dataset #1
- `install 1` to install ranked dataset #1
- `next` / `prev` to paginate
- `search <text>` to change query
- `filters` to show active filters
- `quit` to exit

## 3) Search datasets with more precision (classic `dataset search`)

```bash
$DC dataset search "sales forecast" --file-type csv
$DC dataset search "sales forecast" --file-type parquet
$DC dataset search "sales forecast" --file-type sqlite
$DC dataset search "sales forecast" --page 3
```

## 4) Install quickly from interactive ranking

```bash
$DC dataset search "customer churn" --pick
```

When this prompt appears:

```text
Select dataset to install (rank number, ref, Enter to skip):
```

You can answer with:

- `1` to install the first result.
- `owner/slug` to select by exact reference.
- `Enter` to skip installation.

## 5) Validate remote files before downloading

```bash
$DC dataset files heptapod/titanic
$DC dataset files zillow/zecon
$DC dataset files uciml/iris
```

## 6) Work with multiple local datasets

```bash
$DC dataset add uciml/iris
$DC dataset add zillow/zecon
$DC dataset list
```

The most recently selected/installed dataset is persisted per project in `.dataclaw/session.json` and reused as the default dataset in new sessions.

## 7) Common analytical queries

```bash
$DC ask --dataset $DATASET --prompt "Count rows by Survived"
$DC ask --dataset $DATASET --prompt "Average age by sex"
$DC ask --dataset $DATASET --prompt "Top 10 fares and passenger names"
$DC ask --dataset $DATASET --prompt "Find null counts per column"
$DC ask --dataset $DATASET --prompt "Show duplicates by Ticket"
```

With a persisted default dataset:

```bash
$DC ask --prompt "Count rows by Survived"
```

## 8) One-shot mode for scripts and pipelines

```bash
$DC --dataset $DATASET -p "Count rows by Pclass" --json > result.json
$DC --dataset $DATASET -p "Average fare by embarkation port" --json > fare_by_port.json
$DC --dataset $DATASET -p "Top 20 highest fares" > top_fares.txt
```

With a persisted default dataset:

```bash
$DC -p "Top 20 highest fares" > top_fares.txt
```

## 9) Interactive mode for exploration

```bash
$DC
```

Inside the session:

```text
dataclaw [dataset:none] [yolo:off] > /datasets
dataclaw [dataset:none] [yolo:off] > /dataset heptapod_titanic
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset search "customer churn" --file-type csv
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset open 1
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset add 1
dataclaw [dataset:heptapod_titanic] [yolo:off] > /yolo off
count passengers by sex
show 10 random rows
/exit
```

## 10) Terminal UI walkthrough (step by step)

Start Terminal UI:

```bash
$DC
```

1) List datasets:

```text
dataclaw [dataset:none] [yolo:off] > /datasets
```

2) Activate one dataset:

```text
dataclaw [dataset:none] [yolo:off] > /dataset heptapod_titanic
```

3) Search and inspect Kaggle datasets from TUI:

```text
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset search "credit risk" --file-type parquet
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset open 1
dataclaw [dataset:heptapod_titanic] [yolo:off] > /dataset add 1
```

4) Ask questions:

```text
dataclaw [dataset:heptapod_titanic] [yolo:off] > count rows by survived
dataclaw [dataset:heptapod_titanic] [yolo:off] > average fare by class
dataclaw [dataset:heptapod_titanic] [yolo:off] > show null counts per column
```

5) Toggle approvals:

```text
/yolo on
/yolo off
```

6) Show help and exit:

```text
/help
/exit
```

## 11) Test approval-gated execution

```bash
$DC ask --dataset $DATASET --prompt "Create table tmp as select * from main_table limit 10"
```

You should see a `yes/no` confirmation.

If you want to skip confirmation for that execution:

```bash
$DC ask --dataset $DATASET --prompt "Create table tmp as select * from main_table limit 10" --yolo
```

## 12) Learning memory

Search memory:

```bash
$DC memory search "column not found"
$DC memory search "binder error" --dataset $DATASET
```

Curate memory:

```bash
$DC memory curate
$DC memory curate --dataset $DATASET
```

## 13) Scheduled runs (cron)

Daily example at 08:00:

```bash
0 8 * * * cd /path/to/dataclaw && npm exec dataclaw -- --dataset heptapod_titanic -p "Daily KPI summary" --json >> /path/to/dataclaw/.dataclaw/logs/cron.log 2>&1
```

## 14) Quick troubleshooting examples

Kaggle credentials missing:

```bash
cp .kaggle/kaggle.json.template .kaggle/kaggle.json
```

Dataset not ingested:

```bash
$DC dataset add <owner/slug>
$DC dataset list
```

Validate installation:

```bash
$DC --help
$DC dataset --help
$DC ask --help
$DC memory --help
```
