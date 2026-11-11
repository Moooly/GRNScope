"""Rescore archived bootstrap fits; never launch inference or resample scores."""

from functools import lru_cache
from pathlib import Path
from statistics import median

from .ranked_edges import EmptyRankedEdgesError, parse_ranked_edges_csv


def auprc_ratio(edges: list[dict], truth: frozenset[tuple[str, str]]) -> float:
    """Match the UI's tied-score trapezoidal BEELINE AUPRC estimator."""
    genes = {gene for pair in truth for gene in pair}
    possible = len(genes) * (len(genes) - 1)
    scores: dict[tuple[str, str], float] = {}
    for edge in edges:
        pair = (edge["source"], edge["target"])
        if pair[0] == pair[1] or not set(pair) <= genes:
            continue
        score = abs(float(edge["score"]))
        scores[pair] = max(scores.get(pair, 0), score)
    groups: dict[float, list[int]] = {}
    for pair, score in scores.items():
        if score > 0:
            group = groups.setdefault(score, [0, 0])
            group[0] += int(pair in truth)
            group[1] += 1
    selected = true_positive = 0
    recall, precision, area = 0.0, 1.0, 0.0
    for score in sorted(groups, reverse=True):
        positives, count = groups[score]
        selected += count
        true_positive += positives
        next_recall = true_positive / len(truth)
        next_precision = true_positive / selected
        area += (next_recall - recall) * (precision + next_precision) / 2
        recall, precision = next_recall, next_precision
    baseline = len(truth) / possible
    if selected < possible:
        area += (1 - recall) * (precision + baseline) / 2
    return area / baseline


@lru_cache(maxsize=512)
def _score_file(path: str, mtime_ns: int, size: int, limit: int | None,
                truth: frozenset[tuple[str, str]], allow_empty: bool) -> float:
    # mtime and size are cache keys, so replaced results cannot reuse old scores.
    try:
        edges, _ = parse_ranked_edges_csv(Path(path), max_edges_per_target=limit)
    except EmptyRankedEdgesError:
        if not allow_empty:
            raise
        edges = []
    return auprc_ratio(edges, truth)


def saved_bootstrap_benchmark(project_dir: Path, payload: dict, reference_edges: list[dict]) -> dict:
    truth = frozenset((edge["source"], edge["target"]) for edge in reference_edges
                      if edge["source"] != edge["target"])
    summary = payload.get("confidence_summary") or {}
    metadata = summary.get("run_metadata") or {}
    paths = payload.get("run_ranked_edges_paths") or {}
    # Include completed metadata with missing paths in the expected count.
    ids = {str(key) for key in paths if str(key).startswith("bootstrap-")}
    ids.update(str(key) for key, value in metadata.items()
               if str(key).startswith("bootstrap-") and isinstance(value, dict)
               and value.get("status") in {"Completed", "Empty"})
    runs = []
    missing = 0
    for run_id in sorted(ids):
        info = metadata.get(run_id) or {}
        if info.get("status") not in {None, "Completed", "Empty"}:
            continue
        path_value = paths.get(run_id)
        if not path_value or not truth:
            missing += 1
            continue
        path = Path(str(path_value))
        if not path.is_absolute():
            path = project_dir / path
        try:
            path = path.resolve()
            path.relative_to(project_dir.resolve())
            stat = path.stat()
            limit_value = info.get("max_regulators_per_target", summary.get("max_regulators_per_target"))
            limit = int(limit_value) if limit_value is not None else None
            ratio = _score_file(str(path), stat.st_mtime_ns, stat.st_size, limit,
                                truth, info.get("status") == "Empty")
        except (OSError, ValueError, TypeError, UnicodeError):
            missing += 1
            continue
        runs.append({"run_id": run_id, "auprc_ratio": ratio})
    values = [run["auprc_ratio"] for run in runs]
    return {
        "method": "saved_cell_bootstrap_performance_v1",
        "status": "partial" if values and missing else "available" if values else "unavailable",
        "run_count": len(values), "unavailable_run_count": missing,
        "median": median(values) if values else None,
        "minimum": min(values) if values else None,
        "maximum": max(values) if values else None,
        "runs": runs,
    }
