[← Results guide](07-results-guide.md) · [Documentation index](README.md) · Next: [Operations →](09-operations.md)

# 8. Troubleshooting and FAQ

## 8.1 Where errors appear

Failures surface in three places, in increasing order of detail:

1. **The project card** — a status of *Setup issue*, *Partially completed*, or
   *Failed*.
2. **Analysis details → Algorithms executed** — each failed algorithm shows a
   short, cleaned-up error. GRNScope filters Docker, MATLAB-runtime and
   traceback noise out of these messages to leave the line that actually
   explains the failure (`extract_user_friendly_beeline_error`).
3. **The diagnostics folder on disk** — the complete record, described in
   [§8.7](#87-reading-the-diagnostics-folder).

There is an important distinction between the two failure classes:

- **Setup issues** happen before any algorithm starts — the matrix, pseudotime,
  cluster labels, GeneOrdering, or preprocessing failed. Nothing ran, and no
  amount of rerunning individual algorithms will help. Fix the input and create
  a new project.
- **Algorithm failures** happen to one method while others succeed. Fix the
  cause and use **Rerun** on that algorithm alone; the other results are kept.

## 8.2 Upload rejected

| Message | Cause and fix |
| --- | --- |
| "File must be a CSV file." | The filename does not end in `.csv`. Rename it; the extension is checked, not the contents |
| "File size must be 500 MB or smaller." | Reduce the file — filter genes, or subsample cells |
| "CSV file is empty." | The file has no non-whitespace content |
| "Expression matrix must contain a first column of gene names and at least one cell column." | Fewer than two columns. Often a delimiter problem — check the file really is comma/tab/semicolon separated |
| "Cell identifiers must be unique." / "Gene names must be unique." | Duplicated names. Deduplicate before uploading; `make.unique()` in R or a suffix in pandas |
| "Header row contains blank cell identifiers." | An empty column header, often a trailing comma on the first line |
| "Expression matrix row N has X columns; expected Y." | Ragged rows. Frequently caused by a gene name containing the delimiter — quote it or rename |
| "Expression matrix contains missing or non-numeric interior values." | `NA`/blank/text inside the matrix. Replace with `0` or an imputed value; see [§3.2](03-input-data.md#missing-values-are-not-allowed) |
| "Pseudotime row count (X) does not match cell count (Y)." | One row per matrix cell is required, in the same order for single-column format |
| "Pseudotime trajectory columns must contain at least one numeric value." | An entirely empty lineage column; remove it |
| "Cluster label file is missing labels for N expression cells" | Every cell must be labelled. The message lists the first five |
| "GeneOrdering CSV has no genes in common with the expression matrix." | Naming mismatch — symbols vs Ensembl IDs, or a species mismatch |

## 8.3 Dataset and preprocessing errors

A second, deeper scan runs when the analysis starts. Unlike upload validation it
does **not** stop at the first problem: it groups every issue by type, counts
occurrences, records up to five example locations each, and writes a
**validation report CSV** you can download. Columns are Severity, Issue type,
Row, Column, Current value, Required correction, Location.

Issue types: `empty_matrix`, `missing_cell_columns`, `blank_cell_identifier`,
`duplicate_cell_identifier`, `blank_gene_name`, `duplicate_gene_name`,
`inconsistent_row_length`, `missing_expression_value`,
`non_numeric_expression_value`, `non_finite_expression_value`, `invalid_csv`,
`unreadable_matrix`.

Download the report, fix everything it lists in one pass, and re-upload. That is
much faster than fixing one error at a time.

**"Detection filtering removed every gene."** Your threshold is too high for the
sparsity of your data. Lower it, or check that the matrix is not accidentally
all zeros.

**"Trajectory-aware filtering removed every gene."** Raise the p-value
threshold, turn off Bonferroni correction, or check that your GeneOrdering
matches your gene names.

**"Variable-gene selection removed every gene."** The gene count is invalid;
it must be a positive integer.

**"Pseudotime is required to calculate GeneOrdering."** You enabled
trajectory-aware filtering with the *calculate* source but supplied no
pseudotime. Upload one, enable Slingshot estimation, or turn the stage off.

**"Pseudotime does not contain a usable trajectory."** Every lineage has fewer
than three numeric values, or no variation in them.

## 8.4 Algorithm-specific failures

### CellOracle: species mismatch

CellOracle needs a species-specific base regulatory network. If the species you
chose does not match your gene names, the run fails with error type
`celloracle_species_mismatch` and a dedicated explanation in the interface.

Fix the species and rerun CellOracle. This is the most common CellOracle
failure, and it is why the upload dialog will not let you start without
confirming the species.

### CellOracle: perturbation unavailable

> "CellOracle must be rerun once because its expression preprocessing has been
> corrected."

Your CellOracle result predates a correction to how expression is prepared for
it. The stored result carries an older input-contract version
(`CELLORACLE_INPUT_CONTRACT_VERSION`). Rerun CellOracle; perturbation becomes
available afterwards.

Perturbation is also unavailable if CellOracle was never selected, is still
running, or failed. The tab's tooltip says which.

### PPCOR / SINCERITIES: too many genes

Both need **more cells than genes** for valid statistics — PPCOR inverts a dense
correlation matrix, SINCERITIES runs a partial-correlation step. GRNScope
automatically lowers their gene caps when needed, and bootstrap resampling
reduces the effective cell count further. If they still fail, lower `maxGenes`
explicitly.

### SINGE: empty runs

SINGE can produce no valid edges for a bootstrap run. Up to
`SINGE_MAX_CONSECUTIVE_EMPTY_RUNS` (3) consecutive empty runs are tolerated,
with diagnostics archived; beyond that the algorithm fails. Usually this means
the gene set is too small, the regularisation (`lambda`) too strong, or the
pseudotime too sparse.

### SINGE: invalid parameter combination

`dT × num_lags` must be **less than 100**. This is validated when the job is
created, so you get the error immediately rather than after a long run.

### Out of memory / killed

Look for `killed` or `out of memory` in the diagnostics. Reduce the gene count
first, then the cell count, then concurrency
(`GRNSCOPE_MAX_CONCURRENT_ALGORITHMS`) or the per-algorithm memory budget
(`GRNSCOPE_ALGORITHM_MEMORY_MB`). GRISLI, GRNVBEM and SINGE are the usual
culprits.

### Docker image missing

Every algorithm except PEARSON runs in a Docker container
(`grnbeeline/*`). If the image is absent the run fails with a not-found error.
See [operations](09-operations.md#93-docker-images).

## 8.5 Stopping and rerunning

**Stop one algorithm.** Its running processes and Docker containers are
terminated, the task is marked stopped, and other algorithms continue
unaffected.

**Stop the project.** All tasks stop and queued work is cancelled.

**Rerun one algorithm.** The task is reset and requeued. Preprocessing is not
redone — the cached preprocessed matrix is reused, so the rerun is comparable to
the original. A previous successful result is preserved until the new attempt
succeeds, so a failed rerun does not destroy what you had
(`restore_preserved_result_after_attempt`).

Each rerun writes to a **new attempt directory**, so an older failure is never
overwritten and you can compare attempts.

## 8.6 Common questions

**Where did my projects go?**
They are tied to the `grnscope_client_id` cookie in the browser that created
them ([§1.5](01-overview.md#15-projects-accounts-and-privacy)). A different
browser, a different machine, private browsing, or a cleared cookie store means
they are not visible. There is no recovery path — download results you need to
keep.

**Can I share a project with a colleague?**
Not through the interface. Share the downloaded CSVs and the metadata bundle.

**Why does my network look empty?**
Almost always the filters. Open Results Settings and check Evidence, Confidence
and Minimum supporting methods, then look at the `N matching edges` count. If it
is 0, relax the filters. If it is large but the graph is sparse, raise the
display limit.

**Why do the methods disagree so much?**
Because they genuinely do. That is the finding BEELINE was built to measure, and
it is why the consensus, support count, and method-agreement matrix exist. Trust
edges several independent methods agree on.

**Why is everything at 100% confidence?**
Small gene sets. With 19 genes each target has at most 18 candidate regulators,
so the top-10 threshold catches most of them in every run. Confidence becomes
discriminating on realistically sized gene sets.

**Why only 3 bootstrap runs?**
Early stopping — the ranking stopped changing
([§6.5](06-metrics.md#65-early-stopping)). "stopped early" is a good sign.

**Can I use raw counts?**
Yes. Set the matrix state to `raw` and GRNScope normalizes and log-transforms
for you. What you must not do is mislabel the state.

**Do I need pseudotime?**
No. The three recommended methods do not use it. Supply it only if you have a
trajectory you trust.

**How many genes should I analyse?**
500–2,000 is a sensible working range. Below ~100 the statistics get thin; above
a few thousand, runtime for the slower methods becomes impractical.

**Can I compare two projects?**
Not in the interface. Download both consensus edge tables and compare them
externally.

**Are results reproducible?**
Yes for the resampling: bootstrap draws are seeded deterministically from the
dataset, so the same input and settings produce the same draws. Some algorithms
have their own internal randomness that GRNScope does not control.

## 8.7 Reading the diagnostics folder

For self-hosted instances, every failure is recorded under the project
directory. The layout is documented in
[`backend/PROJECT_FOLDER_STRUCTURE.md`](../backend/PROJECT_FOLDER_STRUCTURE.md).

```
backend/projects/<project-id>/
├── project.json          # configuration and input paths
├── jobs.json             # job and per-algorithm status
├── metadata.json         # downloadable analysis metadata
├── preprocessed/         # the shared normalized matrix
├── results/<ALGORITHM>/  # successful outputs
│   ├── result.json
│   ├── rankedEdges.csv
│   ├── runs/             # per-bootstrap ranked edges
│   └── logs/
└── diagnostics/<ALGORITHM>/
    ├── latest.json       # pointer to the newest failure
    └── <job-id>/attempt-<UTC timestamp>/
        ├── error.json    # error summary, timing, traceback, file index
        └── runtime/<scope>/
            ├── config.yaml
            ├── run_timings.json
            ├── stdout.log
            ├── stderr.log
            └── outputs/  # BEELINE output.txt, time*.txt, *.log
```

The procedure:

1. Open `diagnostics/<ALGORITHM>/latest.json` to find the newest attempt.
2. Read that attempt's `error.json` first — it has the user-facing error, the
   error type, timings, the traceback, and an index of the copied files.
3. Then `stderr.log`, then `stdout.log`.
4. If a Docker or wrapper failure is suspected, check the preserved `output.txt`
   or `time*.txt` under `runtime/<scope>/outputs/`.

Input matrices and generated ranked-edge CSVs are deliberately **not** copied
into diagnostics, which keeps the bundles small while preserving the files that
normally explain a failure.

## 8.8 Getting help

The **Contact us** link in the header opens a support form. Include the project
ID (shown next to the project name, e.g. `61d6eb3be929`), which algorithm
failed, and the error text from Analysis details.

---

Next: [9. Operations and deployment →](09-operations.md)
