"""Read genuine precomputed demo perturbations without creating runtime files."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

from .demo_service import get_demo_project_root, load_demo_manifest
from .perturbation_service import DOWNLOAD_FILENAMES


def load_examples() -> dict:
    root = get_demo_project_root()
    path = root / 'perturbations/manifest.json'
    if not path.is_file():
        return {'runs': [], 'files': {}}
    package = json.loads(path.read_text())
    expected = {
        'expression': root / 'inputs/ExpressionData.csv',
        'prepared_expression': root / 'preprocessed/ExpressionData.csv',
        'pseudotime': root / 'inputs/PseudoTime.csv',
        'celloracle_network': root / 'results/CELLORACLE/rankedEdges.csv',
    }
    if package.get('schema_version') != 1 or package.get('source_project') != load_demo_manifest()['provenance']['source_project']:
        raise ValueError('Saved perturbations do not belong to this demo project.')
    for key, source in expected.items():
        if package.get('fingerprints', {}).get(key) != hashlib.sha256(source.read_bytes()).hexdigest():
            raise ValueError('Saved perturbations do not match the current demo inputs.')
    runs = package.get('runs', [])
    if any(run.get('status') != 'Completed' for run in runs):
        raise ValueError('Demo examples must be completed simulations.')
    return package


def example_file(package: dict, run_id: str, filename: str) -> Path:
    if not run_id or PurePosixPath(run_id).name != run_id or run_id in {'.', '..'}:
        raise FileNotFoundError('Saved perturbation example not found.')
    if not any(run.get('run_id') == run_id for run in package['runs']):
        raise FileNotFoundError('Saved perturbation example not found.')
    if filename not in DOWNLOAD_FILENAMES | {'result.json'}:
        raise FileNotFoundError('Saved perturbation file not found.')
    relative = f'runs/{run_id}/{filename}'
    if relative not in package['files']:
        raise FileNotFoundError('Saved perturbation file not found.')
    root = (get_demo_project_root() / 'perturbations').resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise FileNotFoundError('Saved perturbation file not found.')
    if hashlib.sha256(path.read_bytes()).hexdigest() != package['files'][relative]:
        raise ValueError('Saved perturbation file failed its checksum check.')
    return path


def get_demo_perturbation_result(run_id: str, *, package: dict | None = None) -> dict:
    package = package if package is not None else load_examples()
    result = json.loads(example_file(package, run_id, 'result.json').read_text())
    result['run_id'] = run_id
    result['precomputed'] = True
    return result


def get_demo_perturbation_state() -> dict:
    package = load_examples()
    runs = package['runs']
    return {
        'available': bool(runs), 'read_only': True, 'precomputed': True,
        'reason': None if runs else 'Precomputed CellOracle examples have not been bundled yet.',
        'eligible_genes': list(dict.fromkeys(run['gene'] for run in runs)),
        'runs': runs,
        'latest_result': get_demo_perturbation_result(runs[0]['run_id'], package=package) if runs else None,
    }


def demo_perturbation_download_path(run_id: str, filename: str) -> Path:
    if filename not in DOWNLOAD_FILENAMES:
        raise FileNotFoundError('Saved perturbation download not found.')
    return example_file(load_examples(), run_id, filename)
