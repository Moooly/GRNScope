"""Ranked-edge CSV parsing and BEELINE PathStats calculations."""

from __future__ import annotations

import csv
import heapq
from collections import deque
from math import isfinite
from pathlib import Path

CSV_SNIFF_SAMPLE_BYTES = 65536


class EmptyRankedEdgesError(ValueError):
    pass


def detect_csv_dialect(raw_text: str) -> csv.Dialect | type[csv.Dialect]:
    sample = raw_text[:4096]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        first_line = raw_text.splitlines()[0] if raw_text.splitlines() else ""
        if "\t" in first_line:
            return csv.excel_tab
        if ";" in first_line:

            class SemicolonDialect(csv.excel):
                delimiter = ";"

            return SemicolonDialect
        return csv.excel


def detect_csv_dialect_from_file(source_path: Path) -> csv.Dialect | type[csv.Dialect]:
    with source_path.open("r", encoding="utf-8", newline="") as source_file:
        sample = source_file.read(CSV_SNIFF_SAMPLE_BYTES)

    if not sample.strip():
        raise ValueError(f"{source_path.name} is empty.")

    return detect_csv_dialect(sample)


def parse_ranked_edges_csv(
    ranked_edges_path: Path,
    *,
    max_edges_per_target: int | None = None,
) -> tuple[list[dict], dict]:
    if not ranked_edges_path.exists():
        raise FileNotFoundError(f"rankedEdges.csv not found at {ranked_edges_path}")

    dialect = detect_csv_dialect_from_file(ranked_edges_path)

    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file, dialect=dialect)
        fieldnames = reader.fieldnames or []

    if not fieldnames:
        raise ValueError("rankedEdges.csv has no header row.")

    normalized_field_map = {
        key.strip().replace('\"', ""): key for key in fieldnames if key is not None
    }

    def find_field(candidates: list[str]) -> str | None:
        for candidate in candidates:
            if candidate in normalized_field_map:
                return normalized_field_map[candidate]
        return None

    source_key = find_field(["Gene1", "TF", "source", "Source"])
    target_key = find_field(["Gene2", "Target", "target", "TargetGene"])
    score_key = find_field(["EdgeWeight", "weight", "score", "Score"])

    if score_key is None:
        numeric_candidates = list(fieldnames)
        seen_numeric_values: set[str] = set()
        with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
            reader = csv.DictReader(csv_file, dialect=dialect)
            for row in reader:
                for key in list(numeric_candidates):
                    value = row.get(key)
                    if value in (None, ""):
                        continue
                    try:
                        float(str(value).strip())
                    except (TypeError, ValueError):
                        numeric_candidates.remove(key)
                    else:
                        seen_numeric_values.add(key)

        ordered_numeric_candidates = [
            key for key in fieldnames if key in numeric_candidates and key in seen_numeric_values
        ]
        score_key = ordered_numeric_candidates[-1] if ordered_numeric_candidates else None

    if source_key is None or target_key is None:
        raise ValueError(
            f"Could not identify source/target columns in rankedEdges.csv. Found columns: {fieldnames}"
        )

    if score_key is None:
        raise ValueError(
            f"Could not identify a score column in rankedEdges.csv. Found columns: {fieldnames}"
        )

    parsed_edges: list[dict] = []
    node_names: set[str] = set()
    max_edges_per_target = (
        max(1, max_edges_per_target) if max_edges_per_target is not None else None
    )
    target_heaps: dict[str, list[tuple[float, int, str, float]]] = {}
    sequence = 0

    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file, dialect=dialect)
        for row in reader:
            source = str(row.get(source_key, "")).strip()
            target = str(row.get(target_key, "")).strip()
            score_raw = str(row.get(score_key, "")).strip()

            if not source or not target or source == target:
                continue

            try:
                score = float(score_raw)
            except (TypeError, ValueError):
                continue
            if not isfinite(score):
                continue

            if max_edges_per_target is None:
                parsed_edges.append(
                    {
                        "source": source,
                        "target": target,
                        "score": score,
                    }
                )
                node_names.add(source)
                node_names.add(target)
                continue

            heap = target_heaps.setdefault(target, [])
            heap_item = (abs(score), sequence, source, score)
            sequence += 1
            if len(heap) < max_edges_per_target:
                heapq.heappush(heap, heap_item)
            elif heap_item[0] > heap[0][0]:
                heapq.heapreplace(heap, heap_item)

    if max_edges_per_target is not None:
        for target, heap in target_heaps.items():
            for _abs_score, _sequence, source, score in sorted(
                heap,
                key=lambda item: (-item[0], str(item[2])),
            ):
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
        raise EmptyRankedEdgesError(
            "rankedEdges.csv did not contain any valid edges."
        )

    scores = [edge["score"] for edge in parsed_edges]
    min_score = min(scores)
    max_score = max(scores)
    score_range = max_score - min_score

    for edge in parsed_edges:
        edge["normalized_score"] = (
            1.0 if score_range == 0 else (edge["score"] - min_score) / score_range
        )

    return parsed_edges, {
        "edge_count": len(parsed_edges),
        "node_count": len(node_names),
    }


def compute_beeline_path_stats(
    ranked_edges_path: Path,
    reference_edges: list[dict],
) -> dict | None:
    """Apply BEELINE PathStats to a globally ranked raw edge file."""
    reference_set = {
        (
            str(edge.get("source", "")).strip(),
            str(edge.get("target", "")).strip(),
        )
        for edge in reference_edges
        if str(edge.get("source", "")).strip()
        and str(edge.get("target", "")).strip()
        and str(edge.get("source", "")).strip()
        != str(edge.get("target", "")).strip()
    }
    if not reference_set or not ranked_edges_path.exists():
        return None

    dialect = detect_csv_dialect_from_file(ranked_edges_path)
    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file, dialect=dialect)
        fieldnames = reader.fieldnames or []
        normalized = {
            str(field).strip().replace('"', ""): field
            for field in fieldnames
            if field is not None
        }
        source_key = next(
            (
                normalized[key]
                for key in ("Gene1", "TF", "source", "Source")
                if key in normalized
            ),
            None,
        )
        target_key = next(
            (
                normalized[key]
                for key in ("Gene2", "Target", "target", "TargetGene")
                if key in normalized
            ),
            None,
        )
        score_key = next(
            (
                normalized[key]
                for key in ("EdgeWeight", "weight", "score", "Score")
                if key in normalized
            ),
            None,
        )
        if source_key is None or target_key is None or score_key is None:
            return None

        # BEELINE PathStats expects rankedEdges.csv to already be globally
        # ranked. GRNScope also accepts per-target-grouped files, so build the
        # intended global ranking explicitly. Keep one score per directed edge;
        # otherwise repeated rows could consume top-k slots without adding a
        # prediction to the graph.
        best_prediction_by_edge: dict[tuple[str, str], float] = {}
        for row in reader:
            source = str(row.get(source_key, "")).strip()
            target = str(row.get(target_key, "")).strip()
            if not source or not target or source == target:
                continue
            try:
                weight = round(abs(float(row.get(score_key, 0.0) or 0.0)), 6)
            except (TypeError, ValueError):
                continue
            if not isfinite(weight) or weight <= 0:
                continue
            edge = (source, target)
            previous_weight = best_prediction_by_edge.get(edge)
            if previous_weight is None or weight > previous_weight:
                best_prediction_by_edge[edge] = weight

    predictions = sorted(
        (
            (source, target, weight)
            for (source, target), weight in best_prediction_by_edge.items()
        ),
        key=lambda prediction: (
            -prediction[2],
            prediction[0],
            prediction[1],
        ),
    )

    if not predictions:
        return None

    maximum_k = min(len(predictions), len(reference_set))
    threshold = predictions[maximum_k - 1][2]
    predicted_set = {
        (source, target)
        for source, target, weight in predictions
        if weight >= threshold
    }
    true_positives = predicted_set & reference_set
    false_positives = predicted_set - reference_set

    adjacency: dict[str, set[str]] = {}
    reference_nodes: set[str] = set()
    for source, target in reference_set:
        adjacency.setdefault(source, set()).add(target)
        reference_nodes.add(source)
        reference_nodes.add(target)

    def shortest_path_length(source: str, target: str) -> int | None:
        if source not in reference_nodes or target not in reference_nodes:
            return None
        visited = {source}
        queue = deque([(source, 0)])
        while queue:
            node, depth = queue.popleft()
            for neighbor in adjacency.get(node, set()):
                if neighbor == target:
                    return depth + 1
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                queue.append((neighbor, depth + 1))
        return None

    path_counts = {2: 0, 3: 0, 4: 0, 5: 0}
    with_path = 0
    no_path = 0
    longer_than_five = 0
    for source, target in false_positives:
        path_length = shortest_path_length(source, target)
        if path_length is None:
            no_path += 1
            continue
        with_path += 1
        if path_length in path_counts:
            path_counts[path_length] += 1
        elif path_length > 5:
            longer_than_five += 1

    return {
        "reference_edge_count": len(reference_set),
        "selection_threshold": threshold,
        "num_predicted": len(predicted_set),
        "num_true_positive": len(true_positives),
        "num_false_positive_with_path": with_path,
        "num_false_positive_no_path": no_path,
        "path_2": path_counts[2],
        "path_3": path_counts[3],
        "path_4": path_counts[4],
        "path_5": path_counts[5],
        # BEELINE exposes this through numFP_withPath but does not give it a
        # dedicated column. Keeping the derived bin prevents long paths from
        # being mislabeled as "no path" in the UI.
        "path_more_than_5": longer_than_five,
    }
