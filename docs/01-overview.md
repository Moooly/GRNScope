[← Documentation index](README.md) · Next: [Quickstart →](02-quickstart.md)

# 1. Overview and concepts

## 1.1 What problem does this solve?

Genes do not act alone. Transcription factors bind DNA and switch other genes
on or off, and those targets may themselves be regulators. The resulting web of
influence is a **gene regulatory network (GRN)**.

You cannot see this network directly in an RNA-seq experiment. What you measure
is the expression level of each gene in each cell. GRN inference is the reverse
problem: given only the expression measurements, work out which genes appear to
be controlling which others.

Single-cell data makes this tractable. In bulk RNA-seq every sample is an
average over thousands of cells, so you might have twenty data points. In
single-cell data every cell is its own observation, so you might have thousands.
That is enough variation for statistical methods to look for patterns such as
"whenever *SOX2* is high in a cell, *NANOG* tends to be high too" or "cells that
passed through a high-*GATA1* state later show high *KLF1*".

## 1.2 What is BEELINE, and what is GRNScope?

Dozens of GRN inference algorithms exist and they disagree with each other.
**BEELINE** (Pratapa et al., *Nature Methods*, 2020) is an academic benchmarking
framework that packages many of these algorithms into a common interface, each
inside its own Docker container so their conflicting dependencies (R, MATLAB,
Julia, Python) do not collide. BEELINE is a command-line tool for
bioinformaticians.

**GRNScope** is a website that wraps BEELINE. It handles the parts that
normally require a terminal and a bioinformatics background:

- file validation and helpful error messages instead of stack traces
- automatic detection of whether your matrix is raw counts or already normalized
- preprocessing and gene selection
- running many algorithms in parallel and tracking their progress
- **repeating each algorithm on resampled data to measure how stable its
  predictions are** — this is GRNScope's main addition on top of BEELINE
- combining several algorithms into a single consensus network
- interactive visualisation, benchmarking, and export

The BEELINE code itself lives alongside the web app in the `Beeline/` directory
of this project and is invoked as a subprocess.

## 1.3 Vocabulary

You will meet these terms throughout the interface. They are worth reading once.

**Edge.** A predicted regulatory link between two genes, written
`source → target`. Also called a "link" or "interaction".

**Source / regulator.** The gene doing the regulating (often a transcription
factor). **Target.** The gene being regulated.

**Directed vs undirected.** A *directed* method predicts `A → B` as different
from `B → A`. An *undirected* method only says "A and B are related" and cannot
tell you which one is upstream. Correlation-based methods are undirected by
nature.

**Signed vs unsigned.** A *signed* method predicts whether the influence is
**activation** (the regulator increases the target) or **repression** (it
decreases it). An *unsigned* method only reports that a relationship exists.

**Transcription factor (TF).** A protein that binds DNA to control
transcription. GRNScope ships curated TF lists per species and can prioritise
these genes during gene selection, because a true regulator is far more likely
to be a TF than a random gene.

**Pseudotime.** Single-cell experiments capture a snapshot, but if your cells
are caught partway through a process such as differentiation, you can order them
along an inferred progression. That ordering is *pseudotime*: a number per cell
saying "this cell is early" or "this cell is late". Several algorithms need it
because they model regulation as a process unfolding over time. Pseudotime is
inferred, not measured — a poor pseudotime produces poor networks.

**Trajectory / lineage.** One path through pseudotime. A differentiating
population that splits into two fates has two trajectories, and a cell belongs
to one branch or the other. This is why a pseudotime file may have several
columns with blanks in them.

**Cluster.** A group of cells of the same type or state, usually from
clustering upstream. If you upload cluster labels, GRNScope can build a separate
network per cluster in addition to the global one.

**Scope.** GRNScope's internal word for "which set of cells this network was
built from" — either `global` (all cells) or one cluster.

**Bootstrap resample.** A copy of your dataset made by drawing cells at random
*with replacement* until you have as many cells as you started with. Some cells
appear twice, some not at all. Rerunning an algorithm on many such resamples
shows you which predictions are robust and which were driven by a handful of
cells. See [the metrics reference](06-metrics.md#62-the-bootstrap-idea).

**Ground truth / reference network.** A list of regulatory interactions already
believed to be true, from a database or a curated study. Supplying one lets
GRNScope score how well each algorithm recovered known biology.

**Consensus network.** The merged network produced when you run several
algorithms, combining their evidence into one ranked edge list.

## 1.4 The life of an analysis

```
  Upload  ──▶  Validate  ──▶  Preprocess  ──▶  Run algorithms  ──▶  Aggregate  ──▶  Explore
    │             │               │                  │                   │             │
 expression   file format    normalize +      full-data fit +      Evidence,      network,
 matrix,      and content    gene selection   N bootstrap runs     Confidence,    comparison,
 optional     checks         (3 stages)       per algorithm,       consensus,     trajectory,
 extras                                       in Docker            benchmarks     perturbation
```

1. **Upload.** Your files go to a temporary staging area first. Nothing becomes
   a project until validation passes.
   ([`app/api/uploads.py`](../backend/app/api/uploads.py))
2. **Validate.** Structure and content are checked, and GRNScope guesses your
   matrix state (raw / normalized / log-normalized) and species so it can warn
   you if the settings look wrong. See [input data formats](03-input-data.md).
3. **Preprocess.** The matrix is put into the state the algorithms expect and
   optionally reduced to a manageable set of genes. See
   [preprocessing](04-preprocessing.md).
4. **Run.** Each selected algorithm runs once on the full data and then on a
   series of bootstrap resamples, each inside its own Docker container. Fast
   algorithms are scheduled first so you get early results. See
   [the algorithm catalog](05-algorithms.md).
5. **Aggregate.** Per-edge Evidence, Stability, Confidence and intervals are
   computed, then merged across methods into the consensus. See
   [metrics](06-metrics.md).
6. **Explore.** Five result views, all exportable. See
   [reading your results](07-results-guide.md).

## 1.5 Projects, accounts, and privacy

**There are no user accounts.** The `Login` and `Register` links redirect
straight to the project list. Instead, your browser is given a long-lived
identifier cookie named `grnscope_client_id`, and every project records the
identifier that created it
([`app/api/client_identity.py`](../backend/app/api/client_identity.py)). The
backend refuses to show or delete a project belonging to a different client.

Practical consequences you should know before you rely on it:

- Your projects are tied to **that browser on that machine**. A different
  browser, a different computer, or a cleared cookie store means you will not
  see them.
- There is no password protecting them either. Anyone with that cookie has your
  projects.
- You can attach a **notification email** to a project so you are told when the
  run finishes. That email is used only for notification; it does not create an
  account or a way back into the project.

If long-term access matters, download your results when the run completes — see
[the downloads section](07-results-guide.md#79-downloads).

## 1.6 Limits and expectations

| Limit | Value | Where it comes from |
| --- | --- | --- |
| Maximum size per uploaded file | 500 MB | `MAX_FILE_SIZE_BYTES`, [`app/validators.py`](../backend/app/validators.py) |
| Accepted file type | `.csv` only (comma, tab, or semicolon separated) | `validate_csv_extension` |
| Staged uploads expire after | 24 hours by default | `GRNSCOPE_TEMP_UPLOAD_TTL_SECONDS` |
| Bootstrap runs per algorithm | 3 to 15, chosen automatically | `DEFAULT_CONFIDENCE_MIN_RUNS` / `MAX_RUNS` |
| Edges kept per target gene | 20 by default, adjustable | "Maximum edges per target" setting |
| Minimum cells for a per-cluster network | 50 | `MIN_CLUSTER_SCOPE_CELLS`, [`app/services/job_service.py`](../backend/app/services/job_service.py) |

**Runtime is the thing that surprises people most.** GRN inference is expensive.
Several methods evaluate every gene pair or every gene triplet, so the cost
grows quadratically or cubically with gene count. A 500-gene analysis with three
algorithms may take tens of minutes; the same analysis with 5,000 genes and a
slow method such as SINGE can take many hours. Every algorithm is additionally
run 4 to 16 times in total (one full-data fit plus the bootstraps), which is the
price of getting confidence estimates. This is why gene selection matters and
why the defaults are conservative.

## 1.7 Technical architecture in brief

You do not need this section to use GRNScope, but it helps when reading the
troubleshooting guide.

- **Frontend** — Next.js 16 / React 19 with Tailwind, in `frontend/`. Network
  drawing uses Cytoscape. Consensus and benchmark metrics are computed in the
  browser so that changing a slider is instant.
- **Backend** — FastAPI in `backend/app`, entry point
  [`app/main.py`](../backend/app/main.py). Everything is stored as plain files
  on disk under `backend/projects/<project-id>/`; there is no database. The
  layout is documented in
  [`backend/PROJECT_FOLDER_STRUCTURE.md`](../backend/PROJECT_FOLDER_STRUCTURE.md).
- **Execution** — [`beeline_service.py`](../backend/app/services/beeline_service.py)
  writes a BEELINE `config.yaml` and invokes `BLRunner.py` as a subprocess,
  which in turn launches the per-algorithm Docker image. Work is dispatched
  either by an in-process thread pool or by Redis/RQ workers
  ([`app/services/worker_queue.py`](../backend/app/services/worker_queue.py)).
- **Where each metric is computed** — per-algorithm bootstrap statistics in the
  backend; consensus, method-agreement, and benchmark statistics in the browser.
  This split is worth remembering when you compare a downloaded CSV against what
  the screen shows.

---

Next: [2. Quickstart →](02-quickstart.md)
