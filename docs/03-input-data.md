[← Quickstart](02-quickstart.md) · [Documentation index](README.md) · Next: [Preprocessing →](04-preprocessing.md)

# 3. Input data formats

GRNScope accepts five files. Only the first is required.

| File | Required | What it enables |
| --- | --- | --- |
| [Expression matrix](#32-expression-matrix-required) | **Yes** | Everything |
| [Pseudotime](#33-pseudotime-optional) | No | Time-ordered algorithms; the Trajectory view |
| [Ground-truth network](#34-ground-truth-network-optional) | No | The Benchmark view |
| [Cluster labels](#35-cluster-labels-optional) | No | Per-cluster networks; cluster-specific CellOracle |
| [GeneOrdering CSV](#36-geneordering-csv-optional) | No | Trajectory-aware gene filtering with your own p-values |

## 3.1 Rules that apply to every file

- **`.csv` extension**, checked on the filename. Files without it are rejected
  outright.
- **Maximum 500 MB each.** (`MAX_FILE_SIZE_BYTES`,
  [`app/validators.py`](../backend/app/validators.py))
- **UTF-8 text.**
- **Comma, tab, or semicolon separated.** The delimiter is sniffed from the
  first 64 KB. If sniffing is inconclusive, GRNScope falls back to tab when the
  first line contains one, then semicolon, then comma. You do not need to tell
  it which you used.
- **Completely blank rows are skipped** everywhere.
- Files are uploaded to a **temporary staging area first** and only committed to
  a project once validation passes. Staged uploads are deleted automatically
  after 24 hours (`GRNSCOPE_TEMP_UPLOAD_TTL_SECONDS`).

## 3.2 Expression matrix (required)

**Genes as rows, cells as columns.**

```csv
,cell_001,cell_002,cell_003
DMRT1,0.0023,0.0228,1.7351
FGF9,0.0188,0.0372,1.9803
RSPO1,2.2042,1.6942,0.0148
```

### Structure rules

| Rule | Error you will see if you break it |
| --- | --- |
| At least 2 columns (genes + ≥1 cell) | "Expression matrix must contain a first column of gene names and at least one cell column." |
| No blank cell identifiers in the header | "Header row contains blank cell identifiers." |
| Cell identifiers unique | "Cell identifiers must be unique." |
| No blank gene names | "First column contains blank gene names." |
| Gene names unique | "Gene names must be unique." |
| Every row has the same column count as the header | "Expression matrix row N has X columns; expected Y." |
| Every interior value numeric and finite | "Expression matrix contains missing or non-numeric interior values." |

### Missing values are not allowed

The tokens `""`, `NA`, `N/A`, `NaN`, `nan`, `null`, and `NULL` are all treated
as missing and **rejected** in the expression matrix. Infinities are rejected
too. Impute or zero-fill before uploading — in scRNA-seq a gene not detected in
a cell is normally recorded as `0`, not as `NA`.

### Two validation modes

By default GRNScope runs in **strict** mode and checks every value in the file.
Setting `GRNSCOPE_UPLOAD_VALIDATION_MODE` to anything else switches to **fast**
mode, which fully checks the first 20 rows, then spot-checks the first and last
4 columns of subsequent rows, and counts the remaining rows without parsing
them. Fast mode makes very large uploads quicker but can let a malformed value
through to run time. Strict is the default for a reason.

Note that even in strict mode, upload validation is a *structural* check. A
second, deeper content scan runs at analysis time — see
[the preprocessing failure modes](08-troubleshooting.md#83-dataset-and-preprocessing-errors).

### Transposed matrices

GRNScope cannot detect that you uploaded cells-as-rows. It will happily treat
your 2,000 cell barcodes as gene names. The dimension readout in the upload
dialog (`19 genes × 2,000 cells`) is your check — if the two numbers are
swapped relative to what you expect, transpose the file and re-upload.

## 3.3 Pseudotime (optional)

Pseudotime unlocks the seven time-ordered algorithms (SCODE, SINCERITIES,
SCRIBE, SINGE, LEAP, GRISLI, GRNVBEM) and the Trajectory view.

You have three options: upload a file, let GRNScope **estimate it with
Slingshot** (a Docker-based tool run for you), or skip it entirely and use only
the algorithms that do not need it.

### Format A — one value per cell

```csv
0.0
0.13
0.27
```

One column, one row per cell, **in the same order as the matrix columns**. Every
value must be numeric and finite, and the row count must exactly equal the cell
count.

### Format B — BEELINE style, cell IDs plus trajectory columns

```csv
,PseudoTime1,PseudoTime2
E37_5_927,114.759,NA
E42_7_69,104.855,NA
E20_7_209,NA,148.608
```

The first column holds cell identifiers; each remaining column is one
trajectory. **Blank and `NA` values are allowed here** — a cell that belongs to
one branch has no pseudotime on the other. This is the format the sample file
uses, and it is the one you want for branching differentiation.

Rules:

- One row per expression-matrix cell; cell identifiers must be unique
- At least one numeric value overall
- **Every trajectory column must contain at least one numeric value** —
  a completely empty column is an error naming the offending column
- Row count must equal the expression cell count

GRNScope also accepts two common malformed exports: a missing first-column
header (`PseudoTime1,PseudoTime2` over three-column data rows) and a trailing
empty header. Both are recognised as shifted headers and handled
(`resolve_pseudotime_table_layout`).

Whatever you upload is converted to one canonical internal form before use
([`pseudotime_format_service.py`](../backend/app/services/pseudotime_format_service.py)),
so downstream algorithms always see the same layout.

### A warning about pseudotime quality

Every pseudotime-based method inherits the errors of its ordering. The BEELINE
paper found several of these algorithms to be sensitive to pseudotime quality,
and GRNScope repeats that warning in each algorithm's limitations. If your
trajectory is uncertain, prefer the methods that do not need it.

## 3.4 Ground-truth network (optional)

A list of interactions you already believe to be true. It powers the
[Benchmark view](07-results-guide.md#77-benchmark) and is used for nothing else
— it never influences inference.

```csv
Gene1,Gene2,Type
SOX9,AMH,+
FOXL2,SOX9,-
```

- Two columns minimum: regulator, then target. Header names are flexible —
  `Gene1`/`Gene2`, `TF`/`Target`, `source`/`target` are all recognised.
- An optional third column gives the sign. Accepted values for activation:
  `+`, `1`, any positive number, `activation`, `activating`, `positive`. For
  repression: `-`, `-1`, any negative number, `inhibition`, `inhibitory`,
  `repression`, `negative`. Anything else is treated as unsigned.
- Only edges between genes present in your analysis are scored.

Partial reference networks are fine and normal. The benchmark metrics are all
computed relative to the reference you supply, so a reference covering 76
interactions is scored against those 76.

## 3.5 Cluster labels (optional)

Assigns each cell to a cell type or state, which lets GRNScope build a separate
network per cluster in addition to the global one.

```csv
cell_id,cluster
E37_5_927,Chondrocyte
E42_7_69,Chondrocyte
E20_7_209,Osteoblast
```

- Exactly two meaningful columns: cell identifier, then label.
- A header is optional. It is detected when the first cell matches a known
  cell-ID name (`cell`, `cell_id`, `cellid`, `sample`, …) **and** the second
  matches a known label name (`cluster`, `cluster_id`, `cell_type`, `celltype`,
  `label`, `group`).
- **Every cell in the expression matrix must be labelled exactly once.** Missing
  cells are an error that names how many and lists the first five. Extra cells
  not in the matrix are also an error.
- Clusters with **fewer than 50 cells** are skipped when building per-cluster
  networks (`MIN_CLUSTER_SCOPE_CELLS`), because a network from 12 cells is not
  meaningful. The label file must still be complete.

## 3.6 GeneOrdering CSV (optional)

Only relevant if you enable **trajectory-aware filtering** and choose to upload
your own ordering rather than have GRNScope calculate one.

```csv
Gene,VGAMpValue,Variance
SOX9,1.2e-14,3.41
FOXL2,4.5e-09,2.87
```

- First column: gene name. Second: a p-value in **[0, 1]** for that gene's
  association with pseudotime. Optional third column: variance.
- A header row is detected when the first cell is blank/`gene`/`genes`/
  `gene_name`/`gene_id` and the second looks like a p-value name (`p`, `pval`,
  `p_value`, `VGAMpValue`, …). Headerless files work too.
- Gene names must be unique and non-blank; p-values must be numeric, finite,
  and within 0–1; variance, if present, must be non-negative.
- Genes in the ordering that are absent from the expression matrix are
  **allowed** and simply reported — BEELINE drops them before filtering. But if
  there is **no overlap at all**, that is an error, and it almost always means a
  gene-naming mismatch (symbols vs Ensembl IDs).

If you do not upload one, GRNScope computes the equivalent itself from your
pseudotime — see
[trajectory-aware filtering](04-preprocessing.md#45-stage-2--trajectory-aware-filtering).

## 3.7 What GRNScope infers about your data

Two things are detected automatically at upload and shown for you to confirm.

### Species

[`species_inference.py`](../backend/app/species_inference.py) guesses your
species two ways: from species-coded identifiers (Ensembl prefixes such as
`ENSMUSG`, FlyBase `FBgn`, WormBase `WBGene`, yeast systematic names) and, if
those are absent, by measuring how well your gene symbols overlap each species'
curated transcription-factor reference.

Supported species: human, mouse, rat, pig, chicken, zebrafish,
*Xenopus tropicalis*, *Drosophila*, *C. elegans*, *S. cerevisiae*, and "other".

You must confirm the guess before starting. It matters because it selects the
TF list used for gene prioritisation and for TF-shaped nodes in the network, and
because CellOracle needs a species-specific base network — a mismatch there is
a hard failure, not a warning.

### Matrix state

Described in detail in
[the next chapter](04-preprocessing.md#42-matrix-state-what-kind-of-numbers-are-these).
In short, GRNScope samples up to 96 cell columns and decides between `raw`,
`normalized`, and `log_normalized` by checking how many values are integers,
whether per-cell totals are near-constant, and whether undoing a log transform
makes them near-constant. It reports its confidence and reasoning, and you can
override it.

---

Next: [4. Preprocessing and gene selection →](04-preprocessing.md)
