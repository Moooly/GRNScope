"""Species and assembly boundaries for chromosome coordinates returned to Circos."""
import asyncio
import gzip
import hashlib
import json
from unittest.mock import patch

from fastapi import Response
import pytest
from starlette.requests import Request

from app.api import results
from app.services import gene_coordinate_service as coordinates


@pytest.mark.parametrize('species,symbol,chromosome,assembly', [
    ('human', 'SOX9', 'chr17', 'GRCh38'),
    ('mouse', 'Sox9', 'chr11', 'GRCm39'),
    ('mouse', 'Pax6', 'chr2', 'GRCm39'),
    ('human', 'PAX6', 'chr11', 'GRCh38'),
    ('mouse', 'Gata1', 'chrX', 'GRCm39'),
])
def test_reference_coordinates_are_species_specific(species, symbol, chromosome, assembly):
    value = coordinates.get_gene_coordinate(symbol, species)
    assert value is not None
    assert value['chromosome'] == chromosome
    assert value['coordinate_species'] == species
    assert value['coordinate_assembly'] == assembly
    assert 0 < value['start'] < value['end']


def test_shared_symbols_and_cache_entries_do_not_mix_species():
    human = coordinates.get_gene_coordinate('SOX9', 'human')
    mouse = coordinates.get_gene_coordinate('SOX9', 'mouse')
    assert human['chromosome'] == 'chr17'
    assert mouse['chromosome'] == 'chr11'
    assert human['gene_id'].startswith('ENSG')
    assert mouse['gene_id'].startswith('ENSMUSG')
    assert coordinates.get_gene_coordinate('Sox9', 'mouse')['start'] == mouse['start']
    assert coordinates.get_gene_coordinate('SOX9', 'human')['start'] == human['start']


def test_mouse_gene_and_transcript_ids_use_the_mouse_reference():
    gene = coordinates.get_gene_coordinate('Sox9', 'mouse')
    assert coordinates.get_gene_coordinate(gene['gene_id'].split('.')[0], 'mouse')['start'] == gene['start']
    with gzip.open(coordinates.MOUSE_TRANSCRIPT_COORDINATES_PATH, 'rt') as source:
        import csv
        transcript = next(row for row in csv.DictReader(source, delimiter='\t') if row['gene_name'] == 'Sox9')
    value = coordinates.get_gene_coordinate(transcript['transcript_id_base'], 'mouse')
    assert value['gene_name'] == 'Sox9'
    assert value['chromosome'] == 'chr11'
    assert value['coordinate_assembly'] == 'GRCm39'
    assert value['start'] == int(transcript['start'])
    assert coordinates.get_gene_coordinate(gene['gene_id'], 'human') is None


@pytest.mark.parametrize('species', [None, '', 'rat', 'other', 'zebrafish'])
def test_unknown_and_unsupported_species_never_search_human_coordinates(species):
    with patch.object(coordinates, 'load_gene_coordinate_index', side_effect=AssertionError('Unexpected coordinate lookup')):
        assert coordinates.get_gene_coordinate('SOX9', species) is None
    assert coordinates.get_coordinate_reference(species) is None


def test_explicit_project_species_is_required_and_not_taken_from_celloracle_defaults():
    assert coordinates.project_coordinate_species({'celloracle': {'species': 'human'}}) is None
    assert coordinates.project_coordinate_species({'preprocessing': {'dataset_species': 'mouse'}}) == 'mouse'
    assert coordinates.project_coordinate_species({'preprocessing': {'dataset_species': 'rat'}, 'celloracle': {'species': 'human'}}) is None


def test_human_demo_alias_still_resolves_only_in_human_reference():
    assert coordinates.get_gene_coordinate('WT1pKTS', 'human')['matched_gene_name'] == 'WT1'
    assert coordinates.get_gene_coordinate('WT1pKTS', 'mouse') is None


def test_result_route_uses_project_species_and_replaces_stale_saved_annotations(tmp_path):
    client_id = 'qa_coordinate_contracts_20261101'
    project = tmp_path / 'qa-project'
    project.mkdir()
    manifest = {'project_id': 'qa-project', 'owner_id': client_id, 'preprocessing': {'dataset_species': 'mouse'}}
    manifest_path = project / 'project.json'
    manifest_path.write_text(json.dumps(manifest))
    stored = {'algorithm_id': 'GENIE3', 'top_edges': [{'source': 'Sox9', 'target': 'Pax6', 'score': 0.9}],
              'gene_coordinates': {'Sox9': coordinates.get_gene_coordinate('SOX9', 'human')}}
    request = Request({'type': 'http', 'method': 'GET', 'path': '/',
                       'headers': [(b'x-grnscope-client-id', client_id.encode())]})
    with patch.object(results, 'PROJECTS_ROOT', tmp_path), patch.object(results, 'read_algorithm_result', return_value=stored), patch.object(results, 'attach_beeline_path_stats', side_effect=lambda value, directory: value):
        response = asyncio.run(results.get_algorithm_result('qa-project', 'GENIE3', request, Response()))
        assert response['result']['genome_reference']['assembly'] == 'GRCm39'
        assert response['result']['gene_coordinates']['Sox9']['chromosome'] == 'chr11'
        manifest['preprocessing']['dataset_species'] = 'rat'
        manifest_path.write_text(json.dumps(manifest))
        response = asyncio.run(results.get_algorithm_result('qa-project', 'GENIE3', request, Response()))
        assert response['result']['genome_reference'] is None
        assert response['result']['gene_coordinates'] == {}
        assert response['result']['gene_coordinate_count'] == 0


def test_packaged_mouse_reference_matches_recorded_checksums():
    root = coordinates.GENCODE_REFERENCE_DIR
    provenance = json.loads((root / 'gencode_vM39_provenance.json').read_text())
    assert provenance['species'] == 'mouse'
    assert provenance['assembly'] == 'GRCm39'
    assert provenance['counts']['gene'] > 50000
    for filename, expected in provenance['files'].items():
        with (root / filename).open('rb') as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected


@pytest.mark.parametrize('identifier,species', [
    ('ENSMUSG00000000567', 'human'), ('ENSMUST00000102956', 'human'),
    ('ENSG00000125398', 'mouse'), ('ENST00000245479', 'mouse'),
])
def test_foreign_ensembl_ids_do_not_search_another_reference(identifier, species):
    with patch.object(coordinates, 'load_gene_coordinate_index', side_effect=AssertionError('Cross-species lookup')):
        assert coordinates.get_gene_coordinate(identifier, species) is None
