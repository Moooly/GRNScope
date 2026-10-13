"""Support for reading current and legacy project manifests."""

from __future__ import annotations

from pathlib import Path

from ..atomic_io import atomic_write_json
from ..config import PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest
from ..repositories.project_repository import (
    read_project_manifest,
    write_project_manifest,
)
from .beeline_service import (
    collect_expression_matrix_issues,
    count_expression_gene_rows,
    read_delimited_header,
    summarize_expression_matrix_issues,
)
from .job_service import mark_project_setup_failure
from .tf_reference_service import load_species_tf_reference


def load_known_tf_gene_names(dataset_species: str = "human") -> list[str]:
    genes, _reference = load_species_tf_reference(
        dataset_species,
        reference_root=PROJECTS_ROOT.parent,
    )
    return genes


def backfill_dataset_dimensions(
    project_dir: Path,
    project_manifest: dict,
    metadata_manifest: dict,
) -> tuple[dict, dict]:
    if metadata_manifest.get("gene_count") and metadata_manifest.get("cell_count"):
        return project_manifest, metadata_manifest

    expression_path = project_manifest.get("expression_path")
    if not expression_path:
        return project_manifest, metadata_manifest

    source_expression = Path(str(expression_path))
    if not source_expression.exists():
        return project_manifest, metadata_manifest

    try:
        header, _dialect = read_delimited_header(source_expression)
        gene_count = count_expression_gene_rows(source_expression)
        cell_count = max(0, len(header) - 1)
    except Exception:
        return project_manifest, metadata_manifest

    if gene_count <= 0 or cell_count <= 0:
        return project_manifest, metadata_manifest

    project_manifest["gene_count"] = gene_count
    project_manifest["cell_count"] = cell_count
    metadata_manifest["gene_count"] = gene_count
    metadata_manifest["cell_count"] = cell_count

    try:
        write_project_manifest(project_dir, project_manifest)
        atomic_write_json(project_dir / "metadata.json", metadata_manifest)
    except Exception:
        pass

    return project_manifest, metadata_manifest


def migrate_legacy_matrix_validation_failure(
    project_dir: Path,
    jobs_manifest: list[dict],
) -> list[dict]:
    """Upgrade jobs created before matrix validation became a setup phase."""

    job = jobs_manifest[-1] if jobs_manifest else None
    if not isinstance(job, dict):
        return jobs_manifest

    try:
        project_manifest = read_project_manifest(project_dir)
        needs_structured_issues = (
            project_manifest.get("dataset_validation_status") == "failed"
            and (
                not project_manifest.get("dataset_validation_issues")
                or not (project_dir / "matrix_validation_issues.csv").exists()
            )
        )
        expression_path = project_manifest.get("expression_path")
        if needs_structured_issues and expression_path and Path(expression_path).exists():
            validation_issues = collect_expression_matrix_issues(
                Path(expression_path),
                report_path=project_dir / "matrix_validation_issues.csv",
            )
            if validation_issues:
                mark_project_setup_failure(
                    project_dir,
                    str(job.get("job_id") or ""),
                    summarize_expression_matrix_issues(validation_issues),
                    error_type="matrix_validation",
                    validation_issues=validation_issues,
                )
                return read_jobs_manifest(project_dir)
    except Exception:
        pass

    validation_task = next(
        (
            task
            for task in job.get("tasks", [])
            if isinstance(task, dict)
            and task.get("error_type") == "matrix_validation"
        ),
        None,
    )
    if validation_task is not None:
        mark_project_setup_failure(
            project_dir,
            str(job.get("job_id") or ""),
            str(
                validation_task.get("error_message")
                or "The uploaded expression matrix could not be validated."
            ),
            error_type="matrix_validation",
        )
        return read_jobs_manifest(project_dir)
    return jobs_manifest
