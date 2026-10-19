"""Create review figures for completed GRNScope project 3ac71f2c61bd.

Figures 2 and 3 incorporate unmodified exports from the running website.
Figure 4 contains explicitly simulated values for layout review only.
"""

from __future__ import annotations

import csv
import shutil
import sys
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "site_exports"
QA = HERE / "qa"
QA.mkdir(parents=True, exist_ok=True)
SKILL_SCRIPTS = HERE.parents[2] / ".agents" / "skills" / "nature-figure" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from audit_panel_alignment import require_matplotlib_panel_alignment  # noqa: E402

INK = "#18344a"
BLUE = "#176f9a"
TEAL = "#138b84"
GRAY = "#627481"
PALE = "#edf5f7"
LINE = "#d8e4e9"
ORANGE = "#bb531d"

mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
    "font.size": 7,
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.7,
    "savefig.facecolor": "white",
})


def save(fig, stem, *, alignment=False):
    fig.canvas.draw()
    if alignment:
        require_matplotlib_panel_alignment(
            fig,
            json_out=str(QA / f"{stem}.alignment.json"),
            overlay_svg=str(QA / f"{stem}.alignment.svg"),
            tolerance_pt=1.5,
            gutter_tolerance_pt=1.5,
            strict=True,
        )
    fig.savefig(HERE / f"{stem}.pdf", bbox_inches="tight")
    fig.savefig(HERE / f"{stem}.svg", bbox_inches="tight")
    fig.savefig(HERE / f"{stem}.png", dpi=300, bbox_inches="tight")
    fig.savefig(HERE / f"{stem}.tiff", dpi=600, bbox_inches="tight", pil_kwargs={"compression": "tiff_lzw"})
    plt.close(fig)


def figure_1():
    fig, ax = plt.subplots(figsize=(7.2, 5.15))
    fig.subplots_adjust(left=0.035, right=0.985, top=0.88, bottom=0.045)
    ax.set(xlim=(0, 1), ylim=(0, 1))
    ax.axis("off")
    fig.text(0.035, 0.965, "Fig. 1  |  From expression matrix to explorable GRN", fontsize=12, weight="bold", color=INK, va="top")
    fig.text(0.035, 0.914, "Completed case study · 2,000 cells · 19 genes · 13 inference methods", fontsize=7.5, color=GRAY, va="top")

    # Six dense rows replace the five mostly empty cards in the first draft.
    rows = [
        ("01", "INPUT", "Expression matrix\n2,000 cells × 19 genes", "Uploaded pseudotime\naligned by cell ID", "No reference GRN\nor benchmark labels"),
        ("02", "PREPROCESS", "Validate matrix\nand cell identities", "Detection filter ≥10%\n(200 of 2,000 cells)", "19/19 genes retained\nlog-normalized input"),
        ("03", "INFER", "13 methods selected\nand completed", "Full-data edge rankings\nfor each method", "Pseudotime supplied\nto trajectory methods"),
        ("04", "REPEAT", "Cell bootstrap\nwithin each method", "3–7 completed runs\nper algorithm", "Rank concordance\nand edge recovery"),
        ("05", "INTEGRATE", "Compare ranked\nnetwork evidence", "Cross-method support\nand direction evidence", "Activation or repression\nand confidence"),
        ("06", "INTERPRET", "Network view\ninteractions and regulators", "Comparison view\nstability and overlap", "Trajectory, perturbation\nand chart exports"),
    ]
    y_top, row_h, gap = 0.99, 0.139, 0.012
    xs = [0.105, 0.30, 0.535, 0.765]
    for i, (num, stage, a, b, c) in enumerate(rows):
        y = y_top - (i + 1) * row_h - i * gap
        fill = "#e9f4f3" if i in (3, 4) else PALE
        ax.add_patch(Rectangle((0.008, y), 0.984, row_h, facecolor=fill, edgecolor=LINE, linewidth=0.7))
        ax.add_patch(Rectangle((0.008, y), 0.008, row_h, facecolor=TEAL if i in (3, 4) else BLUE, edgecolor="none"))
        ax.text(0.054, y + row_h / 2, num, ha="center", va="center", color=TEAL if i in (3, 4) else BLUE, weight="bold", fontsize=11)
        ax.text(xs[0], y + row_h / 2, stage, va="center", color=INK, weight="bold", fontsize=7.7)
        for x, detail in zip(xs[1:], (a, b, c)):
            ax.text(x, y + row_h / 2, detail, va="center", color=INK if x == xs[1] else GRAY, fontsize=6.8, linespacing=1.4)
    ax.text(0.011, 0.015, "Project 3ac71f2c61bd · no uploaded ground-truth network · benchmark view unavailable", fontsize=6.2, color=GRAY, va="bottom")
    save(fig, "figure_1_detailed_workflow")


def figure_2():
    for suffix in ("png", "svg"):
        shutil.copyfile(SOURCE / f"network.{suffix}", HERE / f"figure_2_website_network.{suffix}")


def figure_3():
    stability = plt.imread(SOURCE / "stability.png")
    agreement = plt.imread(SOURCE / "agreement.png")
    fig = plt.figure(figsize=(9, 8.5))
    fig.text(0.04, 0.975, "Fig. 3  |  Stability within methods and agreement between methods", color=INK, fontsize=13, weight="bold", va="top")
    fig.text(0.04, 0.936, "Both panels are chart exports from the GRNScope Comparison view; top-50 edges for panel b.", color=GRAY, fontsize=7.7, va="top")
    # Source website images are shown without data alteration, recoloring, or replotting.
    top = fig.add_axes([0.035, 0.665, 0.93, 0.238])
    top.imshow(stability)
    top.axis("off")
    fig.text(0.04, 0.916, "a  Repeat-run rank stability", color=INK, fontsize=9, weight="bold", va="top")
    lower = fig.add_axes([0.185, 0.035, 0.63, 0.56])
    lower.imshow(agreement)
    lower.axis("off")
    fig.text(0.04, 0.642, "b  Top-50 edge overlap between methods", color=INK, fontsize=9, weight="bold", va="top")
    save(fig, "figure_3_website_comparison")


def figure_4():
    # SIMULATED MOCK DATA: values below are invented solely to preview layout.
    methods = ["PEARSON", "CELLORACLE", "GENIE3", "LEAP", "PIDC", "PPCOR", "GRNBOOST2", "SCODE", "GRISLI", "GRNVBEM", "SCRIBE", "SINCERITIES", "SINGE"]
    rho = [0.98, 0.95, 0.94, 0.91, 0.88, 0.90, 0.93, 0.84, 0.86, 0.89, 0.82, 0.85, 0.80]
    jaccard = [0.97, 0.91, 0.89, 0.87, 0.83, 0.86, 0.88, 0.78, 0.81, 0.84, 0.74, 0.79, 0.71]
    runtime = [0.91, 1.12, 0.94, 1.05, 0.89, 1.08, 0.96, 1.17, 0.93, 1.13, 0.86, 1.04, 1.21]
    with (HERE / "figure_4_SIMULATED_source_data.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["method", "simulated_rank_spearman_rho", "simulated_top50_jaccard", "simulated_grnscope_to_beeline_runtime_ratio"])
        writer.writerows(zip(methods, rho, jaccard, runtime))

    fig, axs = plt.subplots(1, 3, figsize=(8.9, 5.4), sharey=True, gridspec_kw={"width_ratios": [1, 1, 1]})
    fig.subplots_adjust(left=0.16, right=0.97, top=0.745, bottom=0.12, wspace=0.14)
    fig.text(0.025, 0.965, "Fig. 4  |  GRNScope–Beeline comparison concept", fontsize=12, color=INK, weight="bold", va="top")
    fig.add_artist(Rectangle((0.025, 0.845), 0.945, 0.067, transform=fig.transFigure, facecolor="#fff0e8", edgecolor="#e8b79e", linewidth=0.8))
    fig.text(0.497, 0.878, "SIMULATED MOCK DATA  ·  NOT MEASURED RESULTS", ha="center", va="center", color=ORANGE, weight="bold", fontsize=10)
    fig.text(0.025, 0.81, "Invented values show the intended comparison layout only. Replace after a real Beeline run.", color=ORANGE, fontsize=7.5)
    y = np.arange(len(methods))
    specs = [
        (rho, "Rank correlation", "Spearman ρ", (0.68, 1.01), None),
        (jaccard, "Shared top-50 edges", "Jaccard", (0.58, 1.01), None),
        (runtime, "Runtime ratio", "GRNScope / Beeline", (0.7, 1.3), 1.0),
    ]
    for i, (ax, (values, title, xlabel, limits, reference)) in enumerate(zip(axs, specs)):
        ax.scatter(values, y, s=35, facecolor=TEAL if i != 2 else BLUE, edgecolor=INK, linewidth=0.8, zorder=3)
        ax.set_xlim(*limits)
        ax.set_ylim(12.6, -0.6)
        ax.set_title(title, fontsize=8.6, color=INK, weight="bold", pad=8)
        ax.set_xlabel(xlabel, fontsize=7.5, color=INK)
        ax.set_yticks(y)
        if i == 0:
            ax.set_yticklabels(methods, fontsize=6.7, color=INK)
        else:
            ax.tick_params(axis="y", labelleft=False, length=0)
        ax.tick_params(axis="x", labelsize=6.5)
        ax.grid(axis="x", color=LINE, linewidth=0.6, zorder=0)
        if reference is not None:
            ax.axvline(reference, color=ORANGE, linestyle="--", linewidth=0.9)
        for spine in ("left", "bottom"):
            ax.spines[spine].set_color(LINE)
    fig.text(0.025, 0.035, "Every plotted number is synthetic. No Beeline comparison has been run for this project.", color=ORANGE, fontsize=7.5, weight="bold")
    require_matplotlib_panel_alignment(
        fig,
        json_out=str(QA / "figure_4_SIMULATED_comparison.alignment.json"),
        overlay_svg=str(QA / "figure_4_SIMULATED_comparison.alignment.svg"),
        tolerance_pt=1.5,
        gutter_tolerance_pt=1.5,
        strict=True,
    )
    save(fig, "figure_4_SIMULATED_comparison")


if __name__ == "__main__":
    figure_1()
    figure_2()
    figure_3()
    figure_4()
