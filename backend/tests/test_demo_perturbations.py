"""Real precomputed demo simulations remain public, portable and read-only."""
import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.api.perturbations import (
    PerturbationRunRequest, download_perturbation_result,
    get_project_perturbation_result, get_project_perturbations, start_project_perturbation,
)
from app.services import demo_perturbation_service as service
from app.services.demo_service import get_demo_project_root


def request():
    return Request({'type': 'http', 'method': 'GET', 'path': '/', 'headers': []})


def test_examples_are_real_completed_results_for_current_inputs():
    root = get_demo_project_root() / 'perturbations'
    package = service.load_examples()
    assert len(package['runs']) == 6
    assert package['generation']['runtime'] == 'CellOracle Docker'
    assert package['generation']['input_contract_version'] == 2
    for name, digest in package['files'].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
    assert {run['gene'] for run in package['runs']} == {'FOXL2', 'NR5A1', 'NR0B1'}
    for gene in {'FOXL2', 'NR5A1', 'NR0B1'}:
        values = [run['perturbation_value'] for run in package['runs'] if run['gene'] == gene]
        assert len(values) == 2 and 0 in values and max(values) > 0
    for run in package['runs']:
        result = service.get_demo_perturbation_result(run['run_id'])
        assert result['precomputed'] is True
        assert result['cells_analyzed'] == 2000
        assert result['top_affected_genes']
        assert result['grid_vectors']
        assert result['development_vectors']
        assert result['gene_expression_distributions']
        assert result['gene'] == run['gene']
        assert result['perturbation_value'] == run['perturbation_value']
        assert '/Users/' not in json.dumps(result)


def test_demo_api_serves_examples_and_downloads_but_never_launches_runs():
    state = asyncio.run(get_project_perturbations('demo', request(), Response()))['perturbations']
    assert state['available'] and state['read_only'] and state['precomputed']
    for run in state['runs']:
        payload = asyncio.run(get_project_perturbation_result('demo', run['run_id'], request(), Response()))
        assert payload['result']['gene'] == run['gene']
        download = asyncio.run(download_perturbation_result('demo', run['run_id'], 'affected_genes.csv', request(), Response()))
        assert Path(download.path).is_file()
    with patch('app.api.perturbations.create_perturbation_run') as create:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(start_project_perturbation('demo', PerturbationRunRequest(gene='FOXL2'), request(), Response()))
        assert exc.value.status_code == 403
        create.assert_not_called()
    for run_id, filename in [('not-a-bundled-run', 'affected_genes.csv'), ('../model', 'result.json'), (state['runs'][0]['run_id'], '../../manifest.json')]:
        with pytest.raises(FileNotFoundError):
            service.demo_perturbation_download_path(run_id, filename)


def test_changed_inputs_cannot_reuse_old_examples():
    with patch.object(service.hashlib, 'sha256') as digest:
        digest.return_value.hexdigest.return_value = 'mismatched-input'
        with pytest.raises(ValueError, match='do not match'):
            service.load_examples()
