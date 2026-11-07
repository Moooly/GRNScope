GRNScope sample dataset
=======================

Inputs from the completed 19-gene, 2,000-cell demo project (13 methods).
Species: human. Matrix values: log-normalized. Detection filter: 10%.

ExpressionData.csv: exact original uploaded expression matrix (genes as rows).
PseudoTime.csv: canonical Slingshot pseudotime used by the analysis; cell IDs
match the expression columns. It contains two trajectory columns; NA means
that a cell is not assigned to that trajectory.
GroundTruthNetwork.csv: the project's uploaded reference network, with
Gene1, Gene2 and Type (+/-) columns.

These files are analysis inputs; rerunning methods may produce different
results. The demo preserves the actual archived outputs and bootstrap counts.
