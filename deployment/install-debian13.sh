#!/usr/bin/env bash
# Fresh Debian 13 amd64 installation. Run as the normal SSH user, without sudo.
set -Eeuo pipefail
bundle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == --help ]]; then
    echo 'Usage: bash install-debian13.sh'
    echo 'Installs dependencies, builds images, and starts GRNScope on 127.0.0.1:3000.'
    echo 'Requires Debian 13 amd64, a normal user with sudo, and internet access.'
    exit 0
fi
if [[ $# -gt 0 ]]; then echo 'Unknown option. Use --help.' >&2; exit 1; fi
if [[ $(id -u) == 0 ]]; then
    echo 'Run this as your normal SSH user: bash install-debian13.sh (without sudo).' >&2
    exit 1
fi
if [[ "$bundle_root" =~ [[:space:]] ]]; then
    echo 'Extract the bundle to a path without spaces, such as your home directory.' >&2
    exit 1
fi
if [[ ! -f /etc/os-release ]]; then echo 'Debian 13 is required.' >&2; exit 1; fi
source /etc/os-release
if [[ "$ID" != debian || "$VERSION_ID" != 13 ]]; then
    echo 'This installer supports Debian 13 only.' >&2; exit 1
fi
if [[ $(dpkg --print-architecture) != amd64 ]]; then
    echo 'This bundle requires an x86-64 (amd64) VM for the algorithm images.' >&2; exit 1
fi
app_user="$(id -un)"
backend_root="$bundle_root/GRNScope/backend"
frontend_root="$bundle_root/GRNScope/frontend"
beeline_root="$bundle_root/Beeline"
for required in "$backend_root/requirements.txt" "$frontend_root/package-lock.json" "$beeline_root/utils/initialize.sh"; do
    [[ -f "$required" ]] || { echo "Missing bundled file: $required" >&2; exit 1; }
done
log_path="$bundle_root/install.log"
exec > >(tee -a "$log_path") 2>&1
trap 'result=$?; echo "Installation stopped at line $LINENO (exit $result). See $log_path. Fix the error and rerun the installer."; exit "$result"' ERR
sudo -v
printf 'Installing under %s as %s\n' "$bundle_root" "$app_user"
free -h
df -h "$bundle_root"

# Debian packages and Docker's official Debian repository.
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl git xz-utils python3 python3-venv python3-dev \
    build-essential libgomp1 redis-server
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'SOURCES'
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker redis-server
sudo usermod -aG docker "$app_user"
sudo -u "$app_user" -g docker -- docker info >/dev/null

# Fetch an official Node 22 build and verify it against its published checksum.
node_tmp="$(mktemp -d)"
trap 'rm -rf "$node_tmp"' EXIT
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$node_tmp/SHASUMS256.txt"
node_archive="$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$node_tmp/SHASUMS256.txt")"
[[ -n "$node_archive" && "$node_archive" != *$'\n'* ]] || { echo 'Could not identify Node 22 archive.'; exit 1; }
curl -fSL "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$node_tmp/$node_archive"
(cd "$node_tmp" && awk -v file="$node_archive" '$2 == file' SHASUMS256.txt | sha256sum --check -)
sudo mkdir -p /opt/grnscope-node
sudo tar -xJf "$node_tmp/$node_archive" -C /opt/grnscope-node --strip-components=1 --no-same-owner
export PATH="/opt/grnscope-node/bin:$PATH"
node --version
npm --version

# The website's Python environment also runs BLRunner. Do not install the old
# BEELINE Python 3.7/R conda environment for this GRNScope deployment.
python3 -m venv "$backend_root/.venv"
"$backend_root/.venv/bin/python" -m pip install --upgrade pip
"$backend_root/.venv/bin/python" -m pip install -r "$backend_root/requirements.txt"
"$backend_root/.venv/bin/python" "$beeline_root/BLRunner.py" --help >/dev/null

# Stop our own services if rerunning after an interrupted installation.
for unit in grnscope-frontend grnscope-worker grnscope-backend; do
    if sudo systemctl is-active --quiet "$unit"; then sudo systemctl stop "$unit"; fi
done
(cd "$frontend_root" && npm ci && NEXT_INTERNAL_API_PROXY_TARGET=http://127.0.0.1:8000 npm run build)

# Same builder checked in this workspace: 7 published + 5 custom images.
sudo -u "$app_user" -g docker -- bash "$beeline_root/utils/initialize.sh"

# Exercise the production frontend and API before installing the services.
(cd "$bundle_root/GRNScope" && bash scripts/smoke-demo.sh)

sudo install -m 0755 -d /etc/grnscope
sudo tee /etc/grnscope/runtime.env >/dev/null <<ENV
BEELINE_ROOT=$beeline_root
BEELINE_PYTHON=$backend_root/.venv/bin/python
GRNSCOPE_QUEUE_BACKEND=redis
GRNSCOPE_REDIS_URL=redis://127.0.0.1:6379/0
GRNSCOPE_WORKER_QUEUE=grnscope
GRNSCOPE_WORKER_COUNT=2
GRNSCOPE_MAX_CONCURRENT_ALGORITHMS=2
ENV
sudo chmod 600 /etc/grnscope/runtime.env

sudo tee /etc/systemd/system/grnscope-backend.service >/dev/null <<UNIT
[Unit]
Description=GRNScope backend
After=network.target docker.service redis-server.service
Requires=docker.service redis-server.service
[Service]
User=$app_user
SupplementaryGroups=docker
WorkingDirectory=$backend_root
EnvironmentFile=/etc/grnscope/runtime.env
ExecStart=$backend_root/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/grnscope-worker.service >/dev/null <<UNIT
[Unit]
Description=GRNScope analysis workers
After=network.target docker.service redis-server.service
Requires=docker.service redis-server.service
[Service]
User=$app_user
SupplementaryGroups=docker
WorkingDirectory=$backend_root
EnvironmentFile=/etc/grnscope/runtime.env
ExecStart=$backend_root/.venv/bin/python worker.py
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/grnscope-frontend.service >/dev/null <<UNIT
[Unit]
Description=GRNScope production frontend
After=network.target grnscope-backend.service
[Service]
User=$app_user
WorkingDirectory=$frontend_root
Environment=NODE_ENV=production
ExecStart=/opt/grnscope-node/bin/node $frontend_root/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now grnscope-backend grnscope-worker grnscope-frontend

ready=false
for attempt in {1..60}; do
    if curl -fsS http://127.0.0.1:3000/api/projects/demo -o /dev/null; then
        ready=true
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    sudo journalctl -u grnscope-backend -u grnscope-frontend -n 60 --no-pager
    echo 'Website readiness check failed.' >&2
    exit 1
fi
for unit in grnscope-backend grnscope-worker grnscope-frontend; do
    sudo systemctl is-active --quiet "$unit"
done
printf '\nGRNScope is running at http://127.0.0.1:3000 on the VM.\n'
printf 'Two analysis worker processes are configured; verify memory fits your datasets.\n'
printf 'Use an SSH tunnel to open the site on your own computer (see README.md).\n'
printf 'Keep this folder in place: it contains the installed application and projects.\n'
printf 'Installation log: %s\n' "$log_path"
