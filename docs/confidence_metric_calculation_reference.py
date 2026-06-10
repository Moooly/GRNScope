"""
Standalone reference for GRNScope's current 30-run edge metric calculation.

This file is intentionally NOT imported by the web app. It exists only as a
readable reference for explaining how repeated BEELINE outputs are converted
into per-edge Evidence, Stability, and Confidence.

The production implementation lives in:
    backend/app/services/beeline_service.py

Current idea:
    1. Run one algorithm 30 times on different 80% cell subsamples.
    2. For each run, rank regulators separately for each target gene.
    3. Convert each edge's rank into a 0-1 percentile score.
    4. Aggregate those percentile scores across all 30 runs.
    5. Penalize edges that do not repeatedly appear in the top K ranks.

Main formulas:
    Per-run percentile:
        percentile = 1 - (rank - 1) / (number_of_regulators_for_target - 1)

    Evidence:
        evidence = mean_percentile = sum(percentiles_across_observed_runs) / total_runs

    Stability:
        stability = selected_runs / total_runs

    Confidence:
        confidence = stability * evidence
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import fsum


DEFAULT_TOTAL_RUNS = 30
DEFAULT_STABILITY_TOP_K = 10


@dataclass(frozen=True)
class EdgePrediction:
    """One edge predicted by one algorithm in one run."""

    source: str
    target: str
    score: float


@dataclass
class EdgeAccumulator:
    """Temporary values collected for one source-target edge across runs."""

    source: str
    target: str
    raw_scores: list[float] = field(default_factory=list)
    percentiles: list[float] = field(default_factory=list)
    z_scores: list[float] = field(default_factory=list)
    selected_runs: int = 0
    observed_runs: int = 0
    best_rank: int | None = None
    run_ranks: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class AggregatedEdgeMetrics:
    """Final metrics for one edge after all repeated runs are aggregated."""

    source: str
    target: str
    evidence: float
    stability: float
    confidence: float
    mean_raw_score: float
    mean_z: float
    z_ci_lower: float
    z_ci_upper: float
    selected_runs: int
    observed_runs: int
    run_count: int
    best_rank: int | None
    rank: int = 0


def clamp_0_1(value: float) -> float:
    return max(0.0, min(1.0, value))


def quantile(values: list[float], q: float) -> float:
    """Small quantile helper used for the z-score confidence interval."""

    if not values:
        return 0.0

    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]

    position = (len(ordered) - 1) * q
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - lower_index
    return ordered[lower_index] * (1 - fraction) + ordered[upper_index] * fraction


def population_sd(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0

    mean_value = fsum(values) / len(values)
    variance = fsum((value - mean_value) ** 2 for value in values) / len(values)
    return variance**0.5


def rank_edges_by_target(edges: list[EdgePrediction]) -> dict[str, list[EdgePrediction]]:
    """
    Rank source genes separately for each target gene.

    For every target, regulators are sorted by absolute edge score. This matches
    the current production logic:

        higher abs(score) = stronger edge = better rank

    If duplicate source-target predictions appear in one run, only the strongest
    occurrence for that source is kept.
    """

    by_target: dict[str, list[EdgePrediction]] = {}
    for edge in edges:
        if not edge.source or not edge.target or edge.source == edge.target:
            continue
        by_target.setdefault(edge.target, []).append(edge)

    ranked_by_target: dict[str, list[EdgePrediction]] = {}
    for target, target_edges in by_target.items():
        sorted_edges = sorted(
            target_edges,
            key=lambda edge: (-abs(edge.score), edge.source),
        )

        seen_sources: set[str] = set()
        ranked_edges: list[EdgePrediction] = []
        for edge in sorted_edges:
            if edge.source in seen_sources:
                continue
            seen_sources.add(edge.source)
            ranked_edges.append(edge)

        ranked_by_target[target] = ranked_edges

    return ranked_by_target


def aggregate_repeated_run_metrics(
    run_edges_by_id: dict[str, list[EdgePrediction]],
    *,
    stability_top_k: int = DEFAULT_STABILITY_TOP_K,
) -> list[AggregatedEdgeMetrics]:
    """
    Aggregate repeated algorithm outputs into Evidence, Stability, and Confidence.

    Parameters
    ----------
    run_edges_by_id:
        Mapping from run ID, such as "run-1", to the ranked edge outputs from
        that run.

    stability_top_k:
        An edge is counted as "selected" in a run if it ranks in the top K
        regulators for its target gene. Production default is top 10.

    Returns
    -------
    A list of edges sorted by descending confidence, then descending evidence.
    """

    run_ids = list(run_edges_by_id.keys())
    total_runs = max(1, len(run_ids))
    accumulator: dict[tuple[str, str], EdgeAccumulator] = {}

    for run_id, run_edges in run_edges_by_id.items():
        ranked_by_target = rank_edges_by_target(run_edges)

        for target, ranked_edges in ranked_by_target.items():
            weights = [abs(edge.score) for edge in ranked_edges]
            mean_weight = fsum(weights) / len(weights) if weights else 0.0
            sd_weight = population_sd(weights)
            denominator = max(len(ranked_edges) - 1, 1)

            for index, edge in enumerate(ranked_edges):
                rank = index + 1

                # Convert rank into a 0-1 per-run evidence score.
                # Rank 1 gets 1.0. The weakest edge for this target gets 0.0.
                percentile = (
                    1.0
                    if len(ranked_edges) <= 1
                    else 1 - ((rank - 1) / denominator)
                )

                weight = abs(edge.score)
                z_score = 0.0 if sd_weight <= 0 else (weight - mean_weight) / sd_weight

                key = (edge.source, target)
                current = accumulator.setdefault(
                    key,
                    EdgeAccumulator(source=edge.source, target=target),
                )

                current.raw_scores.append(edge.score)
                current.percentiles.append(percentile)
                current.z_scores.append(z_score)
                current.observed_runs += 1
                current.run_ranks[run_id] = rank
                current.best_rank = (
                    rank if current.best_rank is None else min(current.best_rank, rank)
                )

                if rank <= stability_top_k:
                    current.selected_runs += 1

    aggregated_edges: list[AggregatedEdgeMetrics] = []
    for current in accumulator.values():
        missing_runs = total_runs - current.observed_runs

        # Missing runs do not add percentile evidence. This is why Evidence is
        # divided by total_runs, not observed_runs.
        evidence = fsum(current.percentiles) / total_runs

        # Stability measures repeated top-K recovery.
        stability = current.selected_runs / total_runs

        # Confidence requires both repeated recovery and high average rank.
        confidence = clamp_0_1(stability * evidence)

        raw_scores = current.raw_scores
        mean_raw_score = fsum(raw_scores) / len(raw_scores) if raw_scores else 0.0

        # Missing runs are padded with z-score 0 for the mean/interval.
        z_values = [*current.z_scores, *([0.0] * max(0, missing_runs))]
        mean_z = fsum(z_values) / total_runs

        aggregated_edges.append(
            AggregatedEdgeMetrics(
                source=current.source,
                target=current.target,
                evidence=evidence,
                stability=stability,
                confidence=confidence,
                mean_raw_score=mean_raw_score,
                mean_z=mean_z,
                z_ci_lower=quantile(z_values, 0.025),
                z_ci_upper=quantile(z_values, 0.975),
                selected_runs=current.selected_runs,
                observed_runs=current.observed_runs,
                run_count=total_runs,
                best_rank=current.best_rank,
            )
        )

    sorted_edges = sorted(
        aggregated_edges,
        key=lambda edge: (
            -edge.confidence,
            -edge.evidence,
            edge.source,
            edge.target,
        ),
    )

    return [
        AggregatedEdgeMetrics(
            **{
                **edge.__dict__,
                "rank": index,
            }
        )
        for index, edge in enumerate(sorted_edges, start=1)
    ]


def calculate_metrics_from_known_ranks(
    ranks: list[int | None],
    *,
    regulators_per_target: int,
    stability_top_k: int = DEFAULT_STABILITY_TOP_K,
) -> dict[str, float | int]:
    """
    Small teaching helper for explaining one edge with known ranks.

    Use None when the edge is missing from a run.

    Example:
        ranks = [1, 3, 12, None, 5, ...]  # length 30
    """

    total_runs = len(ranks)
    denominator = max(regulators_per_target - 1, 1)

    percentiles = []
    selected_runs = 0
    observed_runs = 0

    for rank in ranks:
        if rank is None:
            continue

        observed_runs += 1
        percentile = 1.0 if regulators_per_target <= 1 else 1 - ((rank - 1) / denominator)
        percentiles.append(percentile)

        if rank <= stability_top_k:
            selected_runs += 1

    evidence = fsum(percentiles) / total_runs
    stability = selected_runs / total_runs
    confidence = stability * evidence

    return {
        "evidence": evidence,
        "stability": stability,
        "confidence": confidence,
        "selected_runs": selected_runs,
        "observed_runs": observed_runs,
        "run_count": total_runs,
    }


if __name__ == "__main__":
    # Example: one edge across 30 repeated runs.
    # The edge is missing in a few runs, and in observed runs its rank changes.
    example_ranks = [
        2,
        4,
        8,
        12,
        20,
        None,
        5,
        3,
        10,
        None,
        15,
        7,
        2,
        18,
        6,
        None,
        11,
        9,
        4,
        13,
        1,
        5,
        None,
        8,
        16,
        6,
        7,
        None,
        3,
        12,
    ]

    metrics = calculate_metrics_from_known_ranks(
        example_ranks,
        regulators_per_target=100,
        stability_top_k=10,
    )

    print("Example edge metrics from 30 runs")
    for key, value in metrics.items():
        print(f"{key}: {value:.3f}" if isinstance(value, float) else f"{key}: {value}")
