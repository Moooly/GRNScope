#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_python="${GRNSCOPE_CHECK_PYTHON:-}"
if [[ -z "$backend_python" ]]; then
  if [[ -x "$repo_root/backend/.venv/bin/python" ]]; then
    backend_python="$repo_root/backend/.venv/bin/python"
  else
    backend_python="python3"
  fi
fi

(cd "$repo_root/frontend" && npm run check)
(cd "$repo_root/backend" && "$backend_python" -m pytest -q)
