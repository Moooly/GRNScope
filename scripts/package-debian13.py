"""Build the Debian deployment bundle from sibling GRNScope/Beeline checkouts."""
from pathlib import Path
import subprocess
import shutil
import tarfile
import json
import hashlib
import argparse
import tempfile

repository = Path(__file__).resolve().parents[1]
workspace = repository.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=workspace / 'deployment',
                    help='Directory for the archive and checksum')
args = parser.parse_args()
if not (workspace / 'Beeline' / 'BLRunner.py').is_file():
    parser.error('Place the Beeline checkout beside the GRNScope checkout first.')
staging = tempfile.TemporaryDirectory(prefix='grnscope-package-')
stage = Path(staging.name) / 'grnscope-debian13'
stage.mkdir()
shutil.copy2(repository / 'deployment/install-debian13.sh', stage / 'install-debian13.sh')
shutil.copy2(repository / 'deployment/README.md', stage / 'README.md')
output = args.output.resolve()
output.mkdir(exist_ok=True)
manifest = []
for repo_name in ('GRNScope', 'Beeline'):
    repo = workspace / repo_name
    raw = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    candidates = {Path(p.decode()) for p in raw.split(b'\0') if p}
    if repo_name == 'GRNScope':
        # Public reference assets may be ignored as generated downloads.
        candidates.update(p.relative_to(repo) for p in (repo/'backend/data/gencode_reference').glob('*') if p.is_file())
    for relative in sorted(candidates):
        parts = relative.parts
        if any(p in {'.git', '.venv', 'venv', 'node_modules', '.next', '__pycache__', '.pytest_cache'} for p in parts):
            continue
        if any(p.startswith('.env') for p in parts) or relative.suffix in {'.pem', '.key', '.p12', '.pfx'} or relative.name in {'.npmrc', '.netrc'}:
            continue
        if repo_name == 'GRNScope':
            if parts[0] not in {'backend', 'frontend', 'scripts'}:
                continue
            if parts[:2] in {('backend', 'projects'), ('backend', 'temp_uploads'), ('backend', 'tests')}:
                continue
            if relative.name.endswith(' 2.ts') or relative.name == '.DS_Store':
                continue
        else:
            if parts[0] not in {'BLRun', 'BLEval', 'Algorithms', 'utils', 'BLRunner.py'}:
                continue
            if any(p in {'outputs', '.snakemake', '.cache'} for p in parts) or relative.name.startswith('.Dockerfile.'):
                continue
        source = repo / relative
        if not source.is_file():
            continue
        if source.is_symlink():
            # Bundle real content, but never follow a link outside its repository.
            source.resolve().relative_to(repo.resolve())
        destination = stage / repo_name / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        manifest.append({'path': str(Path(repo_name)/relative), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
(stage/'source-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
archive = output/'grnscope-debian13.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    tar.add(stage, arcname='grnscope-debian13')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output/'grnscope-debian13.tar.gz.sha256').write_text(f'{digest}  {archive.name}\n')
print(json.dumps({'archive': str(archive), 'size_mb': round(archive.stat().st_size/1024**2, 1), 'source_files': len(manifest)}))

staging.cleanup()
