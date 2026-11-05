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
- Conda and Node.js **>=20.9** are available at the configured paths. The existing
  Node.js 20.18.0 installation is sufficient. Bootstrap `python3` must be >=3.8.
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

Check the paths, reserved ports and `PUBLIC_URL`. Use the final dedicated
hostname, for example `https://grnscope.your-institute.edu`. The site must be
served at the hostname root, not a subpath. `server.env` is ignored by Git.

The supplied starting allocation runs **2 methods concurrently**, with **8 CPU
units and 32 GiB per algorithm**. Agree these limits with the administrator;
website processes and preprocessing also use resources. Reduce the values for
a smaller test VM. For another Linux server, update the Conda/Node paths and
set `DATA_MOUNT` to its actual mount point (`/` is allowed for a root-disk test).

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

Give the administrator the generated file:

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
generated services consistent. Keep the
code and data directories in place after installation. Set a log retention policy
for `DATA_ROOT/logs` using the server's existing maintenance tools.

If the old shared Conda cannot resolve the new environment, ask the administrator
for a newer Conda executable for this project and update `CONDA_EXE`; the script
does not update the shared base environment. Source revisions and installed
Python versions are recorded in `DATA_ROOT/config` for deployment review.

## References

- [Apache reverse proxy](https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html)
- [Conda environments at explicit paths](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html)
