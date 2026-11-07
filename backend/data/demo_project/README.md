# Completed-project demo

This read-only demo comes from `ExpressionData_run-manifests-4.zip`, exported on November 7, 2026. Its source project is `eb163264f98e`; the archive SHA-256 is recorded in `manifest.json`.

It contains 19 human genes, 2,000 cells and 13 completed methods. The original expression matrix was declared log-normalized. Detection filtering at 10% retained all 19 genes. Pseudotime was estimated with Slingshot; both lineage columns, the saved cell embedding and lineage curves are bundled. The uploaded reference contains 79 interactions, of which 76 connect genes in the expression matrix.

| Method | Completed bootstrap runs |
| --- | ---: |
| CELLORACLE | 3 |
| GENIE3 | 3 |
| GRISLI | 5 |
| GRNBOOST2 | 3 |
| GRNVBEM | 5 |
| LEAP | 3 |
| PEARSON | 3 |
| PIDC | 3 |
| PPCOR | 5 |
| SCODE | 6 |
| SCRIBE | 6 |
| SINCERITIES | 6 |
| SINGE | 4 |

SINGE's last two runs are valid empty networks. All four runs count toward confidence; only the two nonempty networks support pairwise rank stability. Planned runs that were skipped are preserved as skipped timing records, not counted as completed runs. Early-stop status comes from those records; unavailable convergence traces are not invented.

`results/<METHOD>/rankedEdges.csv` and `runs/*/rankedEdges.csv` preserve archived CSV bytes. The importer verifies their checksums, reconstructs confidence summaries with the production aggregation code, and checks them against the archived combined results. Pairwise stability is recomputed from the individual archived networks. Original run manifests are retained for provenance; their source-directory references describe the original execution, rather than executable local paths. Runner images, logs and code are not required to load the demo.

To rebuild from the archive, run from the repository root:

```sh
backend/.venv/bin/python backend/scripts/import_demo_project.py /path/to/ExpressionData_run-manifests-4.zip
```

The importer also updates `frontend/public/samples/` so sample downloads match the demo inputs. It removes obsolete inputs, method results, bootstrap runs and legacy local execution files from the managed demo directory. Algorithm outputs are never rerun during import.

## Precomputed perturbation examples

Six real CellOracle simulations are bundled under `perturbations/`: knockout and overexpression of FOXL2, NR5A1 and NR0B1, the three regulators with the most outgoing archived CellOracle edges. These were computed with the local CellOracle Docker runtime using the imported server project's expression, pseudotime and network, rather than supplied by the original inference export. The manifest records timestamps, simulation settings and checksums tying each package to the exact demo inputs. Overexpression targets use the larger of the observed maximum and twice the mean, capped by the model's safe upper limit.

Visitors can browse the saved results and download CSVs. New runs, reruns and pseudotime estimation remain unavailable in the read-only demo. Regular projects retain their normal simulation controls.

To recompute the examples with the configured CellOracle image and Docker running:

```sh
backend/.venv/bin/python backend/scripts/precompute_demo_perturbations.py
```

An isolated, ignored project stores the simulation model and runtime files. Only completed result JSON and CSV exports are copied into the demo. The viewer rejects examples whose input fingerprints no longer match after a demo replacement.
