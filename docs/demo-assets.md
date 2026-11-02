# Bundled data and generated files

The read-only project at `/projects/demo` is a fixture shipped with the repository. It loads without a BEELINE checkout, Docker, Redis, or a prior analysis run.

## What Git keeps

| Path | Purpose |
| --- | --- |
| `backend/data/demo_project/manifest.json` | Demo description, input names, and the twelve methods |
| `backend/data/demo_project/inputs/` | Expression matrix, pseudotime, and illustrative reference network |
| `backend/data/demo_project/results/*.json` | Saved network results and precomputed repeat-run stability |
| `backend/data/demo_project/results/<method>/rankedEdges.csv` | The downloadable ranked edges for each method |
| `backend/data/tf_gene_names/`, `known_tf_gene_names.txt`, `gene_coordinates.csv`, `gencode_reference/` | Static references used by inference or visualization |

The demo result values are the captured outputs of the original BEELINE example. The per-run ranked-edge files were used to compute each saved stability summary; those summaries and the final ranked-edge CSVs are bundled so the UI and downloads work from a fresh checkout. The reference network is illustrative, as described in the demo manifest.

## What Git excludes

`backend/data/demo_project/_beeline_runtime/` is execution scratch space. It formerly held more than 5,400 tracked files and about 404 MB of repeated run inputs and outputs. A fresh checkout does not need it to load the demo. Existing local copies are left on disk but ignored by Git.

`backend/data/uploads/` and `backend/data/converted_uploads/` are local upload and conversion output. They are also ignored; existing local files were left in place when removed from version control. Active user projects live in the already ignored `backend/projects/` directory.

The other files in `backend/data/`, including the SCODE and CellOracle sample inputs, remain tracked. They are not required by `/projects/demo`; they are kept as separate reference or sample data rather than treated as generated runtime output.

## Check the bundled demo

After installing dependencies and building the frontend, run `bash scripts/smoke-demo.sh` from the repository root while ports 8000 and 3000 are free. The script starts both services, opens the demo route, checks the proxied project and result endpoints, and stops its processes. The same check runs in CI after `bash scripts/check.sh`.

To use different ports, build with `NEXT_INTERNAL_API_PROXY_TARGET` set to the backend address, then set `GRNSCOPE_SMOKE_BACKEND_PORT` and `GRNSCOPE_SMOKE_FRONTEND_PORT` when running the smoke script. Next.js stores the proxy rewrite in the build, so changing only the smoke script's backend port is insufficient.

Human and mouse Circos coordinate references are bundled under
`backend/data/gencode_reference/`. See [Circos species](circos-species.md) for
assemblies, provenance, and regeneration instructions.
