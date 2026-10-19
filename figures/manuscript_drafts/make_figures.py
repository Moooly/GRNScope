"""Draft manuscript figures from one completed GRNScope project.

Run from the repository root with:
    python3 GRNScope/figures/manuscript_drafts/make_figures.py

Figures 1–3 use saved project results. Figure 4 is an explicitly empty
comparison design and contains no invented Beeline measurements.
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1] / "backend" / "projects" / "3ac71f2c61bd"
SKILL_SCRIPTS = HERE.parents[2] / ".agents" / "skills" / "nature-figure" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from audit_panel_alignment import require_matplotlib_panel_alignment  # noqa: E402


INK = "#18344A"
BLUE = "#176F9A"
TEAL = "#138B84"
PALE = "#D8EBF0"
GRAY = "#6B7883"
LIGHT = "#E8EEF1"
ORANGE = "#D67C3C"

mpl.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "font.size": 7,
        "axes.titlesize": 9,
        "axes.labelsize": 7,
        "xtick.labelsize": 6,
        "ytick.labelsize": 6,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.linewidth": 0.7,
        "savefig.facecolor": "white",
    }
)


def load_results():
    results = {}
    for folder in sorted((PROJECT / "results").iterdir()):
        if not folder.is_dir():
            continue
        record = json.loads((folder / "result.json").read_text())
        with Path(record["ranked_edges_path"]).open(newline="") as handle:
            edges = list(csv.DictReader(handle))
        results[folder.name] = {"record": record, "edges": edges}
    return results


def save(fig, stem):
    target = HERE / stem
    qa = HERE / "qa"
    qa.mkdir(exist_ok=True)
    fig.canvas.draw()
    require_matplotlib_panel_alignment(
        fig,
        json_out=str(qa / stem) + ".alignment.json",
        overlay_svg=str(qa / stem) + ".alignment.svg",
        tolerance_pt=1.5,
        gutter_tolerance_pt=1.5,
        strict=True,
    )
    fig.savefig(str(target) + ".pdf", bbox_inches="tight")
    fig.savefig(str(target) + ".svg", bbox_inches="tight")
    fig.savefig(str(target) + ".png", dpi=300, bbox_inches="tight")
    fig.savefig(str(target) + ".tiff", dpi=600, bbox_inches="tight", pil_kwargs={"compression": "tiff_lzw"})
    plt.close(fig)


def box(ax, x, y, w, h, title, detail, color=BLUE):
    patch = FancyBboxPatch(
        (x, y), w, h, boxstyle="round,pad=0.012,rounding_size=0.02",
        linewidth=0.8, edgecolor=color, facecolor="white"
    )
    ax.add_patch(patch)
    ax.text(x + w / 2, y + h * 0.65, title, ha="center", va="center", color=INK, weight="bold", fontsize=8)
    ax.text(x + w / 2, y + h * 0.32, detail, ha="center", va="center", color=GRAY, fontsize=6.5, linespacing=1.4)


def figure_1():
    fig, ax = plt.subplots(figsize=(7.2, 3.45))
    ax.set(xlim=(0, 1), ylim=(0, 1))
    ax.axis("off")
    fig.subplots_adjust(left=0.025, right=0.975, top=0.86, bottom=0.10)
    ax.text(0.01, 1.10, "Fig. 1  |  GRNScope analysis workflow", transform=ax.transAxes, fontsize=12, weight="bold", color=INK)
    ax.text(0.01, 1.01, "One dataset moves from checked inputs to interpretable network evidence", transform=ax.transAxes, fontsize=7.5, color=GRAY)
    stages = [
        (0.015, "Input", "2,000 cells\n19 genes\npseudotime"),
        (0.215, "Preprocess", "Validate matrix\nfilter genes\nalign cells"),
        (0.415, "Infer", "13 methods\nfull-data rankings"),
        (0.615, "Repeat & combine", "3–7 bootstrap runs\nper method; consensus"),
        (0.815, "Interpret", "Network · comparison\ntrajectory · export"),
    ]
    for x, title, detail in stages:
        box(ax, x, 0.37, 0.17, 0.35, title, detail, TEAL if title == "Repeat & combine" else BLUE)
    for i in range(4):
        x0 = stages[i][0] + 0.174
        x1 = stages[i + 1][0] - 0.010
        ax.add_patch(FancyArrowPatch((x0, 0.545), (x1, 0.545), arrowstyle="-|>", mutation_scale=9, linewidth=1.1, color=GRAY))
    ax.text(0.015, 0.22, "CASE STUDY", weight="bold", fontsize=6.5, color=TEAL)
    ax.text(0.16, 0.22, "Project 3ac71f2c61bd · all 13 methods completed · no ground-truth network", fontsize=7, color=INK)
    ax.text(0.015, 0.08, "Bootstrap counts shown are the completed runs in this project; the maximum configured cap was 50.", fontsize=6.5, color=GRAY)
    save(fig, "figure_1_workflow")


def figure_2(results):
    edge = ("WNT4", "RSPO1")
    reverse = edge[::-1]
    rows = []
    for method, data in results.items():
        lookup = {(r["Gene1"], r["Gene2"]): (i + 1, r) for i, r in enumerate(data["edges"])}
        forward = lookup.get(edge)
        backward = lookup.get(reverse)
        rank = forward[0] if forward else math.nan
        reverse_rank = backward[0] if backward else math.nan
        confidence = float(forward[1]["Confidence"]) if forward else math.nan
        rows.append((method, rank, reverse_rank, confidence))
    rows.sort(key=lambda r: r[1] if math.isfinite(r[1]) else math.inf)
    with (HERE / "figure_2_source_data.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["method", "rank_WNT4_to_RSPO1", "rank_RSPO1_to_WNT4", "bootstrap_confidence_WNT4_to_RSPO1"])
        writer.writerows(rows)
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    fig.subplots_adjust(left=0.18, right=0.89, top=0.78, bottom=0.15)
    fig.text(0.04, 0.94, "Fig. 2  |  Reading one candidate interaction", fontsize=12, weight="bold", color=INK)
    fig.text(0.04, 0.885, "WNT4–RSPO1: methods differ in rank and some cannot resolve direction", fontsize=8, color=GRAY)
    ys = np.arange(len(rows))
    ax.axvspan(0, 50, color=PALE, alpha=0.7, zorder=0)
    ax.axvline(50, color=BLUE, linewidth=0.8, linestyle="--")
    for y, (_, forward, backward, _) in zip(ys, rows):
        if math.isfinite(forward) and math.isfinite(backward):
            ax.plot([forward, backward], [y, y], color=LIGHT, linewidth=1.2, zorder=1)
    ax.scatter([r[1] for r in rows], ys, s=30, color=BLUE, label="WNT4 → RSPO1", zorder=3)
    ax.scatter([r[2] for r in rows], ys, s=25, facecolor="white", edgecolor=ORANGE, linewidth=1.1, label="RSPO1 → WNT4", zorder=3)
    ax.set_yticks(ys, [r[0] for r in rows])
    ax.invert_yaxis()
    ax.set_xlim(0, 350)
    ax.set_xticks([1, 50, 100, 200, 300, 342])
    ax.set_xlabel("Position in each method’s saved ranking (lower = stronger)")
    ax.grid(axis="x", color=LIGHT, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.text(1.02, 1.035, "Bootstrap confidence\nWNT4 → RSPO1", transform=ax.transAxes, ha="left", va="bottom", fontsize=6.5, color=INK)
    for y, row in zip(ys, rows):
        label = f"{row[3]:.0%}" if math.isfinite(row[3]) else "not reported"
        ax.text(1.04, y, label, transform=ax.get_yaxis_transform(), ha="left", va="center", fontsize=6.5, color=INK)
    fig.legend(loc="lower center", bbox_to_anchor=(0.49, 0.025), ncol=2, frameon=False, fontsize=7)
    forward_count = sum(math.isfinite(r[1]) and r[1] <= 50 for r in rows)
    reverse_count = sum(math.isfinite(r[2]) and r[2] <= 50 for r in rows)
    fig.text(0.18, 0.825, f"Top 50: {forward_count}/13 forward · {reverse_count}/13 reverse", fontsize=7, weight="bold", color=TEAL)
    save(fig, "figure_2_edge_example")


def top_adjacencies(edges, n=50):
    chosen = set()
    for row in edges:
        chosen.add(tuple(sorted((row["Gene1"], row["Gene2"]))))
        if len(chosen) == n:
            break
    return chosen


def figure_3(results):
    methods = sorted(results)
    top = {m: top_adjacencies(results[m]["edges"]) for m in methods}
    matrix = np.zeros((len(methods), len(methods)))
    for i, a in enumerate(methods):
        for j, b in enumerate(methods):
            matrix[i, j] = len(top[a] & top[b]) / len(top[a] | top[b])
    support = Counter(edge for edges in top.values() for edge in edges)
    selected = [edge for edge, count in support.most_common(12)]
    nodes = sorted(set(node for edge in selected for node in edge))
    angles = np.linspace(0, 2 * np.pi, len(nodes), endpoint=False) + np.pi / 2
    positions = {node: (0.74 * np.cos(angle), 0.74 * np.sin(angle)) for node, angle in zip(nodes, angles)}
    label_positions = {node: (1.00 * np.cos(angle), 1.00 * np.sin(angle)) for node, angle in zip(nodes, angles)}
    stability = []
    for method in methods:
        record = results[method]["record"]
        stats = record["confidence_summary"]["repeat_run_stability"]
        stability.append((method, stats["median_rho"], stats["minimum_rho"], stats["maximum_rho"], record["confidence_summary"]["bootstrap_runs"]))
    stability.sort(key=lambda r: r[1], reverse=True)
    with (HERE / "figure_3_stability_source_data.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["method", "median_pairwise_spearman_rho", "minimum_rho", "maximum_rho", "bootstrap_runs"])
        writer.writerows(stability)
    with (HERE / "figure_3_jaccard_source_data.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["method"] + methods)
        for method, values in zip(methods, matrix):
            writer.writerow([method] + list(values))
    with (HERE / "figure_3_network_source_data.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["gene_a", "gene_b", "methods_in_top_50_adjacencies"])
        for a, b in selected:
            writer.writerow([a, b, support[(a, b)]])
    fig = plt.figure(figsize=(7.2, 7.1))
    gs = fig.add_gridspec(2, 2, left=0.08, right=0.96, top=0.86, bottom=0.11, width_ratios=[0.95, 1], height_ratios=[0.95, 1.05], wspace=0.30, hspace=0.36)
    ax_net = fig.add_subplot(gs[:, 0])
    ax_stab = fig.add_subplot(gs[0, 1])
    ax_heat = fig.add_subplot(gs[1, 1])
    fig.text(0.04, 0.95, "Fig. 3  |  Shared adjacencies amid method variation", fontsize=12, weight="bold", color=INK)
    fig.text(0.04, 0.905, "Case study: 19 genes, 2,000 cells, 13 completed methods", fontsize=7.5, color=GRAY)
    ax_net.set_title("a  Overlap network: 12 most shared adjacencies", loc="left", pad=11, weight="bold")
    for a, b in selected:
        xa, ya = positions[a]
        xb, yb = positions[b]
        ax_net.plot([xa, xb], [ya, yb], color=BLUE, alpha=0.25 + 0.065 * support[(a, b)], linewidth=0.4 + 0.25 * support[(a, b)], zorder=1)
    for node in nodes:
        x, y = positions[node]
        lx, ly = label_positions[node]
        ax_net.scatter(x, y, s=39, color=TEAL, edgecolor="white", linewidth=0.6, zorder=3)
        ax_net.text(lx, ly, node, ha="left" if lx > 0.05 else "right" if lx < -0.05 else "center", va="center", fontsize=6.4, color=INK, zorder=4)
    ax_net.set(xlim=(-1.35, 1.35), ylim=(-1.2, 1.2))
    ax_net.set_aspect("auto")
    ax_net.axis("off")
    ax_net.text(0.0, -0.09, "Undirected overlap; line width reflects the number of methods.\nThis is a display subset, not a causal network.", transform=ax_net.transAxes, fontsize=6.4, color=GRAY, va="top")
    ax_stab.set_title("b  Repeat-run stability", loc="left", pad=9, weight="bold")
    y = np.arange(len(stability))
    for yi, row in zip(y, stability):
        ax_stab.plot([row[2], row[3]], [yi, yi], color="#B6C4CC", linewidth=1.1, zorder=1)
    ax_stab.scatter([r[1] for r in stability], y, color=TEAL, s=17, zorder=2)
    ax_stab.set_yticks(y, [r[0] for r in stability])
    ax_stab.invert_yaxis()
    ax_stab.set_xlim(0, 1.02)
    ax_stab.set_xlabel("Median pairwise Spearman ρ (range shown)")
    ax_stab.grid(axis="x", color=LIGHT, linewidth=0.6)
    ax_stab.set_axisbelow(True)
    ax_heat.set_title("c  Top-50 adjacency agreement", loc="left", pad=9, weight="bold")
    im = ax_heat.imshow(matrix, cmap="Blues", vmin=0, vmax=1, interpolation="nearest", aspect="equal")
    ax_heat.set_xticks(range(len(methods)), methods)
    plt.setp(ax_heat.get_xticklabels(), rotation=90, rotation_mode="anchor", ha="right")
    ax_heat.set_yticks(range(len(methods)), methods)
    ax_heat.tick_params(length=0, pad=1)
    for i in range(len(methods) + 1):
        ax_heat.axhline(i - 0.5, color="white", linewidth=0.35)
        ax_heat.axvline(i - 0.5, color="white", linewidth=0.35)
    cbar = fig.colorbar(im, ax=ax_heat, fraction=0.045, pad=0.03)
    cbar.set_label("Jaccard", fontsize=6.5)
    cbar.ax.tick_params(labelsize=6)
    save(fig, "figure_3_case_study")


def figure_4():
    fig, ax = plt.subplots(figsize=(7.2, 4.55))
    fig.subplots_adjust(left=0.04, right=0.96, top=0.84, bottom=0.10)
    ax.set(xlim=(0, 1), ylim=(0, 1))
    ax.axis("off")
    fig.text(0.04, 0.94, "Fig. 4  |  Planned Beeline comparison", fontsize=12, weight="bold", color=INK)
    fig.text(0.04, 0.885, "Design preview · independent comparison results have not been generated", fontsize=8, color=ORANGE)
    box(ax, 0.03, 0.64, 0.25, 0.20, "Matched inputs", "Same expression matrix\nand pseudotime", BLUE)
    box(ax, 0.375, 0.64, 0.25, 0.20, "Matched methods", "Same parameters and\nfull-data runs", BLUE)
    box(ax, 0.72, 0.64, 0.25, 0.20, "Paired outputs", "GRNScope and independent\nBeeline results", TEAL)
    for x0, x1 in [(0.293, 0.36), (0.638, 0.705)]:
        ax.add_patch(FancyArrowPatch((x0, 0.74), (x1, 0.74), arrowstyle="-|>", mutation_scale=9, linewidth=1, color=GRAY))
    labels = [
        (0.03, "Edge-rank concordance", "Paired rank correlation by method"),
        (0.355, "Top-edge overlap", "Jaccard at a prespecified top N"),
        (0.68, "Runtime difference", "Paired elapsed time under matched resources"),
    ]
    for x, title, detail in labels:
        panel = FancyBboxPatch((x, 0.22), 0.29, 0.27, boxstyle="round,pad=0.01,rounding_size=0.02", edgecolor="#AEBCC5", facecolor="#F8FAFB", linestyle="--", linewidth=0.8)
        ax.add_patch(panel)
        ax.text(x + 0.145, 0.42, title, ha="center", fontsize=7.4, weight="bold", color=INK)
        ax.text(x + 0.145, 0.32, detail, ha="center", fontsize=6.6, color=GRAY)
        ax.text(x + 0.145, 0.255, "RESULT PENDING", ha="center", fontsize=6.8, weight="bold", color=ORANGE)
    ax.text(0.03, 0.08, "No comparison values are plotted. This figure is a layout for the validation analysis, not evidence of equivalence.", fontsize=6.8, color=GRAY)
    save(fig, "figure_4_beeline_comparison_preview")


def main():
    results = load_results()
    assert len(results) == 13
    figure_1()
    figure_2(results)
    figure_3(results)
    figure_4()
    print("Created four figure drafts in", HERE)


if __name__ == "__main__":
    main()
