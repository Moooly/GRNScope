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
backend_port="${GRNSCOPE_SMOKE_BACKEND_PORT:-8000}"
frontend_port="${GRNSCOPE_SMOKE_FRONTEND_PORT:-3000}"
smoke_dir="$(mktemp -d)"
backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$frontend_pid" ]]; then wait "$frontend_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then wait "$backend_pid" 2>/dev/null || true; fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

"$backend_python" - "$backend_port" "$frontend_port" <<'PY'
import socket
import sys

for port in map(int, sys.argv[1:]):
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as exc:
            raise SystemExit(f"Port {port} must be free for the demo smoke check: {exc}")
PY

wait_for_url() {
  local url="$1"
  local output="$2"
  for _attempt in {1..40}; do
    if curl --silent --show-error --fail "$url" -o "$output" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  cat "$smoke_dir/backend.log" "$smoke_dir/frontend.log" >&2
  printf 'Demo smoke check timed out: %s\n' "$url" >&2
  return 1
}

(cd "$repo_root/backend" && exec "$backend_python" -m uvicorn app.main:app --host 127.0.0.1 --port "$backend_port") >"$smoke_dir/backend.log" 2>&1 &
backend_pid=$!
wait_for_url "http://127.0.0.1:$backend_port/api/projects/demo" "$smoke_dir/project.json"

(cd "$repo_root/frontend" && exec ./node_modules/.bin/next start --hostname 127.0.0.1 --port "$frontend_port") >"$smoke_dir/frontend.log" 2>&1 &
frontend_pid=$!
wait_for_url "http://127.0.0.1:$frontend_port/projects/demo" "$smoke_dir/page.html"
wait_for_url "http://127.0.0.1:$frontend_port/api/projects/demo" "$smoke_dir/proxy-project.json"
wait_for_url "http://127.0.0.1:$frontend_port/api/projects/demo/results" "$smoke_dir/results.json"
wait_for_url "http://127.0.0.1:$frontend_port/api/projects/demo/results/PIDC" "$smoke_dir/pidc.json"

"$backend_python" - "$smoke_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
project = json.loads((root / "proxy-project.json").read_text())
results = json.loads((root / "results.json").read_text())
pidc = json.loads((root / "pidc.json").read_text())
assert project["project"]["project_id"] == "demo"
assert len(results["results"]) == 13
assert pidc["result"]["top_edges"]
print("Demo route, proxy, result list, and PIDC result are available.")
PY
