"""Compute genuine CellOracle examples from the bundled server-project inputs.

Runs locally through the configured CellOracle Docker image. The read-only demo
is never used as a writable project; an isolated project holds model and runtime
files. Only completed results and CSV exports are copied into the demo bundle.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import PROJECTS_ROOT  # noqa: E402
from app.services.demo_service import get_demo_project_root, load_demo_manifest  # noqa: E402
from app.services.beeline_service import resolve_algorithm_image, resolve_beeline_root  # noqa: E402
from app.services.perturbation_service import (  # noqa: E402
    DOWNLOAD_FILENAMES, compact_run_status, create_perturbation_run,
    eligible_perturbation_genes, get_gene_expression_profile, get_perturbation_result,
    list_run_statuses, read_json, run_perturbation_task,
)
from app.services.run_manifest_service import _sanitize_value  # noqa: E402


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def precompute(genes: list[str] | None = None) -> None:
    demo = get_demo_project_root()
    manifest = load_demo_manifest()
    archived = read_json(demo / 'results/CELLORACLE.json')
    provenance = archived['confidence_summary']['run_metadata']
    parameters = [item['runner_observability']['provenance']['parameters']
                  for item in provenance.values() if item.get('status') == 'Completed']
    if not parameters or any(int(item.get('inputContractVersion', 0)) < 2 or item.get('expressionMode') != 'normalized_log' for item in parameters):
        raise ValueError('The archived CellOracle runs must document corrected log-normalized input preprocessing.')
    fingerprint = {
        'expression': sha256(demo / 'inputs/ExpressionData.csv'),
        'prepared_expression': sha256(demo / 'preprocessed/ExpressionData.csv'),
        'pseudotime': sha256(demo / 'inputs/PseudoTime.csv'),
        'celloracle_network': sha256(demo / 'results/CELLORACLE/rankedEdges.csv'),
    }
    project_id = 'demo-precompute-' + hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()[:12]
    project = PROJECTS_ROOT / project_id
    project.mkdir(parents=True, exist_ok=True)
    for target, source in [('ExpressionData.csv', 'inputs/ExpressionData.csv'), ('PseudoTime.csv', 'inputs/PseudoTime.csv'), ('results/CELLORACLE/rankedEdges.csv', 'results/CELLORACLE/rankedEdges.csv')]:
        path = project / target
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(demo / source, path)
    settings = {
        'project_id': project_id, 'project_name': 'Demo perturbation precomputation',
        'expression_path': str(project / 'ExpressionData.csv'),
        'pseudotime_path': str(project / 'PseudoTime.csv'),
        'preprocessing': manifest['preprocessing'],
    }
    (project / 'project.json').write_text(json.dumps(settings, indent=2))
    (project / 'jobs.json').write_text(json.dumps([{'job_id': 'precompute', 'tasks': [{'algorithm_id': 'CELLORACLE', 'status': 'Completed'}]}]))
    (project / 'results/CELLORACLE/result.json').write_text(json.dumps({
        **archived, 'project_id': project_id,
        'ranked_edges_path': str(project / 'results/CELLORACLE/rankedEdges.csv'),
        'expression_contract': {'version': 2, 'mode': 'normalized_log'},
    }))
    eligible = eligible_perturbation_genes(project)
    selected = genes if genes else eligible[:3]
    if not selected or len(set(selected)) != len(selected) or any(gene not in eligible for gene in selected):
        raise ValueError('Select distinct regulators present in the archived CellOracle network.')
    examples = []
    for gene in selected:
        for mode in ('knockout', 'overexpression'):
            profile = get_gene_expression_profile(project, gene)
            value = 0.0 if mode == 'knockout' else min(profile['safe_upper_limit'], max(profile['maximum'], 2 * profile['mean']))
            if mode == 'overexpression' and value <= 0:
                raise ValueError(f'{gene} has no positive expression range for overexpression.')
            status = next((run for run in list_run_statuses(project)
                           if run.get('status') == 'Completed' and run.get('gene') == gene
                           and run.get('perturbation_value') == value and run.get('n_propagation') == 3
                           and run.get('clip_delta_x') is False), None)
            if status is None:
                status = create_perturbation_run(project, gene=gene, perturbation_value=value, n_propagation=3, clip_delta_x=False)
                print(f'Computing {gene} {mode} (target {value:.5g})...', flush=True)
                run_perturbation_task(project_id, status['run_id'])
                status = read_json(project / 'perturbations/runs' / status['run_id'] / 'status.json')
            if status['status'] != 'Completed':
                raise RuntimeError(f"{gene} {mode} failed: {status.get('error_message')}")
            examples.append(status)
            print(f'Completed {gene} {mode}: {status["elapsed_seconds"]}s', flush=True)
    # Finish every computation before modifying the shipped examples.
    if sha256(project / 'preprocessed/ExpressionData.csv') != fingerprint['prepared_expression']:
        raise ValueError('The simulation prepared matrix differs from the archived server matrix.')
    image = resolve_algorithm_image('CELLORACLE')
    image_record = json.loads(subprocess.run(['docker', 'image', 'inspect', image], check=True, capture_output=True, text=True).stdout)[0]
    runner = resolve_beeline_root() / 'Algorithms/CELLORACLE/runCellOraclePerturbation.py'
    destination = demo / 'perturbations'
    files = {}
    for status in examples:
        run_id = status['run_id']
        run_dir = destination / 'runs' / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        result = _sanitize_value(get_perturbation_result(project, run_id), project)
        (run_dir / 'result.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
        for name in DOWNLOAD_FILENAMES:
            source = project / 'perturbations/runs' / run_id / name
            if source.is_file():
                shutil.copy2(source, run_dir / name)
        for path in run_dir.iterdir():
            files[path.relative_to(destination).as_posix()] = sha256(path)
    package = {
        'schema_version': 1, 'source_project': manifest['provenance']['source_project'],
        'fingerprints': fingerprint, 'runs': [compact_run_status(run) for run in examples],
        'files': files, 'generation': {'runtime': 'CellOracle Docker', 'image': image, 'image_id': image_record['Id'],
                                    'image_architecture': image_record['Architecture'],
                                    'runner_sha256': sha256(runner),
                                    'input_contract_version': 2, 'expression_mode': 'normalized_log'},
    }
    (destination / 'manifest.json').write_text(json.dumps(package, indent=2) + '\n')
    for path in destination.rglob('*'):
        if path.is_file() and path.relative_to(destination).as_posix() not in {*files, 'manifest.json'}:
            path.unlink()
    print(f'Bundled {len(examples)} genuine examples in {destination}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--genes', nargs='+', help='Default: the three regulators with the most inferred outgoing edges.')
    args = parser.parse_args()
    precompute(args.genes)
