# GRNScope fresh Debian 13 test deployment

This is a source deployment bundle, not a prebuilt/offline image release.
It contains the current working-tree code, including changes not yet pushed.
The installer has been checked locally; this bundle has not yet been installed
on a fresh Debian VM. The first VM installation is the deployment test.

## Requirements

- Debian 13, amd64/x86-64 VM, internet access, and a normal SSH user with sudo.
- Enough RAM and disk for the algorithm images and your chosen datasets.
  Two algorithms may run together; the application divides CPU/memory budgets.
- A freshly reset VM. Installer manages services named grnscope-backend,
  grnscope-worker, and grnscope-frontend. It is not an existing-server upgrade tool.

Check the architecture with `uname -m`. It must print `x86_64`.

## Install

1. Upload grnscope-debian13.tar.gz using Google Cloud's SSH-in-browser upload
   button, or use gcloud compute scp from your computer. It normally lands in
   the VM user's home directory.
2. In the VM SSH terminal:

```bash
cd ~
tar -xzf grnscope-debian13.tar.gz
cd grnscope-debian13
bash install-debian13.sh
```

Do not prefix the installer with sudo. It requests sudo when needed.
Run from an SSH session that will remain open; the initial Docker builds can
be lengthy. For a reconnectable session, install tmux and run the installer
inside it:

```bash
sudo apt-get update
sudo apt-get install -y tmux
tmux new -s grnscope-install
bash install-debian13.sh
```

Reconnect after a dropped SSH connection with `tmux attach -t grnscope-install`.
Detach without stopping installation with Ctrl+B, then D.

Installation writes install.log beside this file. If it fails, address the
reported error and rerun the same command. Later stages stop on failure;
partial setup is retained. Do not delete or relocate this directory afterwards:
it contains the live application, virtual environment, and project data.

## Open the website

The frontend binds to 127.0.0.1:3000 and the API to 127.0.0.1:8000.
To open it privately, run this on YOUR COMPUTER with Google Cloud CLI installed
and signed into the right project (replace VM_NAME and ZONE):

```bash
gcloud compute ssh VM_NAME --zone ZONE -- -N -L 127.0.0.1:3000:127.0.0.1:3000 -o ExitOnForwardFailure=yes
```

Keep that terminal open. Visit http://localhost:3000 in your computer's browser.
If port 3000 is occupied locally, replace the FIRST 3000 in the forwarding
specification with 3001, then open http://localhost:3001.
If you normally connect with IAP, add `--tunnel-through-iap` before `--`.

If Google Cloud CLI is not installed on your computer, use Google Cloud Console's
Cloud Shell (a separate terminal from the VM's SSH terminal). Run the same
`gcloud compute ssh` forwarding command there, then choose Web Preview > Change
port > 3000. Cloud Shell provides the CLI and an authenticated browser preview.
Keep the forwarding command running while testing.

Do not open VM ports 3000, 8000, or Redis 6379 for this private test. Public
hosting is a separate step requiring the chosen domain, HTTPS, and access
policy. GRNScope currently has no account-based authentication.

## Validate

- Open /projects/demo and inspect the plots and example downloads.
- Upload a small dataset (sample files are available in the website).
- Run Pearson, then a small GENIE3/PPCOR job to exercise Docker.
- Run two selected methods and confirm they overlap in the analysis status.
- Test the other methods, including CellOracle and Slingshot, before handoff.
- Stop and rerun a job; check downloads and project reopening.
- Reboot with `sudo reboot`, reconnect the tunnel, and check saved projects.

The installer's smoke check verifies the built demo, frontend proxy, and API.
Successful installation does not prove every inference method works: actual
analysis tests are still required on the VM.

## Operations

```bash
sudo systemctl status grnscope-backend grnscope-worker grnscope-frontend --no-pager
sudo journalctl -u grnscope-backend -u grnscope-worker -u grnscope-frontend -n 100 --no-pager
sudo systemctl restart grnscope-backend grnscope-worker grnscope-frontend
```

Two worker processes are configured in `/etc/grnscope/runtime.env`.
Change both GRNSCOPE_WORKER_COUNT and GRNSCOPE_MAX_CONCURRENT_ALGORITHMS if
changing concurrency. Then restart backend and worker.
Email remains unconfigured. No passwords or existing server settings are bundled.

Project files live in `GRNScope/backend/projects/`. Back up that directory and
retain this exact bundle/version when collecting deployment-test results.
The installer uses native systemd services with Docker algorithm containers;
it is not a Docker Compose deployment.

## Sources

Docker Debian installation: https://docs.docker.com/engine/install/debian/
Node binary/checksum distribution: https://nodejs.org/dist/latest-v22.x/
Google VM file transfer: https://docs.cloud.google.com/compute/docs/instances/transfer-files
Google SSH forwarding: https://docs.cloud.google.com/solutions/connecting-securely
Next.js production hosting: https://nextjs.org/docs/app/guides/self-hosting

## Rebuild this bundle from source

Place the GRNScope and Beeline repositories beside each other. From the
GRNScope repository, run:

```bash
python3 scripts/package-debian13.py
```

This writes the archive and checksum to `../deployment/`. Use `--output PATH`
to choose another directory. Source files are read from the current working
trees, including uncommitted changes. Server settings, credentials, existing
projects, and local dependencies are excluded. Generated archives are release
artifacts and are not committed to Git.
