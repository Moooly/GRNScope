from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .schemas import CreateProjectResponse, TempUploadResponse
from .storage import (
    create_temp_upload_id,
    move_temp_upload_to_project,
    save_json,
    temp_expression_path,
    temp_metadata_path,
    temp_pseudotime_path,
)
from .validators import (
    MAX_FILE_SIZE_BYTES,
    parse_expression_matrix,
    parse_pseudotime,
    validate_csv_extension,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOB_FILE_LOCK = threading.Lock()

PROJECTS_ROOT = Path(__file__).resolve().parent.parent / "projects"
PROJECT_ROOT = Path(__file__).resolve().parent.parent

BEELINE_ROOT_CANDIDATES = [
    Path(os.environ.get("BEELINE_ROOT", "")).expanduser() if os.environ.get("BEELINE_ROOT") else None,
    Path("/Users/molyloo/Documents/TRU/Beeline"),
    PROJECT_ROOT.parent / "Beeline",
    PROJECT_ROOT.parent / "beeline",
    Path.home() / "Beeline",
    Path.home() / "beeline",
]


ALGORITHM_IMAGE_MAP = {
    "GENIE3": "grnbeeline/arboreto:base",
    "GRISLI": "grnbeeline/grisli:base",
    "GRNBOOST2": "grnbeeline/arboreto:base",
    "GRNVBEM": "grnbeeline/grnvbem:base",
    "JUMP3": "jump3:base",
    "LEAP": "grnbeeline/leap:base",
    "PEARSON": "local",
    "PIDC": "grnbeeline/pidc:base",
    "PPCOR": "grnbeeline/ppcor:base",
    "SCODE": "grnbeeline/scode:base",
    "SCRIBE": "grnbeeline/scribe:base",
    "SCSGL": "scsgl:base",
    "SINCERITIES": "grnbeeline/sincerities:base",
    "SINGE": "grnbeeline/singe:0.4.1",
}

# Default parameters for algorithms that require them
ALGORITHM_DEFAULT_PARAMS = {
    "PPCOR": {
        "pVal": [0.05],
    },
}


def resolve_beeline_root() -> Path:
    for candidate in BEELINE_ROOT_CANDIDATES:
        if not candidate:
            continue
        blrunner_path = candidate / "BLRunner.py"
        if candidate.exists() and blrunner_path.exists():
            return candidate
    raise FileNotFoundError(
        "BEELINE repository not found. Set BEELINE_ROOT to the local Beeline repo path."
    )


def yaml_scalar(value: str) -> str:
    return json.dumps(str(value))


def prepare_beeline_runtime(
    project_id: str,
    algorithm_id: str,
    project_manifest: dict,
) -> tuple[Path, Path, Path, str, str]:
    runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / algorithm_id
    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    input_dir = runtime_root / "inputs"
    output_dir = runtime_root / "outputs"
    dataset_id = project_id
    run_id = "run-1"
    run_dir = input_dir / dataset_id / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    expression_path = project_manifest.get("expression_path")
    pseudotime_path = project_manifest.get("pseudotime_path")

    if not expression_path:
        raise FileNotFoundError("Project expression_path is missing.")

    source_expression = Path(expression_path)
    if not source_expression.exists():
        raise FileNotFoundError("Expression matrix file not found on disk.")

    shutil.copy2(source_expression, run_dir / "ExpressionData.csv")

    if pseudotime_path:
        source_pseudotime = Path(pseudotime_path)
        if source_pseudotime.exists():
            shutil.copy2(source_pseudotime, run_dir / "PseudoTime.csv")

    return runtime_root, input_dir, output_dir, dataset_id, run_id


def build_beeline_config(
    input_dir: Path,
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
    include_pseudotime: bool,
) -> str:
    normalized_algorithm_id = algorithm_id.upper()
    image_name = ALGORITHM_IMAGE_MAP.get(normalized_algorithm_id)
    if not image_name:
        raise ValueError(f"Unsupported BEELINE algorithm: {algorithm_id}")

    run_lines = [
        f"        - run_id: {yaml_scalar(run_id)}",
        '          exprData: "ExpressionData.csv"',
    ]
    if include_pseudotime:
        run_lines.append('          pseudoTimeData: "PseudoTime.csv"')

    params = ALGORITHM_DEFAULT_PARAMS.get(normalized_algorithm_id, {})

    config_lines = [
        "input_settings:",
        f"  input_dir: {yaml_scalar(input_dir)}",
        "  datasets:",
        f"    - dataset_id: {yaml_scalar(dataset_id)}",
        "      should_run: [True]",
        "      runs:",
        *run_lines,
        "  algorithms:",
        f"    - algorithm_id: {yaml_scalar(normalized_algorithm_id)}",
        f"      image: {yaml_scalar(image_name)}",
        "      should_run: [True]",
        "      params:",
    ]

    if params:
        for key, value in params.items():
            config_lines.append(f"        {key}: {json.dumps(value)}")
    else:
        config_lines.append("        {}")

    config_lines.extend(
        [
            "output_settings:",
            f"  output_dir: {yaml_scalar(output_dir)}",
        ]
    )
    return "\n".join(config_lines) + "\n"


def parse_ranked_edges_csv(ranked_edges_path: Path) -> tuple[list[dict], dict]:
    if not ranked_edges_path.exists():
        raise FileNotFoundError(f"rankedEdges.csv not found at {ranked_edges_path}")

    raw_text = ranked_edges_path.read_text(encoding="utf-8")
    if not raw_text.strip():
        raise ValueError("rankedEdges.csv is empty.")

    sample = raw_text[:4096]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        delimiter = dialect.delimiter
    except csv.Error:
        first_line = raw_text.splitlines()[0] if raw_text.splitlines() else ""
        if "\t" in first_line:
            delimiter = "\t"
        elif ";" in first_line:
            delimiter = ";"

    reader = csv.DictReader(io.StringIO(raw_text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    rows = list(reader)

    if not fieldnames:
        raise ValueError("rankedEdges.csv has no header row.")

    normalized_field_map = {
        key.strip().replace('"', ""): key for key in fieldnames if key is not None
    }

    def find_field(candidates: list[str]) -> str | None:
        for candidate in candidates:
            if candidate in normalized_field_map:
                return normalized_field_map[candidate]
        return None

    source_key = find_field(["Gene1", "TF", "source", "Source"])
    target_key = find_field(["Gene2", "Target", "target", "TargetGene"])
    score_key = find_field(["EdgeWeight", "weight", "score", "Score"])

    if source_key is None or target_key is None:
        raise ValueError(
            f"Could not identify source/target columns in rankedEdges.csv. Found columns: {fieldnames}"
        )

    if score_key is None:
        numeric_candidates: list[str] = []
        for key in fieldnames:
            sample_value = None
            for row in rows:
                value = row.get(key)
                if value not in (None, ""):
                    sample_value = str(value).strip()
                    break
            if sample_value is None:
                continue
            try:
                float(sample_value)
                numeric_candidates.append(key)
            except (TypeError, ValueError):
                continue
        score_key = numeric_candidates[-1] if numeric_candidates else None

    if score_key is None:
        raise ValueError(
            f"Could not identify a score column in rankedEdges.csv. Found columns: {fieldnames}"
        )

    parsed_edges: list[dict] = []
    node_names: set[str] = set()

    for row in rows:
        source = str(row.get(source_key, "")).strip()
        target = str(row.get(target_key, "")).strip()
        score_raw = str(row.get(score_key, "")).strip()

        if not source or not target:
            continue

        try:
            score = float(score_raw)
        except (TypeError, ValueError):
            continue

        parsed_edges.append(
            {
                "source": source,
                "target": target,
                "score": score,
            }
        )
        node_names.add(source)
        node_names.add(target)

    if not parsed_edges:
        raise ValueError("rankedEdges.csv did not contain any valid edges.")

    return parsed_edges, {
        "edge_count": len(parsed_edges),
        "node_count": len(node_names),
    }


def execute_beeline_algorithm(project_id: str, algorithm_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = read_project_manifest(project_dir)
    beeline_root = resolve_beeline_root()

    runtime_root, input_dir, output_dir, dataset_id, run_id = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_id=run_id,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
    )
    config_path.write_text(config_text, encoding="utf-8")

    python_executable = os.environ.get("BEELINE_PYTHON", sys.executable)
    command = [python_executable, "BLRunner.py", "-c", str(config_path)]

    completed_process = subprocess.run(
        command,
        cwd=beeline_root,
        capture_output=True,
        text=True,
        check=False,
    )

    (runtime_root / "stdout.log").write_text(
        completed_process.stdout or "",
        encoding="utf-8",
    )
    (runtime_root / "stderr.log").write_text(
        completed_process.stderr or "",
        encoding="utf-8",
    )

    if completed_process.returncode != 0:
        raise RuntimeError(
            f"BEELINE failed for {algorithm_id}. See {runtime_root / 'stderr.log'} for details."
        )

    ranked_edges_path = output_dir / dataset_id / run_id / algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }


async def save_upload_file(upload: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE_BYTES:
                raise ValueError("File size must be 500 MB or smaller.")
            f.write(chunk)
    await upload.close()
    return size


# --- Project and job helper functions ---

def read_project_manifest(project_dir: Path) -> dict:
    project_path = project_dir / "project.json"
    if not project_path.exists():
        raise FileNotFoundError("Project manifest not found.")
    return json.loads(project_path.read_text(encoding="utf-8"))


def list_project_directories() -> list[Path]:
    projects_root = PROJECTS_ROOT
    if not projects_root.exists():
        return []
    return [path for path in projects_root.iterdir() if path.is_dir()]


def read_jobs_manifest(project_dir: Path) -> list[dict]:
    jobs_path = project_dir / "jobs.json"
    if not jobs_path.exists():
        return []
    return json.loads(jobs_path.read_text(encoding="utf-8"))


def write_jobs_manifest(project_dir: Path, jobs_manifest: list[dict]) -> None:
    jobs_path = project_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs_manifest, indent=2), encoding="utf-8")


# --- Algorithm result helpers ---

def ensure_results_dir(project_dir: Path) -> Path:
    results_dir = project_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return results_dir


def algorithm_result_path(project_dir: Path, algorithm_id: str) -> Path:
    return ensure_results_dir(project_dir) / f"{algorithm_id}.json"


def write_algorithm_result(
    project_dir: Path,
    algorithm_id: str,
    result_payload: dict,
) -> str:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    result_path.write_text(json.dumps(result_payload, indent=2), encoding="utf-8")
    return str(result_path)


def read_algorithm_result(project_dir: Path, algorithm_id: str) -> dict:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    if not result_path.exists():
        raise FileNotFoundError(f"Result for {algorithm_id} not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))


def update_job_state(
    project_dir: Path,
    job_id: str,
    *,
    overall_status: str | None = None,
    algorithm_id: str | None = None,
    task_status: str | None = None,
    elapsed_seconds: int | None = None,
    error_message: str | None = None,
    result_path: str | None = None,
    progress_percent: int | None = None,
    progress_label: str | None = None,
    completed_at: str | None = None,
) -> None:
    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            if overall_status is not None:
                job["overall_status"] = overall_status

            if algorithm_id is not None:
                for task in job.get("tasks", []):
                    if task.get("algorithm_id") != algorithm_id:
                        continue

                    if task_status is not None:
                        task["status"] = task_status
                    if elapsed_seconds is not None:
                        task["elapsed_seconds"] = elapsed_seconds
                    if error_message is not None or task_status == "Failed":
                        task["error_message"] = error_message
                    if result_path is not None:
                        task["result_path"] = result_path
                    if progress_percent is not None:
                        task["progress_percent"] = progress_percent
                    if progress_label is not None:
                        task["progress_label"] = progress_label
                    if completed_at is not None:
                        task["completed_at"] = completed_at
                    break

            write_jobs_manifest(project_dir, jobs_manifest)
            return


# --- BEELINE execution with progress reporting ---

def run_beeline_with_progress(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = read_project_manifest(project_dir)
    beeline_root = resolve_beeline_root()

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=5,
        progress_label="Preparing runtime",
    )

    runtime_root, input_dir, output_dir, dataset_id, run_id = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_id=run_id,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
    )
    config_path.write_text(config_text, encoding="utf-8")

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=15,
        progress_label="Launching BEELINE",
    )

    python_executable = os.environ.get("BEELINE_PYTHON", sys.executable)
    command = [python_executable, "BLRunner.py", "-c", str(config_path)]

    started_at = time.time()
    process = subprocess.Popen(
        command,
        cwd=beeline_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    while process.poll() is None:
        elapsed = int(time.time() - started_at)
        synthetic_progress = min(85, 20 + elapsed // 2)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            elapsed_seconds=elapsed,
            progress_percent=synthetic_progress,
            progress_label="Running BEELINE",
        )
        time.sleep(1)

    stdout_text, stderr_text = process.communicate()

    (runtime_root / "stdout.log").write_text(stdout_text or "", encoding="utf-8")
    (runtime_root / "stderr.log").write_text(stderr_text or "", encoding="utf-8")

    if process.returncode != 0:
        raise RuntimeError(
            f"BEELINE failed for {algorithm_id}. See {runtime_root / 'stderr.log'} for details."
        )

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label="Parsing ranked edges",
    )

    ranked_edges_path = output_dir / dataset_id / run_id / algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=98,
        progress_label="Finalizing result",
    )

    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }


def recompute_overall_status(project_dir: Path, job_id: str) -> None:
    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            tasks = job.get("tasks", [])
            statuses = [task.get("status") for task in tasks]

            if any(status == "Failed" for status in statuses):
                job["overall_status"] = "Failed"
            elif statuses and all(status == "Completed" for status in statuses):
                job["overall_status"] = "Completed"
            elif any(status == "Running" for status in statuses):
                job["overall_status"] = "Running"
            elif statuses and all(status == "Queued" for status in statuses):
                job["overall_status"] = "Queued"
            else:
                job["overall_status"] = "Running"

            write_jobs_manifest(project_dir, jobs_manifest)
            return


def run_single_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    started_at = time.time()
    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        task_status="Running",
        elapsed_seconds=0,
        error_message=None,
        progress_percent=1,
        progress_label="Starting",
    )
    recompute_overall_status(project_dir, job_id)

    try:
        beeline_result = run_beeline_with_progress(project_id, job_id, algorithm_id)

        elapsed = int(time.time() - started_at)
        completed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

        actual_result = {
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "status": "Completed",
            "generated_at": completed_at,
            "elapsed_seconds": elapsed,
            "network_summary": beeline_result["network_summary"],
            "top_edges": beeline_result["top_edges"],
            "beeline_runtime_root": beeline_result["runtime_root"],
            "ranked_edges_path": beeline_result["ranked_edges_path"],
        }

        saved_result_path = write_algorithm_result(
            project_dir,
            algorithm_id,
            actual_result,
        )

        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Completed",
            elapsed_seconds=elapsed,
            error_message=None,
            result_path=saved_result_path,
            progress_percent=100,
            progress_label="Completed",
            completed_at=completed_at,
        )
    except Exception as exc:
        elapsed = int(time.time() - started_at)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Failed",
            elapsed_seconds=elapsed,
            progress_percent=0,
            progress_label="Failed",
            error_message=str(exc),
        )
    finally:
        recompute_overall_status(project_dir, job_id)


def launch_independent_algorithm_tasks(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    update_job_state(project_dir, job_id, overall_status="Running")

    for algorithm_id in selected_algorithms_list:
        worker = threading.Thread(
            target=run_single_algorithm_task,
            args=(project_id, job_id, algorithm_id),
            daemon=True,
        )
        worker.start()

@app.get("/api/projects/{project_id}/download/expression")
async def download_expression_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        expression_path = project_manifest.get("expression_path")
        expression_filename = metadata.get("expression_filename") or "dataset.csv"

        if not expression_path:
            raise HTTPException(status_code=404, detail="Expression file path not found.")

        file_path = Path(expression_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Expression file not found.")

        return FileResponse(
            path=file_path,
            filename=expression_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/download/pseudotime")
async def download_pseudotime_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        pseudotime_path = project_manifest.get("pseudotime_path")
        pseudotime_filename = metadata.get("pseudotime_filename") or "pseudotime.csv"

        if not pseudotime_path:
            raise HTTPException(status_code=404, detail="Pseudotime file path not found.")

        file_path = Path(pseudotime_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Pseudotime file not found.")

        return FileResponse(
            path=file_path,
            filename=pseudotime_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    
@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        shutil.rmtree(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/uploads/temp-dataset", response_model=TempUploadResponse)
async def temp_dataset_upload(
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(default=None),
):
    errors: list[str] = []

    expression_ext_error = validate_csv_extension(expression_matrix.filename or "")
    if expression_ext_error:
        errors.append(f"Expression matrix: {expression_ext_error}")

    if pseudotime:
        pseudo_ext_error = validate_csv_extension(pseudotime.filename or "")
        if pseudo_ext_error:
            errors.append(f"Pseudotime: {pseudo_ext_error}")

    if errors:
        return TempUploadResponse(ok=False, errors=errors)

    temp_upload_id = create_temp_upload_id()
    expression_path = temp_expression_path(
        temp_upload_id, expression_matrix.filename or "expression.csv"
    )

    pseudotime_path: Path | None = None
    if pseudotime:
        pseudotime_path = temp_pseudotime_path(
            temp_upload_id, pseudotime.filename or "pseudotime.csv"
        )

    try:
        await save_upload_file(expression_matrix, expression_path)
        expression_info = parse_expression_matrix(expression_path)

        pseudotime_info = None
        if pseudotime and pseudotime_path is not None:
            await save_upload_file(pseudotime, pseudotime_path)
            pseudotime_info = parse_pseudotime(
                pseudotime_path, expression_info["cell_count"]
            )

        metadata = {
            "temp_upload_id": temp_upload_id,
            "expression_path": str(expression_path),
            "pseudotime_path": str(pseudotime_path) if pseudotime_path else None,
            "expression_filename": expression_matrix.filename,
            "pseudotime_filename": pseudotime.filename if pseudotime else None,
            "gene_count": expression_info["gene_count"],
            "cell_count": expression_info["cell_count"],
            "gene_names": expression_info["gene_names"],
            "cell_names": expression_info["cell_names"],
            "has_pseudotime": pseudotime is not None,
            "pseudotime_count": (
                pseudotime_info["pseudotime_count"] if pseudotime_info else None
            ),
        }
        save_json(temp_metadata_path(temp_upload_id), metadata)

        return TempUploadResponse(
            ok=True,
            temp_upload_id=temp_upload_id,
            expression_filename=expression_matrix.filename,
            pseudotime_filename=pseudotime.filename if pseudotime else None,
            gene_count=expression_info["gene_count"],
            cell_count=expression_info["cell_count"],
            has_pseudotime=pseudotime is not None,
            errors=[],
        )
    except Exception as e:
        if expression_path.exists():
            expression_path.unlink()
        if pseudotime_path and pseudotime_path.exists():
            pseudotime_path.unlink()

        meta_path = temp_metadata_path(temp_upload_id)
        if meta_path.exists():
            meta_path.unlink()

        return TempUploadResponse(ok=False, errors=[str(e)])


@app.post("/api/projects/create-from-temp", response_model=CreateProjectResponse)
async def create_project_from_temp(
    background_tasks: BackgroundTasks,
    temp_upload_id: str = Form(...),
    project_name: str = Form(...),
    project_description: str = Form(""),
    top_variable_genes: str = Form(...),
    include_all_tfs: str = Form(...),
    normalize_enabled: str = Form(...),
    log_transform_enabled: str = Form(...),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
):
    meta_path = temp_metadata_path(temp_upload_id)
    if not meta_path.exists():
        return CreateProjectResponse(
            ok=False,
            errors=["Temporary upload not found or expired."],
        )

    project_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    try:
        move_result = move_temp_upload_to_project(temp_upload_id, project_id)

        project_dir = Path(move_result["project_dir"])
        selected_algorithms_list = json.loads(selected_algorithms)

        upload_metadata_path = project_dir / "upload_metadata.json"
        upload_metadata = {}
        if upload_metadata_path.exists():
            upload_metadata = json.loads(
                upload_metadata_path.read_text(encoding="utf-8")
            )

        job_manifest = {
            "job_id": job_id,
            "project_id": project_id,
            "overall_status": "Queued",
            "ensemble_enabled": ensemble_enabled,
            "tasks": [
                {
                    "algorithm_id": algorithm_id,
                    "status": "Queued",
                    "elapsed_seconds": 0,
                    "error_message": None,
                    "result_path": None,
                    "completed_at": None,
                    "progress_percent": 0,
                    "progress_label": "Queued",
                }
                for algorithm_id in selected_algorithms_list
            ],
        }

        project_manifest = {
            "project_id": project_id,
            "project_name": project_name,
            "project_description": project_description,
            "created_at": time.time(),
            "created_at_display": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
            "selected_algorithms": selected_algorithms_list,
            "ensemble_enabled": ensemble_enabled,
            "expression_path": move_result["expression_path"],
            "pseudotime_path": move_result.get("pseudotime_path"),
            "latest_job_id": job_id,
        }

        metadata_manifest = {
            "project_id": project_id,
            "project_name": project_name,
            "project_description": project_description,
            "expression_filename": upload_metadata.get("expression_filename"),
            "pseudotime_filename": upload_metadata.get("pseudotime_filename"),
            "gene_count": upload_metadata.get("gene_count"),
            "cell_count": upload_metadata.get("cell_count"),
            "gene_names": upload_metadata.get("gene_names", []),
            "cell_names": upload_metadata.get("cell_names", []),
            "has_pseudotime": upload_metadata.get("has_pseudotime"),
            "pseudotime_count": upload_metadata.get("pseudotime_count"),
            "preprocessing": {
                "top_variable_genes": top_variable_genes,
                "include_all_tfs": include_all_tfs,
                "normalize_enabled": normalize_enabled,
                "log_transform_enabled": log_transform_enabled,
            },
            "selected_algorithms": selected_algorithms_list,
            "results_directory": str(project_dir / "results"),
            "ensemble_enabled": ensemble_enabled,
            "job": {
                "job_id": job_id,
                "overall_status": "Queued",
            },
        }

        (project_dir / "project.json").write_text(
            json.dumps(project_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "metadata.json").write_text(
            json.dumps(metadata_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "jobs.json").write_text(
            json.dumps([job_manifest], indent=2),
            encoding="utf-8",
        )

        if upload_metadata_path.exists():
            upload_metadata_path.unlink()

        background_tasks.add_task(
            launch_independent_algorithm_tasks,
            project_id,
            job_id,
            selected_algorithms_list,
        )

        return CreateProjectResponse(
            ok=True,
            project_id=project_id,
            job_id=job_id,
            errors=[],
        )
    except Exception as e:
        return CreateProjectResponse(ok=False, errors=[str(e)])


# --- Job monitoring endpoints ---

@app.get("/api/projects")
async def list_projects():
    try:
        project_items = []

        for project_dir in list_project_directories():
            try:
                project_manifest = read_project_manifest(project_dir)
                jobs_manifest = read_jobs_manifest(project_dir)
                latest_job = jobs_manifest[-1] if jobs_manifest else None

                created_at = project_manifest.get("created_at")
                if not created_at:
                    try:
                        created_at = project_dir.stat().st_mtime
                    except Exception:
                        created_at = 0

                project_items.append(
                    {
                        "id": project_manifest.get("project_id", project_dir.name),
                        "name": project_manifest.get("project_name", project_dir.name),
                        "description": project_manifest.get(
                            "project_description",
                            "Single-cell RNA-seq dataset for GRN inference.",
                        ),
                        "createdAt": project_manifest.get(
                            "created_at_display", "Unknown"
                        ),
                        "datasetCount": 1,
                        "jobCount": len(jobs_manifest) if jobs_manifest else 0,
                        "latestJob": latest_job,
                        "created_at_sort": created_at,
                    }
                )
            except Exception:
                continue

        project_items.sort(
            key=lambda item: item.get("created_at_sort", 0), reverse=True
        )

        for item in project_items:
            item.pop("created_at_sort", None)

        return {
            "ok": True,
            "projects": project_items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        project_manifest = read_project_manifest(project_dir)
        jobs_manifest = read_jobs_manifest(project_dir)

        latest_job = jobs_manifest[-1] if jobs_manifest else None

        return {
            "ok": True,
            "project": project_manifest,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/metadata")
async def get_project_metadata(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return {
            "ok": True,
            "project_id": project_id,
            "metadata": metadata,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.get("/api/projects/{project_id}/jobs")
async def get_project_jobs(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
            "jobs": jobs_manifest,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Result endpoints ---


@app.get("/api/projects/{project_id}/results")
async def get_project_results(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None

        if not latest_job:
            return {
                "ok": True,
                "project_id": project_id,
                "results": [],
            }

        results = []
        for task in latest_job.get("tasks", []):
            results.append(
                {
                    "algorithm_id": task.get("algorithm_id"),
                    "status": task.get("status"),
                    "result_path": task.get("result_path"),
                    "completed_at": task.get("completed_at"),
                    "elapsed_seconds": task.get("elapsed_seconds"),
                    "progress_percent": task.get("progress_percent"),
                    "progress_label": task.get("progress_label"),
                }
            )

        return {
            "ok": True,
            "project_id": project_id,
            "job_id": latest_job.get("job_id"),
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/results/{algorithm_id}")
async def get_algorithm_result(project_id: str, algorithm_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        result = read_algorithm_result(project_dir, algorithm_id)
        return {
            "ok": True,
            "project_id": project_id,
            "algorithm_id": algorithm_id,
            "result": result,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc