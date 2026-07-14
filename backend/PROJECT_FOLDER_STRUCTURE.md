# Project folder structure

Each analysis project lives under `backend/projects/<project-id>/`.

```text
<project-id>/
├── project.json                 # Project configuration and input paths
├── metadata.json                # Downloadable analysis metadata
├── jobs.json                    # Job and per-algorithm status
├── expression__*.csv            # Uploaded expression matrix
├── pseudotime__*.csv            # Optional uploaded pseudotime
├── preprocessed/                # Shared normalized inputs
├── results/                     # Successful algorithm outputs
│   └── <ALGORITHM>/
│       ├── result.json
│       ├── rankedEdges.csv
│       ├── runs/                # Per-bootstrap ranked edges
│       └── logs/                # Successful-run logs and provenance
├── diagnostics/                 # Failed-attempt diagnostics
│   └── <ALGORITHM>/
│       ├── latest.json          # Pointer to the newest failure
│       └── <job-id>/
│           └── attempt-<UTC timestamp>/
│               ├── error.json  # Error summary, timing, traceback, file index
│               └── runtime/
│                   └── <scope>/
│                       ├── config.yaml
│                       ├── run_timings.json
│                       ├── stdout.log
│                       ├── stderr.log
│                       └── outputs/  # BEELINE output.txt, time*.txt, and *.log only
└── _beeline_runtime/            # Temporary; present only while work is running
```

## Debugging a failed algorithm

1. Open `diagnostics/<ALGORITHM>/latest.json` to locate the newest attempt.
2. Read that attempt's `error.json` first. It contains the user-facing error,
   error type, timestamps, traceback, runtime scopes, and an index of copied files.
3. Check `stderr.log`, then `stdout.log`.
4. If Docker or an algorithm wrapper failed, inspect the preserved `output.txt`
   or `time*.txt` file under `runtime/<scope>/outputs/`.

Input matrices and generated ranked-edge CSVs are not duplicated in failure
diagnostics. This keeps diagnostic bundles small while preserving the files that
normally explain a failure. Each rerun receives a new attempt directory, so an
older failure is not overwritten.
