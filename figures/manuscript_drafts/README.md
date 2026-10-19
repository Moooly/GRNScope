# Four GRNScope figure drafts

These are visual drafts to review **before manuscript writing**. Figures 1–3 use
completed project `3ac71f2c61bd` (19 genes, 2,000 cells, 13 methods). Figure 4
is a comparison-design preview with no result values.

Each figure is supplied as PDF, SVG, PNG and 600-dpi TIFF. `make_figures.py`
regenerates the set from the saved project output. CSV files alongside the
figures contain the plotted numbers for Figures 2 and 3.

## Draft legends

**Fig. 1 | GRNScope analysis workflow.** A validated expression matrix and
pseudotime enter preprocessing, 13 inference methods, repeat-run confidence
analysis, and a consensus-and-interpretation stage. Counts describe this case
study. All 13 methods completed; the project contains no ground-truth network.
The 3–7 bootstrap runs per method are completed runs under automatic early
stopping, with a configured cap of 50.

**Fig. 2 | Method-level interpretation of a candidate interaction.** The saved
rank position for WNT4 → RSPO1 (blue) and RSPO1 → WNT4 (orange) is shown for each
method. The shaded region marks the top 50 positions. Right-hand percentages
are the recorded bootstrap confidence for WNT4 → RSPO1. CellOracle did not
report this pair. Some methods do not resolve regulatory direction and may list
both orientations; the plot therefore does not establish causality or direction.
Bootstrap counts vary by method, so a 100% value should not be read as certainty.

**Fig. 3 | Shared adjacencies amid method variation.** **a**, the 12 most
frequently shared unordered gene pairs among each method's first 50 unique
adjacencies; line width represents the number of methods. This is a display
subset, not GRNScope's full consensus network. **b**, median pairwise Spearman
correlation of bootstrap-run rankings for each method; horizontal lines span
the minimum to maximum pairwise value. **c**, pairwise Jaccard similarity of
the same top-50 unordered adjacency sets. CellOracle reported only 14 edges,
so its set has 14 adjacencies. The panel compares output consistency and
overlap, not biological accuracy.

**Fig. 4 | Planned Beeline comparison.** Schematic of a matched-input,
matched-method comparison, with reserved panels for edge-rank concordance,
top-edge overlap and runtime. No independent comparison results are available,
so this is a design preview only. Replace it with data before using it as a
manuscript results figure.

## Figure-level claims and limits

| Figure | Evidence role | Claim it can support | Key limit |
| --- | --- | --- | --- |
| 1 | Workflow schematic | The application connects input validation to multi-method network interpretation | Describes design, not performance |
| 2 | Representative interaction | Method rankings and bootstrap confidence can be inspected edge by edge | Direction is ambiguous for undirected methods |
| 3 | Quantitative case study | Methods differ in stability and share selected adjacencies | One 19-gene dataset; no ground truth |
| 4 | Validation plan | Specifies the paired comparison needed next | No results are plotted |

## Data selection and reproducibility

- Figure 2 uses every method's saved ranked-edge file. Missing candidate edges
  are shown as not reported; no method is silently removed.
- Figure 3 includes all 13 methods. The display network intentionally selects
  12 unordered pairs by highest support among each method's first 50 unique
  adjacencies. The stability panel and agreement matrix include all methods.
- No rows were removed because of an inconvenient score. Raw edge weights are
  deliberately absent from Figure 2 because their scales differ by algorithm.
- Pairwise Spearman values and bootstrap-run counts come from the saved
  confidence summaries. No uncertainty interval was invented. The range in
  Figure 3b is the observed minimum–maximum pairwise rho, not a confidence
  interval.
- Figure 4 uses no simulated or fabricated measurements.

## QA

The Python source passed the static figure preflight. The exported PDFs passed
the 5-point glyph floor, panel-alignment gate and rendered collision audit.
Each figure was visually inspected at final size. The Figure 3 alignment gate
passed for the spanning network panel and the two quantitative panels.
