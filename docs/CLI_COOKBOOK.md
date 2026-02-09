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

Launch Terminal UI:

```bash
$DC
```

## 1) Minimum flow: search -> install -> query

```bash
$DC dataset search "titanic" --file-type csv
$DC dataset add heptapod/titanic
$DC ask --dataset $DATASET --prompt "How many rows are there?"
```

## 2) Search datasets with more precision

```bash
$DC dataset search "sales forecast" --file-type csv
$DC dataset search "sales forecast" --file-type parquet
$DC dataset search "sales forecast" --file-type sqlite
$DC dataset search "sales forecast" --page 3
```

## 3) Install quickly from interactive ranking

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

## 4) Validate remote files before downloading

```bash
$DC dataset files heptapod/titanic
$DC dataset files zillow/zecon
$DC dataset files uciml/iris
```

## 5) Work with multiple local datasets

```bash
$DC dataset add uciml/iris
$DC dataset add zillow/zecon
$DC dataset list
```

## 6) Common analytical queries

```bash
$DC ask --dataset $DATASET --prompt "Count rows by Survived"
$DC ask --dataset $DATASET --prompt "Average age by sex"
$DC ask --dataset $DATASET --prompt "Top 10 fares and passenger names"
$DC ask --dataset $DATASET --prompt "Find null counts per column"
$DC ask --dataset $DATASET --prompt "Show duplicates by Ticket"
```

## 7) One-shot mode for scripts and pipelines

```bash
$DC --dataset $DATASET -p "Count rows by Pclass" --json > result.json
$DC --dataset $DATASET -p "Average fare by embarkation port" --json > fare_by_port.json
$DC --dataset $DATASET -p "Top 20 highest fares" > top_fares.txt
```

## 8) Interactive mode for exploration

```bash
$DC
```

Inside the session:

```text
/datasets
/dataset heptapod_titanic
/yolo off
count passengers by sex
show 10 random rows
/exit
```

## 9) Terminal UI walkthrough (step by step)

Start Terminal UI:

```bash
$DC
```

1) List datasets:

```text
/datasets
```

2) Activate one dataset:

```text
/dataset heptapod_titanic
```

3) Ask questions:

```text
count rows by survived
average fare by class
show null counts per column
```

4) Toggle approvals:

```text
/yolo on
/yolo off
```

5) Show help and exit:

```text
/help
/exit
```

## 10) Test approval-gated execution

```bash
$DC ask --dataset $DATASET --prompt "Create table tmp as select * from main_table limit 10"
```

You should see a `yes/no` confirmation.

If you want to skip confirmation for that execution:

```bash
$DC ask --dataset $DATASET --prompt "Create table tmp as select * from main_table limit 10" --yolo
```

## 11) Learning memory

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

## 12) Scheduled runs (cron)

Daily example at 08:00:

```bash
0 8 * * * cd /path/to/dataclaw && npm exec dataclaw -- --dataset heptapod_titanic -p "Daily KPI summary" --json >> /path/to/dataclaw/.dataclaw/logs/cron.log 2>&1
```

## 13) Quick troubleshooting examples

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
