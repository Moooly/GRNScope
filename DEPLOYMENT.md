# Deploy GRNScope on a shared Linux server

This guide targets the Hong Kong server: **Ubuntu 20.04 x86-64**, user `platform`,
existing Conda/NVM, and Apache for HTTPS. The application uses Next.js, FastAPI,
a dedicated Redis queue, and Docker algorithm containers.

## Before starting — administrator prerequisites

Confirm these once:

- The project user can use the **local Docker engine** (`docker info` succeeds),
  and the engine starts after reboot. Docker 20.10 or newer is recommended.
  Confirm space in Docker's image storage; the scripts do not change its location.
  Agree use of the `grnbeeline/*` image tags with the administrator: image setup
  can refresh those shared Docker tags.
- `/data2` is mounted, and the user can create `/data2/platform/grnscope`.
- Conda and Node.js **>=20.9** are installed. Enter their paths explicitly in
  `server.env`. Bootstrap `python3` must be >=3.8.
- Three unused local ports are reserved: **13000** (website), **18000** (API),
  **16379** (project Redis), plus service prefix `grnscope`.
- An administrator can register systemd services and configure a dedicated
  Apache hostname. TLS and access control follow the institution's policy;
  GRNScope does not provide account-based authentication.
- Internet access is available for GitHub, package repositories, Docker images
  and algorithm reference downloads.

Run the following as the project user. **Do not run the setup script as root.**
It creates a project Python 3.11 environment and Redis on the data disk; it does
not upgrade shared Conda, change NVM defaults, or modify other projects.

## 1. Get the code and edit one configuration file

```bash
git clone https://github.com/Moooly/GRNScope.git
git clone https://github.com/Moooly/Beeline.git
cd GRNScope
cp scripts/server.env.example server.env
nano server.env
```

Five settings are required. Use your server's actual paths; the paths below are
examples for a test VM:

```ini
DATA_ROOT=~/grnscope-data
PUBLIC_URL=https://grnscope.your-institute.edu
CONDA_EXE=~/miniconda3/bin/conda
NODE_BIN=/usr/bin
BEELINE_ROOT=~/gene_website/Beeline
```

`DATA_ROOT` holds uploads, results and generated files. **On the Hong Kong
server, change it to `/data2/platform/grnscope`** after confirming `/data2` is
mounted. The home-folder default suits a test VM. Use paths without spaces;
`~/` is expanded automatically. Keep this folder outside the source checkout.

`PUBLIC_URL` is the final website address. The site must be served at the
hostname root, not a subpath. DNS and HTTPS are configured separately below.
`server.env` is ignored by Git.

`CONDA_EXE` is the full path to the Conda executable. `NODE_BIN` is the directory
containing `node` and `npm`. `BEELINE_ROOT` is the modified Beeline checkout.
The script uses exactly these paths and does not search for alternatives.
On the Hong Kong server, Conda is
`/apps/software/Miniconda3/4.9.2/bin/conda` and the Node directory is
`/home/platform/.nvm/versions/node/v20.18.0/bin`. Set Beeline's path to wherever
you cloned it in the first step.

The containing data mount is determined from `DATA_ROOT`. Defaults use ports
**13000 / 18000 / 16379** and service prefix `grnscope`.
Resource limits adapt to the host: **2 simultaneous methods**
on hosts with at least 2 CPUs and 8 GiB RAM, otherwise 1. Each gets 1–4 CPUs
and a share of half the host RAM, capped at 8 GiB per method. These are starting
limits; larger datasets may require the optional overrides below.

To validate the paths and preview the settings without installing anything:

```bash
python3 scripts/server.py check
```

## 2. Prepare the application

```bash
python3 scripts/server.py install
```

This checks the environment, creates the isolated Python/Redis environment,
installs dependencies, builds the production website, prepares **all required
algorithm images including CellOracle and Slingshot**, and generates service
and Apache configuration files. Initial image builds can take considerable
time; keep the SSH session open or use your usual terminal session manager.
If setup fails, fix the reported issue and rerun the same command.

Large generated files go to the data disk:

| Location under `DATA_ROOT` | Contents |
|---|---|
| `envs/`, `frontend/`, `cache/` | Python/Redis environment, frontend dependencies/build, download caches |
| `projects/`, `runtime/`, `tmp/` | Uploads, results and analysis/inspection working files |
| `redis/`, `logs/`, `config/` | Queue persistence, service logs and generated configuration |

The checkout's `workspace` and `backend/projects` are linked to this storage.
Existing nonempty project directories are **never overwritten**; migrate an old
installation separately before using these scripts. Bundled reference files
remain in the source checkout. Docker images remain in the existing Docker
engine's administrator-managed storage.

## 3. Start the services and connect Apache

```bash
python3 scripts/server.py enable
```

This requests `sudo` to register and start **only the four named GRNScope
services**, enables startup after reboot, and checks the website, API, demo,
Redis and registered analysis workers. It does not change Apache.
The project Redis password is generated and configured automatically.

Give the administrator `DATA_ROOT/config/apache-proxy.conf`. On the Hong Kong
server this is:

```text
/data2/platform/grnscope/config/apache-proxy.conf
```

Insert its contents inside the dedicated GRNScope **HTTPS VirtualHost**. The
administrator supplies the hostname, certificate and access restrictions, and
ensures `proxy`, `proxy_http` and `headers` modules are enabled. Then validate
and gracefully reload Apache using the server's normal procedure, for example:

```bash
sudo apachectl configtest && sudo apachectl graceful
```

Open `PUBLIC_URL`, check `/projects/demo`, then create a small project and run
an analysis. Readiness checks do not replace real algorithm testing. Before
handoff, also test two concurrent methods, stopping/rerunning a method and
result downloads. Email is optional and remains unconfigured.

For a private test before Apache is configured, forward the website port from
your own computer, then open `http://localhost:13000`:

```bash
ssh -N -L 13000:127.0.0.1:13000 platform@SERVER_ADDRESS
```

Only Apache needs an external listening port. Keep the website, API and Redis
ports private; the generated services bind to `127.0.0.1`.

## Daily operation

Run from the GRNScope checkout:

```bash
python3 scripts/server.py status
python3 scripts/server.py logs worker
python3 scripts/server.py restart
python3 scripts/server.py verify
```

`logs` without a service name shows all four logs. `status`, `logs`, `stop` and
`restart` accept `frontend`, `backend`, `worker` or `redis` to select one service.

For updates, first let running analyses finish and back up `DATA_ROOT/projects`,
`redis` and `config`. Then run this block:

```bash
python3 scripts/server.py stop
git pull --ff-only
git -C ../Beeline pull --ff-only
python3 scripts/server.py install && python3 scripts/server.py enable
```

To change deployment settings, finish running analyses, run `stop`, edit
`server.env`, then run `install` and `enable`. This keeps the frontend proxy and
generated services consistent. Keep the code and data directories in place after
installation. Set a log retention policy
for `DATA_ROOT/logs` using the server's existing maintenance tools.

If the old shared Conda cannot resolve the new environment, ask the administrator
for a newer Conda executable for this project and update `CONDA_EXE`; the script
does not update the shared base environment. Source revisions and installed
Python versions are recorded in `DATA_ROOT/config` for deployment review.

## Optional overrides

Most installations need only the five settings above. If the administrator
requests different ports or limits, add the relevant lines to `server.env`:

| Setting | Default / purpose |
|---|---|
| `DATA_MOUNT=/data2` | Override detected mount; refuse setup if it is not mounted |
| `SERVICE_PREFIX=grnscope` | Service name prefix |
| `FRONTEND_PORT=13000` | Internal website port |
| `BACKEND_PORT=18000` | Internal API port |
| `REDIS_PORT=16379` | Internal queue port |
| `WORKER_COUNT=2` | Maximum simultaneous analysis jobs |
| `ALGORITHM_CPU_BUDGET=8` | CPU allowance per algorithm; overrides the automatic limit |
| `ALGORITHM_MEMORY_MB=32768` | Memory cap per algorithm; this example is 32 GiB |

Agree resource overrides with the administrator; website processes and
preprocessing also need resources. Install Conda and Node before running setup.
Existing longer `server.env` files remain supported; ensure all five required
settings are present. Optional settings are saved under `DATA_ROOT/config` and
reused on later runs. The three software paths must always be specified in
`server.env`; they are never inferred from the shell or saved settings.

## References

- [Apache reverse proxy](https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html)
- [Conda environments at explicit paths](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html)
