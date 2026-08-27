GRNScope sample dataset
=======================

These are the input files used by the completed GRNScope demo.

ExpressionData.csv
  Required expression matrix with genes as rows and cells as columns.
  This sample contains 19 genes and 2,000 cells.

PseudoTime.csv
  Optional pseudotime input with one row per cell and two trajectory columns.
  Cell IDs match the columns in ExpressionData.csv.

GroundTruthNetwork.csv
  Optional reference network with regulator (Gene1), target (Gene2), and
  regulatory type (Type) columns.

Cluster labels and a custom TF list are not part of this demo dataset.
