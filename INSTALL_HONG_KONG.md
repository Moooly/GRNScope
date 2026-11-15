# GRNScope installation guide for the Hong Kong server

Prepared for the 620b server team | 4 November 2026

This guide installs GRNScope alongside the server's existing projects. It uses the supplied GRNScope and modified Beeline code, the existing Node.js and Conda installations, and Apache for HTTPS. Run application commands as the `platform` user. An administrator handles Docker access, service permissions, and the Apache website configuration.

The installation sequence is: place both code folders, generate settings, check prerequisites, install, start services, and connect Apache. The new `configure-hk` command supplies the server paths from the environment note; normally only the final website address needs to be entered.

**Validation status:** the configuration and installer changes passed 49 local deployment tests. Installation, Docker image builds, and real analyses still need to be tested on the Hong Kong server. This guide applies to the updated code supplied with it.

## 1 Before starting

### What will run

GRNScope has a Next.js website, a FastAPI backend served by Uvicorn, Redis for the job queue, and Python workers that run analyses using the modified Beeline code and Docker containers. Projects and results are stored as files. There is no PostgreSQL database creation or Django migration step.

| Component | Configuration for this installation |
| --- | --- |
| Operating system | Ubuntu 20.04 x86_64, as reported by the server team |
| Application account | platform |
| Website code | /home/platform/project/GRNScope |
| Analysis code | /home/platform/project/Beeline |
| Application data | /data2/platform/grnscope |
| Conda executable | /apps/software/Miniconda3/4.9.2/bin/conda |
| Node executable directory | /home/platform/.nvm/versions/node/v20.18.0/bin |
| Internal ports | 13000 website; 18000 API; 16379 Redis |

The code locations above are proposed project folders, not paths confirmed to exist. Both code folders must have paths without spaces. The data folder must be empty or absent for a first installation, and `/data2` must be mounted.

### Administrator preparation

Confirm that `platform` can write to the project and data locations and use the local Docker engine. Docker must also start after reboot. Reserve the three internal ports and the `grnscope` service name prefix. Confirm free space on both `/data2` and Docker's image storage; the installer reports locations but does not enforce a minimum free-space threshold.

Provide a dedicated hostname and HTTPS certificate, for example `https://grnscope.institute.edu`. Replace this example with the real address throughout this guide. A subpath such as `https://institute.edu/grnscope` is unsupported. Allow installation downloads from Conda/Python/npm repositories, container registries, GitHub, and the upstream sources used by the algorithm Dockerfiles.

The application uses browser identifiers for project ownership and does not provide account-based authentication. Configure any required institutional access restrictions at Apache before opening access. Only Apache needs public access; the three application ports bind to `127.0.0.1`.

## 2 Place the code and generate settings

### Place both supplied folders

Extract or copy the supplied release so that these files exist:

```text
/home/platform/project/GRNScope/scripts/server.py
/home/platform/project/GRNScope/backend/requirements.txt
/home/platform/project/GRNScope/frontend/package-lock.json
/home/platform/project/Beeline/BLRunner.py
/home/platform/project/Beeline/utils/initialize.sh
```

Use the supplied modified Beeline folder. Keep the entire source and reference-data folders, including `backend/data`, `frontend/public`, and `frontend/tooling`. A source archive is supported; `.git` directories are optional. If Git metadata is absent, the installation record explicitly marks the source revision as unknown. Keep the original release archive and its checksum for traceability.

Do not copy local Python environments, `node_modules`, frontend builds, existing user projects, or a development `workspace` link into this fresh installation. The installer creates the server-specific environment and storage links itself.

### Create the configuration

Log in as `platform` and run:

```bash
cd /home/platform/project/GRNScope
python3 scripts/server.py configure-hk \
  --public-url https://grnscope.institute.edu
```

This creates `server.env` and prints its contents. It does not install software or start services. Check that the hostname is correct and that the generated paths match the server. The settings are:

```ini
DATA_ROOT=/data2/platform/grnscope
DATA_MOUNT=/data2
PUBLIC_URL=https://grnscope.institute.edu
CONDA_EXE=/apps/software/Miniconda3/4.9.2/bin/conda
NODE_BIN=/home/platform/.nvm/versions/node/v20.18.0/bin
BEELINE_ROOT=/home/platform/project/Beeline
```

`BEELINE_ROOT` is generated from the GRNScope folder's parent directory. If either code folder is placed elsewhere, edit `server.env` accordingly. The explicit `DATA_MOUNT` prevents installation onto the system disk when `/data2` is missing. Existing configuration files are never overwritten; edit one directly instead of running `configure-hk` again.

### Check prerequisites

```bash
python3 --version
docker info
python3 scripts/server.py check
```

The bootstrap Python must be at least 3.8. The installer checks Node.js is at least 20.9; the reported Node.js 20.18.0 meets that check. It also checks executable paths, Beeline files, the data mount, permissions, local Docker access, port conflicts, and resource settings. Success ends with `Environment checks passed.` Resolve any reported error before proceeding.

## 3 Install and start GRNScope

### Install the application

From the GRNScope folder, run as `platform`:

```bash
python3 scripts/server.py install
```

Use the team's usual persistent terminal session for this step. Keep its output if installation fails. The first run downloads packages and prepares large Docker images; its duration depends on network access and build caching.

The installer creates an isolated Python 3.11 environment with Redis 7 under the data folder, installs backend packages, builds the production website, pulls seven published algorithm images, and builds five custom images including CellOracle and Slingshot. It then writes four service definitions and an Apache proxy snippet. Existing shared Conda and Node defaults are not upgraded.

On the reported 128-thread server, automatic starting limits are two concurrent algorithm jobs, four CPUs per job, and 8192 MiB of memory per job. These are algorithm limits, not a total application memory cap. Larger datasets may need adjusted limits agreed with the server administrator.

Success ends with `Installation prepared.` If a step fails, fix the cause and rerun `install`. A failed run can leave reusable packages and image layers. Once services are running, stop GRNScope before rebuilding.

### Start the four services

```bash
python3 scripts/server.py enable
```

This invokes `sudo` for service registration and startup, enables startup after reboot, and runs readiness checks. Continue to run the script as `platform`, not as root. The services are `grnscope-redis`, `grnscope-backend`, `grnscope-worker`, and `grnscope-frontend`.

If `platform` has no suitable sudo rights, an administrator can run the following after `install` completes, then `platform` runs `verify`:

```bash
sudo install -m 0644 \
  /data2/platform/grnscope/config/systemd/grnscope-*.service \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  grnscope-redis grnscope-backend grnscope-worker grnscope-frontend
```

```bash
python3 scripts/server.py verify
```

Expected result: `Website, API, demo results, Redis and analysis workers are ready.` This checks internal readiness; it does not run a fresh analysis or test public HTTPS.

## 4 Connect the public website

### Apache configuration for the administrator

After installation, obtain the generated file:

```text
/data2/platform/grnscope/config/apache-proxy.conf
```

Insert its contents inside the dedicated GRNScope HTTPS VirtualHost. The administrator supplies `ServerName`, the certificate configuration, and any access restrictions. Ensure the `ssl`, `proxy`, `proxy_http`, and `headers` modules are available and enabled using the server's existing Apache management procedure.

The generated routing is:

```text
Browser -> Apache HTTPS -> Next.js on 127.0.0.1:13000
Next.js /api requests -> FastAPI on 127.0.0.1:18000
Backend and workers -> Redis on 127.0.0.1:16379
Workers -> local Docker algorithm containers
```

Use the generated snippet rather than adding a separate Apache `/api` mapping. Next.js already supplies the API routes. The snippet sets a 3600-second proxy timeout and removes Apache's request-body size limit for this VirtualHost; review those settings against the institution's upload policy.

Validate the Apache configuration and reload it using the server's usual command. For an installation managed through `apachectl`:

```bash
sudo apachectl configtest && sudo apachectl graceful
```

The configuration test must succeed before the reload. See the official [Apache reverse proxy guide](https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html) and [apachectl documentation](https://httpd.apache.org/docs/2.4/programs/apachectl.html).

### Browser check

Open the real public hostname and then `/projects/demo`. Confirm the HTTPS certificate is accepted, the homepage loads, and demo networks and result views appear.

If Apache is not ready yet, test privately from your own computer, replacing `SERVER_ADDRESS`:

```bash
ssh -N -L 13000:127.0.0.1:13000 platform@SERVER_ADDRESS
```

Keep that session open and visit `http://localhost:13000`. This tests the application through a tunnel; repeat the checks at the final HTTPS address when Apache is ready.

## 5 Complete the acceptance checks

The preloaded demo proves that stored results can be read. A successful installation also needs a fresh analysis to prove uploads, workers, Docker, and result generation work together.

1. Run `python3 scripts/server.py verify` and confirm it passes.
2. Open `/projects/demo` at the public HTTPS address and inspect its results.
3. Create a new project using the bundled sample expression matrix. The source file is `frontend/public/samples/sample_expression_matrix.csv`; its public URL is `/samples/sample_expression_matrix.csv`.
4. Run a small Pearson analysis and a GENIE3 analysis. Use the interface's matching matrix-state setting and ensure preprocessing retains genes. Confirm both finish and produce results. GENIE3 tests Docker execution; Pearson alone does not.
5. Select two methods together and confirm that work progresses with the configured concurrency. Stop a method while it is running, rerun it, and confirm it completes.
6. Download a result file and reopen the project in the same browser. Confirm the network and results remain available.
7. If CellOracle, perturbation analysis, or pseudotime generation will be offered, run a small supported example of each before handoff. Installing their images alone is not functional acceptance.
8. With no analyses running, restart GRNScope and repeat `verify`. Confirm the services are enabled for reboot; a full server reboot should follow the shared server's maintenance schedule.

Record the hostname, release identifier, installer/date, checks passed, and any failures in the team's deployment record. Support-email delivery is not configured by this guide; do not mark them as tested unless SMTP is configured separately.

## 6 Routine operation and updates

Run these commands from `/home/platform/project/GRNScope` as `platform`:

```bash
python3 scripts/server.py status
python3 scripts/server.py logs worker
python3 scripts/server.py logs backend
python3 scripts/server.py verify
```

`logs` shows the last 100 lines. Omit the service name to show all four logs. `status`, `logs`, `stop`, and `restart` accept `frontend`, `backend`, `worker`, or `redis`. Stop and restart commands invoke sudo.

```bash
python3 scripts/server.py stop
python3 scripts/server.py restart
```

Let running analyses finish before stopping, restarting, or upgrading. Stopping services is not a pause-and-resume mechanism for active analyses.

### Storage and backups

| Location under /data2/platform/grnscope | Purpose |
| --- | --- |
| projects | Uploaded datasets, project metadata, analysis results |
| redis | Persistent analysis queue |
| config | Generated settings, Redis credentials, service definitions, installation records |
| logs | Frontend, backend, worker, and Redis logs |
| envs and frontend | Installed Python/Redis environment and production website |
| runtime and tmp | Analysis working directories and temporary files |
| cache | Download and application caches |

The source checkout's `workspace` links to the data folder; `backend/projects` links to its `projects` subfolder. Docker images use Docker's own storage. Keep both code folders at their installed paths. The installation marker also records the owning user ID; moving an installation or changing its owner requires a planned migration.

Back up `server.env`, the delivered code release, and the data folder's `projects`, `redis`, `config`, and `.grnscope-managed.json`. Take a consistent backup after analyses finish and all four GRNScope services have stopped, or use the team's equivalent coordinated snapshot procedure. Protect Redis credentials in backups. Set log retention and monitor data-disk and Docker-disk usage.

### Updating code or changing settings

After draining work, stop GRNScope and take the backup above. Apply the next matching GRNScope/Beeline release at the same code paths, preserving `server.env` and the storage links. If using Git, use the release revisions supplied by the developer. If using archives, follow the release's file-replacement instructions so removed files are also handled.

Edit `server.env` if settings change, then run:

```bash
python3 scripts/server.py install
python3 scripts/server.py enable
python3 scripts/server.py verify
```

Repeat a fresh small analysis. If the website port changes, also replace the Apache snippet and reload Apache. Do not rely on `restart` alone after changing build-time routing or deployment settings. Keep the prior release and backup until acceptance passes; the installer has no automatic rollback command.

## 7 Common installation problems

### Configuration already exists

Edit `server.env` and rerun `check`. The configuration command deliberately preserves existing settings. Do not remove configuration from an active installation to restart setup.

### Data disk is not mounted or a directory is not writable

Ask the administrator to verify the `/data2` mount and project ownership. Keep `DATA_MOUNT=/data2`; changing it to `/` would remove the intended missing-disk protection. If setup finds existing data or a link pointing elsewhere, inspect it and arrange migration instead of deleting it.

### Docker permission failure or image download failure

Run `docker info` as `platform`. The analysis worker needs a local Docker engine and access to the same code and data paths. Have the administrator resolve access, storage, or connectivity issues. Then rerun `install`. Image preparation can refresh shared `grnbeeline/*` tags, so coordinate with any other users of those tags.

### Old Conda cannot solve the environment

Keep the shared Conda installation intact. Choose an unused separate base directory on the data disk and change this line in `server.env`:

```ini
CONDA_EXE=/data2/platform/grnscope-conda/bin/conda
```

Then run as `platform`:

```bash
python3 scripts/server.py install-conda
python3 scripts/server.py check
python3 scripts/server.py install
```

This downloads the installer's pinned Miniforge release and verifies its checksum. The destination must not be an existing incomplete Conda directory or overlap the code/data folder. The normal Hong Kong path uses existing Conda, so this fallback is only needed if that fails.

### A port is occupied or analyses need more resources

Add the relevant setting to `server.env`, using values agreed with the administrator. Supported settings include `FRONTEND_PORT`, `BACKEND_PORT`, `REDIS_PORT`, `WORKER_COUNT`, `ALGORITHM_CPU_BUDGET`, and `ALGORITHM_MEMORY_MB`. Choose three distinct ports from 1024 to 65535. Memory is specified in MiB. After services have been installed, stop them before changing settings and follow the rebuild procedure in section 6.

### Website returns an error or jobs remain queued

Run `status`, `verify`, and the appropriate `logs` command. If internal verification passes but public HTTPS fails, inspect the Apache VirtualHost, DNS, certificate, and proxy configuration. If jobs remain queued, inspect the worker and Redis logs. If a service cannot start, an administrator can inspect `journalctl -u grnscope-worker -n 100 --no-pager`, substituting the affected service name. Preserve the exact error and failed command when reporting a problem; omit Redis credentials and private datasets.

## 8 Release handoff checklist for the sender

Supply the updated GRNScope source, the matching modified Beeline source, and this guide. Include the backend reference/demo data, frontend sample files, and the local tooling archive referenced by `package-lock.json`. Exclude development environments, caches, secrets, existing user projects, and machine-specific links.

Record both source revisions and any uncommitted release changes. Provide a checksum for the delivered archive and retain a copy. A source-only archive still needs network access during installation; it is not an offline deployment package. Python dependencies and some Docker inputs are not fully locked, so a clean install and real analysis on the target server remain part of acceptance.

This guide was derived from the supplied 620b environment note dated 3 November 2026 and the implementation in `scripts/server.py`, `frontend/next.config.ts`, `backend/worker.py`, backend configuration/services, and `Beeline/utils/initialize.sh`. The environment note describes an existing PhageScope deployment; its Django, Gunicorn, Vue, and PostgreSQL components are not GRNScope installation requirements.
