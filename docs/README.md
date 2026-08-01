# GRNScope documentation

GRNScope is a web application for inferring **gene regulatory networks (GRNs)**
from single-cell gene expression data. You upload an expression matrix, choose
one or more inference algorithms from the
[BEELINE](https://github.com/murali-group/Beeline) benchmark suite, and
GRNScope runs them for you, scores how trustworthy each predicted regulatory
link is, and presents the result as an interactive network.

This documentation is written for biologists. It assumes you know what
single-cell RNA sequencing is, but it does **not** assume you have worked with
network inference, pseudotime, or bootstrap statistics before. Every metric is
explained in plain language first and with its exact formula second.

## Where to start

| If you want to… | Read |
| --- | --- |
| Understand what the tool does and the words it uses | [1. Overview and concepts](01-overview.md) |
| Run your first analysis today | [2. Quickstart](02-quickstart.md) |
| Prepare your files correctly | [3. Input data formats](03-input-data.md) |
| Know what happens to your matrix before the algorithms see it | [4. Preprocessing and gene selection](04-preprocessing.md) |
| Choose which algorithms to run | [5. Algorithm catalog](05-algorithms.md) |
| Understand Evidence, Confidence, Support, AUPRC, and every other number | [6. Metrics reference](06-metrics.md) |
| Interpret the results screens | [7. Reading your results](07-results-guide.md) |
| Fix an error or a failed run | [8. Troubleshooting and FAQ](08-troubleshooting.md) |
| Deploy or operate the service | [9. Operations and deployment](09-operations.md) |

## The one-paragraph summary

You upload a gene-by-cell expression matrix. GRNScope cleans it, optionally
reduces it to the most informative genes, then runs your chosen algorithms
inside isolated Docker containers. Each algorithm is run once on your complete
data and then repeatedly on **bootstrap resamples** of your cells. Links that
keep reappearing across resamples get a high **Confidence**; links that appear
once and vanish do not. When you run several algorithms, GRNScope combines them
into a **consensus network** that reports how many methods agree, which
direction they favour, and whether the interaction looks activating or
repressing. If you supply a known reference network, GRNScope also benchmarks
each method against it using the standard BEELINE metrics.

## A note on what these results mean

Every algorithm here infers **statistical association or predictability**
between genes, not experimentally verified regulation. A high-confidence edge
means "several methods repeatedly rank gene A among the strongest predictors of
gene B". It is a hypothesis worth testing at the bench, not a proven regulatory
interaction. This caveat is repeated in the metrics documentation because it is
the single most common misreading of GRN inference output.

## Source of truth

This documentation describes the behaviour implemented in this repository.
Where a number or rule matters, the relevant source file is cited so you can
verify it, for example
[`backend/app/services/beeline_service.py`](../backend/app/services/beeline_service.py).
If the code and these documents ever disagree, the code is correct and the
document needs updating.
