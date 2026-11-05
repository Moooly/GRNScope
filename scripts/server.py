#!/usr/bin/env python3
"""Deploy GRNScope on a shared Linux server. Bootstrap Python: 3.8 or newer."""
from __future__ import annotations

import argparse
import grp
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

REPO = Path(__file__).resolve().parents[1]
SERVICES = ("redis", "backend", "worker", "frontend")
KEYS = {
    "DATA_ROOT", "DATA_MOUNT", "CONDA_EXE", "NODE_BIN", "BEELINE_ROOT",
    "SERVICE_PREFIX", "FRONTEND_PORT", "BACKEND_PORT", "REDIS_PORT",
    "WORKER_COUNT", "ALGORITHM_CPU_BUDGET", "ALGORITHM_MEMORY_MB", "PUBLIC_URL",
}
PATH_KEYS = ("DATA_ROOT", "DATA_MOUNT", "CONDA_EXE", "NODE_BIN", "BEELINE_ROOT")
REQUIRED_SETTINGS = {"DATA_ROOT", "PUBLIC_URL", "CONDA_EXE", "NODE_BIN", "BEELINE_ROOT"}
CONDA_INSTALLER_URL = (
    "https://github.com/conda-forge/miniforge/releases/download/26.9.4-1/"
    "Miniforge3-26.9.4-1-Linux-x86_64.sh"
)
CONDA_INSTALLER_SHA256 = "571b410272cc434f28bc6c5c49ca8ffd4a4d1bcba9f57f1b6baccdb46446cfcc"


def absolute_path(value):
    value = os.path.expanduser(value)
    if not re.fullmatch(r"/[A-Za-z0-9_./-]*", value):
        raise ValueError("Use absolute paths or ~/ paths without spaces or shell variables")
    return os.path.abspath(value)


def detect_mount(data):
    current = Path(data).resolve()
    while not os.path.ismount(current):
        if current == current.parent:
            raise ValueError("Cannot detect the data disk; set DATA_MOUNT explicitly")
        current = current.parent
    return str(current)


def host_memory_mb():
    try:
        return os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") // (1024 * 1024)
    except (ValueError, OSError):
        raise ValueError("Cannot detect host memory on this platform")


def within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def read_config(path, repo=REPO):
    values = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, raw = line.partition("=")
        if not separator or key not in KEYS:
            raise ValueError("Invalid configuration key at line %d: %s" % (number, key))
        tokens = shlex.split(raw, comments=True)
        if len(tokens) != 1 or key in values:
            raise ValueError("Expected one value for %s at line %d" % (key, number))
        values[key] = tokens[0]
    missing = REQUIRED_SETTINGS - set(values)
    if missing:
        raise ValueError("Missing settings: " + ", ".join(sorted(missing)))
    values["DATA_ROOT"] = absolute_path(values["DATA_ROOT"])
    # Keep optional defaults stable; required settings always come from server.env.
    settings = Path(values["DATA_ROOT"]) / "config"
    saved_path = settings / "resolved-settings.json"
    if not saved_path.exists():
        saved_path = settings / "installation.json"
    if saved_path.exists():
        saved = json.loads(saved_path.read_text())
        if not isinstance(saved, dict):
            raise ValueError("Invalid saved deployment settings: " + str(saved_path))
        values = {**{key: value for key, value in saved.items() if key in KEYS}, **values}
    for key, value in {"SERVICE_PREFIX": "grnscope", "FRONTEND_PORT": 13000,
                       "BACKEND_PORT": 18000, "REDIS_PORT": 16379}.items():
        values.setdefault(key, value)
    if "DATA_MOUNT" not in values:
        values["DATA_MOUNT"] = detect_mount(values["DATA_ROOT"])
    for key in PATH_KEYS:
        values[key] = absolute_path(values[key])
    if any(key not in values for key in ("WORKER_COUNT", "ALGORITHM_CPU_BUDGET", "ALGORITHM_MEMORY_MB")):
        cpus, memory = os.cpu_count() or 1, host_memory_mb()
        values.setdefault("WORKER_COUNT", 2 if cpus >= 2 and memory >= 8192 else 1)
        workers = int(values["WORKER_COUNT"])
        if workers <= 0:
            raise ValueError("WORKER_COUNT must be positive")
        values.setdefault("ALGORITHM_CPU_BUDGET", min(4, max(1, cpus // (2 * workers))))
        values.setdefault("ALGORITHM_MEMORY_MB", min(8192, max(1, memory // (2 * workers))))
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", str(repo)):
        raise ValueError("Place the code checkout in an absolute path without spaces")
    for key in ("FRONTEND_PORT", "BACKEND_PORT", "REDIS_PORT", "WORKER_COUNT",
                "ALGORITHM_CPU_BUDGET", "ALGORITHM_MEMORY_MB"):
        values[key] = int(values[key])
        if values[key] <= 0:
            raise ValueError(key + " must be positive")
    ports = [values[key] for key in ("FRONTEND_PORT", "BACKEND_PORT", "REDIS_PORT")]
    if len(set(ports)) != 3 or any(not 1024 <= port <= 65535 for port in ports):
        raise ValueError("Choose three distinct unprivileged ports between 1024 and 65535")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", values["SERVICE_PREFIX"]):
        raise ValueError("SERVICE_PREFIX must contain lowercase letters, digits or hyphens")
    address = urlsplit(values["PUBLIC_URL"])
    if (address.scheme not in {"http", "https"} or not address.hostname
            or address.path not in {"", "/"} or address.query or address.fragment
            or address.username or address.password):
        raise ValueError("PUBLIC_URL must be a root HTTP(S) address on a dedicated hostname")
    data, mount = Path(values["DATA_ROOT"]).resolve(), Path(values["DATA_MOUNT"]).resolve()
    if data == mount or not within(data, mount):
        raise ValueError("DATA_ROOT must be a project subdirectory of DATA_MOUNT")
    if within(data, repo.resolve()) or within(repo.resolve(), data):
        raise ValueError("Keep DATA_ROOT separate from the source checkout")
    return values


def ensure_link(link, target):
    """Create a project link without replacing any existing data."""
    if link.is_symlink():
        if link.resolve() != target.resolve():
            raise ValueError("Existing link points elsewhere: " + str(link))
        return
    if link.exists():
        if not link.is_dir() or any(link.iterdir()):
            raise ValueError("Refusing to replace existing files at %s; migrate them first" % link)
        link.rmdir()
    link.symlink_to(target, target_is_directory=True)


def private_write(path, text):
    descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(text)


class Server:
    def __init__(self, config, repo=REPO):
        self.c = config
        self.repo = repo.resolve()
        self.data = Path(config["DATA_ROOT"]).resolve()
        self.env = self.data / "envs" / "backend"
        self.python = self.env / "bin" / "python"
        self.frontend = self.data / "frontend"
        self.settings = self.data / "config"
        self.marker = self.data / ".grnscope-managed.json"
        self.user = pwd.getpwuid(os.getuid()).pw_name
        self.group = grp.getgrgid(os.getgid()).gr_name
        self.docker = shutil.which("docker") or "docker"
        self.docker_host = "unix:///var/run/docker.sock"

    def run(self, args, capture=False, **kwargs):
        print("+ " + shlex.join([str(arg) for arg in args]), flush=True)
        return subprocess.run([str(arg) for arg in args], check=True, text=True,
                              stdout=subprocess.PIPE if capture else None, **kwargs)

    def units(self):
        return [self.c["SERVICE_PREFIX"] + "-" + name + ".service" for name in SERVICES]

    def install_conda(self):
        """Install Conda at the explicitly configured path, without shell initialization."""
        if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
            raise ValueError("Conda bootstrap requires an x86-64 Linux server")
        if os.getuid() == 0:
            raise ValueError("Run install-conda as the project user, not root")
        conda = Path(self.c["CONDA_EXE"])
        if conda.is_file() and os.access(conda, os.X_OK):
            self.run([conda, "--version"])
            print("Using existing Conda; no installation or upgrade was performed.")
            return
        if conda.name != "conda" or conda.parent.name != "bin":
            raise ValueError("For install-conda, set CONDA_EXE=/new/install/folder/bin/conda")
        prefix = conda.parent.parent.resolve()
        if any(within(prefix, root) or within(root, prefix) for root in (self.data, self.repo)):
            raise ValueError("Install the Conda base in its own folder, separate from DATA_ROOT and the code")
        if conda.parent.parent.is_symlink() or prefix.exists():
            raise ValueError("Refusing to overwrite existing Conda installation folder: " + str(prefix))
        prefix.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".grnscope-conda-", dir=prefix.parent) as temporary:
            installer = Path(temporary) / "Miniforge3.sh"
            digest = hashlib.sha256()
            print("Downloading pinned Miniforge Conda installer...", flush=True)
            with urlopen(CONDA_INSTALLER_URL, timeout=60) as response, installer.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != CONDA_INSTALLER_SHA256:
                raise ValueError("Conda installer SHA-256 mismatch; installation was not started")
            env = dict(os.environ, TMPDIR=temporary)
            env.pop("PYTHONHOME", None)
            env.pop("PYTHONPATH", None)
            self.run(["bash", installer, "-b", "-p", prefix], env=env)
            self.run([conda, "--version"], env=env)
        print("Conda installed at " + str(conda) + "; no conda init or shell changes are needed.")

    def check_owner(self):
        if self.marker.exists():
            saved = json.loads(self.marker.read_text())
            if saved != {"repo": str(self.repo), "uid": os.getuid()}:
                raise ValueError("DATA_ROOT belongs to a different installation: " + str(self.data))
        elif self.data.exists() and any(self.data.iterdir()):
            raise ValueError("Use an empty dedicated DATA_ROOT; existing files will not be overwritten")

    def check_units(self, require_stopped=False):
        for unit in self.units():
            result = subprocess.run(["systemctl", "cat", unit], text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                if "# GRNScope data: " + str(self.data) not in result.stdout:
                    raise ValueError("Service name already belongs to another installation: " + unit)
                if require_stopped and subprocess.run(
                        ["systemctl", "is-active", "--quiet", unit]).returncode == 0:
                    raise ValueError("Stop GRNScope before installation: python3 scripts/server.py stop")

    def check(self, free_ports=True):
        if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
            raise ValueError("This deployment requires an x86-64 Linux server")
        if os.getuid() == 0:
            raise ValueError("Run as the project user, not root; enable uses sudo only for service registration")
        print("Deployment settings (optional overrides are documented in DEPLOYMENT.md):")
        for key in sorted(self.c):
            print("  %s=%s" % (key, self.c[key]))
        for command in ("git", "docker", "systemctl"):
            if not shutil.which(command):
                raise ValueError("Administrator prerequisite is missing: " + command)
        for binary in (Path(self.c["CONDA_EXE"]), Path(self.c["NODE_BIN"]) / "node",
                       Path(self.c["NODE_BIN"]) / "npm"):
            if not binary.is_file() or not os.access(binary, os.X_OK):
                raise ValueError("Executable not found; check server.env: " + str(binary))
        version = self.run([Path(self.c["NODE_BIN"]) / "node", "--version"], capture=True).stdout
        parts = version.strip().lstrip("v").split(".")
        if (int(parts[0]), int(parts[1])) < (20, 9):
            raise ValueError("Node.js >=20.9 is required; select a suitable NVM version for this project")
        beeline = Path(self.c["BEELINE_ROOT"])
        if not (beeline / "BLRunner.py").is_file() or not (beeline / "utils/initialize.sh").is_file():
            raise ValueError("Beeline runner/setup script not found; check BEELINE_ROOT=" + str(beeline))
        if not os.path.ismount(self.c["DATA_MOUNT"]):
            raise ValueError("Data disk is not mounted: " + self.c["DATA_MOUNT"])
        self.check_owner()
        self.check_units(require_stopped=free_ports)
        existing = self.data
        while not existing.exists():
            existing = existing.parent
        if not os.access(existing, os.W_OK):
            raise ValueError("Administrator must grant this user write access to " + str(existing))
        usage = shutil.disk_usage(existing)
        print("Data disk free: %.1f GiB" % (usage.free / 1024 ** 3))
        if free_ports:
            for key in ("FRONTEND_PORT", "BACKEND_PORT", "REDIS_PORT"):
                with socket.socket() as listener:
                    try:
                        listener.bind(("127.0.0.1", self.c[key]))
                    except OSError as error:
                        raise ValueError("%s is occupied; reserve another port in server.env" % key) from error
        if self.c["WORKER_COUNT"] * self.c["ALGORITHM_CPU_BUDGET"] > (os.cpu_count() or 1):
            raise ValueError("Worker CPU budgets exceed this host; reduce them in server.env")
        total_mb = host_memory_mb()
        if self.c["WORKER_COUNT"] * self.c["ALGORITHM_MEMORY_MB"] > total_mb * 0.8:
            raise ValueError("Worker memory budgets leave insufficient host memory; reduce them in server.env")
        docker_root = self.run([self.docker, "info", "--format", "{{.DockerRootDir}}"], capture=True).stdout.strip()
        endpoint = os.environ.get("DOCKER_HOST")
        if not endpoint:
            context = self.run([self.docker, "context", "show"], capture=True).stdout.strip()
            endpoint = self.run([self.docker, "context", "inspect", context, "--format",
                                 "{{.Endpoints.docker.Host}}"], capture=True).stdout.strip()
        if not endpoint.startswith("unix://"):
            raise ValueError("Use the local Docker engine: algorithm bind mounts require server-local files")
        self.docker_host = endpoint
        print("Docker image storage: " + docker_root + " (administrator-managed; ensure sufficient free space)")
        print("Environment checks passed. No global software settings were changed.")

    def environment(self):
        c = self.c
        password = (self.settings / "redis-password").read_text().strip()
        if not re.fullmatch(r"[a-f0-9]{64}", password):
            raise ValueError("Invalid project Redis password; check DATA_ROOT/config/redis-password")
        return {
            "PATH": ":".join([str(self.env / "bin"), c["NODE_BIN"], str(Path(self.docker).parent),
                              "/usr/local/bin", "/usr/bin", "/bin"]),
            "BEELINE_ROOT": c["BEELINE_ROOT"], "BEELINE_PYTHON": str(self.python),
            "DOCKER_HOST": self.docker_host,
            "GRNSCOPE_QUEUE_BACKEND": "redis",
            "GRNSCOPE_REDIS_URL": "redis://:%s@127.0.0.1:%d/0" % (password, c["REDIS_PORT"]),
            "GRNSCOPE_WORKER_QUEUE": "grnscope",
            "GRNSCOPE_WORKER_COUNT": str(c["WORKER_COUNT"]),
            "GRNSCOPE_MAX_CONCURRENT_ALGORITHMS": str(c["WORKER_COUNT"]),
            "GRNSCOPE_ALGORITHM_CPU_BUDGET": str(c["ALGORITHM_CPU_BUDGET"]),
            "GRNSCOPE_ALGORITHM_MEMORY_MB": str(c["ALGORITHM_MEMORY_MB"]),
            "GRNSCOPE_WORKER_MAX_JOBS": "1", "GRNSCOPE_PUBLIC_URL": c["PUBLIC_URL"],
            "GRNSCOPE_SPACE_FREE_LINK_ROOT": str(self.data / "runtime" / "links"),
            "GRNSCOPE_SPACE_FREE_RUNTIME_ROOT": str(self.data / "runtime" / "beeline"),
            "TMPDIR": str(self.data / "tmp"), "XDG_CACHE_HOME": str(self.data / "cache"),
            "NUMBA_CACHE_DIR": str(self.data / "cache" / "numba"),
            "MPLCONFIGDIR": str(self.data / "cache" / "matplotlib"),
            "PIP_CACHE_DIR": str(self.data / "cache" / "pip"),
            "CONDA_PKGS_DIRS": str(self.data / "cache" / "conda"),
            "npm_config_cache": str(self.data / "cache" / "npm"),
            "NODE_ENV": "production", "NEXT_PUBLIC_API_URL": "/api",
            "NEXT_INTERNAL_API_PROXY_TARGET": "http://127.0.0.1:%d" % c["BACKEND_PORT"],
            **{name: str(c["ALGORITHM_CPU_BUDGET"]) for name in
               ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "NUMBA_NUM_THREADS")},
        }

    def initialize_storage(self):
        self.check_owner()
        self.data.mkdir(parents=True, exist_ok=True)
        self.marker.write_text(json.dumps({"repo": str(self.repo), "uid": os.getuid()}) + "\n")
        for name in ("config/systemd", "projects", "runtime", "redis", "logs", "tmp", "cache", "envs"):
            (self.data / name).mkdir(parents=True, exist_ok=True)
        password = self.settings / "redis-password"
        if not password.exists():
            private_write(password, secrets.token_hex(32) + "\n")
        ensure_link(self.repo / "workspace", self.data)
        ensure_link(self.repo / "backend" / "projects", self.data / "projects")
        (self.settings / "resolved-settings.json").write_text(json.dumps(self.c, indent=2) + "\n")

    def render(self):
        c, env = self.c, self.environment()
        environment_file = self.settings / "runtime.env"
        private_write(environment_file, "".join(key + "=" + value + "\n" for key, value in env.items()))
        redis = self.settings / "redis.conf"
        private_write(redis, "\n".join([
            "bind 127.0.0.1", "protected-mode yes", "port %d" % c["REDIS_PORT"],
            "requirepass " + (self.settings / "redis-password").read_text().strip(),
            "daemonize no", 'logfile ""', "dir " + str(self.data / "redis"),
            "appendonly yes", "appendfsync everysec", "maxmemory 1gb", "maxmemory-policy noeviction", "",
        ]))
        commands = {
            "redis": [self.env / "bin/redis-server", redis],
            "backend": [self.python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
                        "--port", str(c["BACKEND_PORT"])],
            "worker": [self.python, self.repo / "backend/worker.py"],
            "frontend": [Path(c["NODE_BIN"]) / "node", self.frontend / "node_modules/next/dist/bin/next",
                         "start", "--hostname", "127.0.0.1", "--port", str(c["FRONTEND_PORT"])],
        }
        redis_unit = c["SERVICE_PREFIX"] + "-redis.service"
        for service, unit in zip(SERVICES, self.units()):
            dependencies = "network.target" if service == "redis" else "network.target docker.service " + redis_unit
            required = "" if service == "redis" else "Requires=" + redis_unit + "\n"
            working = self.frontend if service == "frontend" else self.repo / "backend"
            text = ("# GRNScope data: %s\n[Unit]\nDescription=GRNScope %s\nAfter=%s\n%s"
                    "RequiresMountsFor=%s %s %s\n"
                    "\n[Service]\nUser=%s\nGroup=%s\nWorkingDirectory=%s\nEnvironmentFile=%s\n"
                    "ExecStart=%s\nRestart=always\nRestartSec=5\nTimeoutStopSec=60\n"
                    "StandardOutput=append:%s\nStandardError=inherit\n\n[Install]\nWantedBy=multi-user.target\n") % (
                        self.data, service, dependencies, required, self.data, self.repo, c["BEELINE_ROOT"],
                        self.user, self.group, working,
                        environment_file, " ".join(map(str, commands[service])),
                        self.data / "logs" / (service + ".log"))
            (self.settings / "systemd" / unit).write_text(text)
        (self.settings / "apache-proxy.conf").write_text(
            "# Insert inside the dedicated GRNScope HTTPS VirtualHost.\n"
            "# Existing Apache configuration supplies ServerName, TLS and access control.\n"
            "ProxyPreserveHost On\nProxyTimeout 3600\nLimitRequestBody 0\n"
            "RequestHeader set X-Forwarded-Proto \"https\"\n"
            'ProxyPass "/" "http://127.0.0.1:%d/" connectiontimeout=5 timeout=3600\n'
            'ProxyPassReverse "/" "http://127.0.0.1:%d/"\n' % (c["FRONTEND_PORT"], c["FRONTEND_PORT"]))

    def install(self):
        self.check()
        self.initialize_storage()
        (self.settings / "installation.json").unlink(missing_ok=True)
        env = dict(os.environ, **self.environment())
        env.pop("PYTHONPATH", None)
        env.pop("PYTHONHOME", None)
        if not self.python.exists():
            self.run([self.c["CONDA_EXE"], "create", "--yes", "--prefix", self.env,
                      "--override-channels", "--channel", "conda-forge", "python=3.11", "pip", "redis>=7,<8"], env=env)
        elif not (self.env / "bin/redis-server").exists():
            self.run([self.c["CONDA_EXE"], "install", "--yes", "--prefix", self.env,
                      "--override-channels", "--channel", "conda-forge", "python=3.11", "redis>=7,<8"], env=env)
        self.run([self.python, "-c", "import sys; assert sys.version_info[:2] == (3, 11), 'Use a dedicated Python 3.11 environment'"], env=env)
        self.run([self.python, "-m", "pip", "install", "--upgrade", "pip"], env=env)
        self.run([self.python, "-m", "pip", "install", "-r", self.repo / "backend/requirements.txt"], env=env)
        self.run([self.python, "-m", "pip", "check"], env=env)
        self.run([self.python, Path(self.c["BEELINE_ROOT"]) / "BLRunner.py", "--help"], env=env)
        if self.frontend.is_symlink():
            raise ValueError("Refusing to replace a frontend build directory that is a symlink")
        if self.frontend.exists():
            shutil.rmtree(self.frontend)
        shutil.copytree(self.repo / "frontend", self.frontend, ignore=shutil.ignore_patterns(
            "node_modules", ".next", ".next-dev", ".env", ".env.*", "*.tsbuildinfo", ".DS_Store", ".claude", ".git"))
        self.run([Path(self.c["NODE_BIN"]) / "npm", "ci", "--include=dev"], cwd=self.frontend, env=env)
        self.run([Path(self.c["NODE_BIN"]) / "npm", "run", "build"], cwd=self.frontend, env=env)
        self.run(["bash", Path(self.c["BEELINE_ROOT"]) / "utils/initialize.sh"], env=env)
        self.render()
        frozen = self.run([self.python, "-m", "pip", "freeze"], capture=True, env=env).stdout
        (self.settings / "python-installed.txt").write_text(frozen)
        versions = {name: self.run(["git", "-C", path, "rev-parse", "HEAD"], capture=True).stdout.strip()
                    for name, path in (("GRNScope", self.repo), ("Beeline", Path(self.c["BEELINE_ROOT"])))}
        (self.settings / "source-versions.json").write_text(json.dumps(versions, indent=2) + "\n")
        (self.settings / "installation.json").write_text(json.dumps(self.c, indent=2) + "\n")
        print("Installation prepared. Next: python3 scripts/server.py enable")

    def enable(self):
        self.check(free_ports=False)
        completed = self.settings / "installation.json"
        if not completed.is_file() or json.loads(completed.read_text()) != self.c:
            raise ValueError("Finish install with the current server.env before enable")
        for unit in self.units():
            source = self.settings / "systemd" / unit
            if not source.is_file():
                raise ValueError("Run install before enable")
            self.run(["sudo", "install", "-m", "0644", source, "/etc/systemd/system/" + unit])
        self.run(["sudo", "systemctl", "daemon-reload"])
        self.run(["sudo", "systemctl", "enable", "--now", *self.units()])
        self.verify()
        print("Apache proxy configuration: " + str(self.settings / "apache-proxy.conf"))

    def manage(self, action, service=None):
        self.check_owner()
        self.check_units()
        units = ([self.c["SERVICE_PREFIX"] + "-" + service + ".service"] if service else self.units())
        if action == "logs":
            files = [self.data / "logs" / (name + ".log") for name in ([service] if service else SERVICES)]
            self.run(["tail", "-n", "100", *files])
        elif action == "status":
            self.run(["systemctl", "status", "--no-pager", *units])
        else:
            self.run(["sudo", "systemctl", action, *units])

    def verify(self):
        self.check_owner()
        if not self.python.is_file():
            raise ValueError("Run install first")
        for unit in self.units():
            self.run(["systemctl", "is-active", "--quiet", unit])
        for endpoint in ("/api/algorithms", "/api/projects/demo", "/api/projects/demo/results"):
            url = "http://127.0.0.1:%d%s" % (self.c["FRONTEND_PORT"], endpoint)
            for attempt in range(60):
                try:
                    with urlopen(url, timeout=5) as response:
                        payload = json.load(response)
                        if not payload.get("ok"):
                            raise ValueError("Unexpected API response: " + endpoint)
                    break
                except (OSError, ValueError):
                    if attempt == 59:
                        raise ValueError("Readiness check failed: %s; run logs" % url)
                    time.sleep(1)
        code = ("from redis import Redis; from rq import Worker; import time, os; "
                "r=Redis.from_url(os.environ['GRNSCOPE_REDIS_URL']); assert r.ping(); "
                "workers=[w for w in Worker.all(connection=r) if w.name.startswith('grnscope-') "
                "and w.last_heartbeat and time.time()-w.last_heartbeat.timestamp()<90]; "
                "assert len(workers)>=%d, 'Analysis workers have not registered yet'") % self.c["WORKER_COUNT"]
        env = dict(os.environ, **self.environment())
        for attempt in range(30):
            result = subprocess.run([str(self.python), "-c", code], text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            if result.returncode == 0:
                break
            if attempt == 29:
                raise ValueError("Worker readiness failed: " + result.stderr.strip())
            time.sleep(1)
        print("Website, API, demo results, Redis and analysis workers are ready.")
        print("Local address: http://127.0.0.1:%d" % self.c["FRONTEND_PORT"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install-conda", "check", "install", "enable", "verify", "status", "logs", "stop", "restart"))
    parser.add_argument("service", nargs="?", choices=SERVICES)
    parser.add_argument("--config", type=Path, default=REPO / "server.env")
    args = parser.parse_args()
    if args.service and args.command not in {"status", "logs", "stop", "restart"}:
        parser.error("A service name is only supported with status/logs/stop/restart")
    try:
        server = Server(read_config(args.config))
        if args.command in {"status", "logs", "stop", "restart"}:
            server.manage(args.command, args.service)
        else:
            getattr(server, args.command.replace("-", "_"))()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
