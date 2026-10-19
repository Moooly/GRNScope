"""Build a dense, original GRNScope graphical abstract for NAR review.

The artwork is exactly 5:2 (10 x 4 in), uses 12–16 pt Arial, and keeps actual
demonstration numbers separate from illustrative icons. Requires PyMuPDF and
Pillow plus macOS system Arial fonts. Run from any working directory.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pymupdf as fitz
from PIL import Image


HERE = Path(__file__).resolve().parent
FONT = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
W, H = 720, 288  # pt = 10 x 4 in, exactly 5:2
SOURCE_DATA = HERE.parent / "case_study_method_summary.csv"


def rgb(value: str) -> tuple[float, float, float]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


NAVY = rgb("#173449")
TEAL = rgb("#087F8C")
BLUE = rgb("#427BA9")
ORANGE = rgb("#C66C36")
INK = NAVY
MUTED = rgb("#647C8A")
GRID = rgb("#CADBE4")
PALE = rgb("#F5F9FB")
PALE_BLUE = rgb("#EAF3F7")
PALE_ORANGE = rgb("#FBF2EC")
WHITE = (1, 1, 1)


def label(page: fitz.Page, value: str, x: float, baseline: float, size: float = 14, *, bold: bool = False, center: bool = False, color: tuple[float, float, float] = INK) -> None:
    font_path = BOLD if bold else FONT
    font_name = "Arial-Bold" if bold else "Arial"
    width = fitz.Font(fontfile=str(font_path)).text_length(value, fontsize=size)
    page.insert_text(
        (x - width / 2 if center else x, baseline),
        value,
        fontname=font_name,
        fontsize=size,
        color=color,
    )


def arrow(page: fitz.Page, x1: float, x2: float, y: float, *, color=TEAL, width: float = 1.8) -> None:
    page.draw_line((x1, y), (x2, y), color=color, width=width)
    page.draw_line((x2 - 4, y - 4), (x2, y), color=color, width=width)
    page.draw_line((x2 - 4, y + 4), (x2, y), color=color, width=width)


def panel(page: fitz.Page, x0: float, x1: float, accent) -> None:
    page.draw_rect(fitz.Rect(x0, 44, x1, 226), color=GRID, fill=WHITE, width=0.8)
    page.draw_rect(fitz.Rect(x0, 44, x1, 48), color=None, fill=accent)


def expression_matrix(page: fitz.Page) -> None:
    shades = [rgb(c) for c in ("#E2F0F2", "#B6DDE2", "#7CC6CE", "#3AA1AC", "#087F8C")]
    x0, y0, cell, gap = 30, 96, 5.9, 1.2
    for row in range(8):
        for col in range(14):
            index = (row * 7 + col * 3 + row * col) % 5
            x, y = x0 + col * (cell + gap), y0 + row * (cell + gap)
            page.draw_rect(fitz.Rect(x, y, x + cell, y + cell), color=None, fill=shades[index])
    page.draw_line((27, 93), (27, 155), color=MUTED, width=0.8)
    page.draw_line((27, 155), (129, 155), color=MUTED, width=0.8)


def draw_input(page: fitz.Page) -> None:
    label(page, "INPUT", 22, 69, 16, bold=True)
    label(page, "Expression matrix", 22, 87, 14)
    expression_matrix(page)
    label(page, "Pseudotime", 22, 179, 14)
    # Dashed because pseudotime is an optional general input, supplied in the demo.
    points = [(30, 209), (47, 205), (62, 212), (79, 194), (98, 198), (117, 186), (138, 190)]
    for a, b in zip(points, points[1:]):
        page.draw_line(a, b, color=BLUE, width=1.8, dashes="[3 2] 0")
    for point in (points[0], points[3], points[-1]):
        page.draw_circle(point, 2.8, color=BLUE, fill=WHITE, width=1.2)


def method_chip(page: fitz.Page, name: str, x: float, y: float, color) -> float:
    width = fitz.Font(fontfile=str(FONT)).text_length(name, fontsize=12) + 13
    page.draw_rect(fitz.Rect(x, y, x + width, y + 16), color=GRID, fill=WHITE, width=0.55)
    page.draw_rect(fitz.Rect(x, y, x + 3, y + 16), color=None, fill=color)
    label(page, name, x + 8, y + 12.2, 12)
    return x + width


def draw_analysis(page: fitz.Page) -> None:
    label(page, "GRNScope ANALYSIS", 181, 69, 16, bold=True)
    for x0, x1, value in ((180, 291, "Input checks"), (301, 414, "Filter + normalize")):
        page.draw_rect(fitz.Rect(x0, 78, x1, 105), color=GRID, fill=PALE, width=0.7)
        label(page, value, (x0 + x1) / 2, 96, 13, center=True)
    arrow(page, 292, 300, 91)

    page.draw_rect(fitz.Rect(180, 111, 414, 199), color=GRID, fill=PALE_BLUE, width=0.7)
    label(page, "13 selected inference methods", 190, 127, 14, bold=True)
    rows = [
        ["PEARSON", "PPCOR", "SINCERITIES"],
        ["CellOracle", "PIDC", "LEAP", "SCRIBE"],
        ["GRNBoost2", "GRISLI", "GENIE3"],
        ["SINGE", "SCODE", "GRNVBEM"],
    ]
    colors = [TEAL, BLUE, ORANGE]
    for row_index, names in enumerate(rows):
        x, y = 186, 131 + row_index * 17
        for name in names:
            x = method_chip(page, name, x, y, colors[(len(name) + row_index) % 3]) + 3
        if x > 414:
            raise ValueError(f"Method chips exceed panel width on row {row_index}")

    page.draw_rect(fitz.Rect(180, 203, 414, 219), color=GRID, fill=PALE_ORANGE, width=0.6)
    label(page, "Cell bootstraps + early stop", 189, 215, 13)
    for x in (376, 386, 396):
        page.draw_circle((x, 211), 3.1, color=ORANGE, fill=WHITE, width=1.0)


def network_icon(page: fitz.Page) -> None:
    nodes = [(452, 94), (467, 83), (486, 89), (454, 111), (474, 105), (491, 113)]
    for a, b, color in ((0, 1, GRID), (1, 2, TEAL), (0, 3, BLUE), (1, 4, TEAL), (2, 5, BLUE), (3, 4, GRID), (4, 5, TEAL)):
        page.draw_line(nodes[a], nodes[b], color=color, width=1.2)
    for i, point in enumerate(nodes):
        fill = TEAL if i in (1, 4) else WHITE
        page.draw_circle(point, 2.8, color=TEAL if i in (1, 4) else BLUE, fill=fill, width=1.1)


def recovery_icon(page: fitz.Page) -> None:
    for index, height in enumerate((10, 16, 12, 22, 18, 26)):
        x = 448 + index * 8.1
        page.draw_rect(fitz.Rect(x, 163 - height, x + 5.5, 163), color=None, fill=BLUE)
    page.draw_line((446, 163.3), (497, 163.3), color=MUTED, width=0.8)


def overlap_icon(page: fitz.Page) -> None:
    shades = [rgb(c) for c in ("#E7F2F4", "#B8DCE1", "#6DBBC5", "#087F8C")]
    values = [[3, 1, 0, 2, 1], [1, 3, 2, 0, 1], [0, 2, 3, 1, 2], [2, 0, 1, 3, 1], [1, 1, 2, 1, 3]]
    for row in range(5):
        for col in range(5):
            x, y = 452 + col * 8.1, 181 + row * 8.1
            page.draw_rect(fitz.Rect(x, y, x + 6.7, y + 6.7), color=None, fill=shades[values[row][col]])


def draw_output(page: fitz.Page) -> None:
    label(page, "DISTINCT EVIDENCE", 447, 69, 16, bold=True)
    for y0, y1 in ((77, 121), (126, 170), (175, 219)):
        page.draw_rect(fitz.Rect(446, y0, 698, y1), color=GRID, fill=PALE, width=0.6)

    network_icon(page)
    label(page, "Rank evidence", 507, 96, 14, bold=True)
    label(page, "within-target edge order", 507, 113, 12)

    recovery_icon(page)
    label(page, "Bootstrap recovery", 507, 145, 14, bold=True)
    label(page, "fraction of replicates with E ≥ 0.8", 507, 162, 12)

    overlap_icon(page)
    label(page, "Method overlap", 507, 194, 14, bold=True)
    label(page, "Jaccard, top-50 adjacencies", 507, 211, 12)


def load_demo_metrics() -> tuple[int, int, int, float, float]:
    with SOURCE_DATA.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    listed = {
        "PEARSON", "PPCOR", "SINCERITIES", "CELLORACLE", "PIDC", "LEAP",
        "GRNBOOST2", "SCRIBE", "GRISLI", "GENIE3", "SINGE", "SCODE", "GRNVBEM",
    }
    assert {row["method"].upper() for row in rows} == listed
    assert all(row["status"] == "Completed" for row in rows)
    runs = [int(row["completed_bootstrap_runs"]) for row in rows]
    stability = [float(row["median_pairwise_spearman_rho"]) for row in rows]
    return len(rows), min(runs), max(runs), min(stability), max(stability)


def footer(page: fitz.Page, metrics: tuple[int, int, int, float, float]) -> None:
    method_count, min_runs, max_runs, min_rho, max_rho = metrics
    page.draw_rect(fitz.Rect(0, 233, W, H), color=None, fill=PALE_BLUE)
    page.draw_line((0, 233), (W, 233), color=TEAL, width=1.4)
    label(page, "SIMULATED GSD DEMO", 20, 252, 13, bold=True)
    label(page, "19 genes × 2,000 cells", 211, 252, 13)
    label(page, f"{method_count}/{method_count} methods completed", 429, 252, 13)
    label(page, f"{min_runs}–{max_runs} bootstrap fits per method", 20, 275, 13)
    label(page, f"median replicate ρ: {min_rho:.3f}–{max_rho:.3f}", 276, 275, 13)
    label(page, "no uploaded reference network", 526, 275, 13)


def build() -> None:
    if not FONT.is_file() or not BOLD.is_file():
        raise FileNotFoundError("Arial fonts are required to recreate this artwork")
    doc = fitz.open()
    page = doc.new_page(width=W, height=H)
    page.insert_font(fontname="Arial", fontfile=str(FONT))
    page.insert_font(fontname="Arial-Bold", fontfile=str(BOLD))
    page.draw_rect(fitz.Rect(0, 0, W, H), color=None, fill=WHITE)
    page.draw_rect(fitz.Rect(0, 0, W, 35), color=None, fill=NAVY)
    label(page, "GRNScope", 20, 24, 16, bold=True, color=WHITE)
    page.draw_line((132, 8), (132, 27), color=rgb("#7092A5"), width=0.9)
    label(page, "Single-cell gene regulatory network inference with inspectable evidence", 147, 24, 14, color=WHITE)

    panel(page, 12, 158, BLUE)
    panel(page, 170, 424, TEAL)
    panel(page, 436, 708, ORANGE)
    arrow(page, 159, 169, 135)
    arrow(page, 425, 435, 135)
    draw_input(page)
    draw_analysis(page)
    draw_output(page)
    footer(page, load_demo_metrics())

    doc.set_metadata({
        "title": "GRNScope graphical abstract",
        "subject": "Input, preprocessing, 13 inference methods, cell bootstraps, three evidence views, and verified demonstration summary",
        "creator": "GRNScope manuscript figure source",
    })
    doc.save(HERE / "graphical_abstract.pdf", garbage=4, deflate=True)
    svg = page.get_svg_image(text_as_path=False)
    assert "<text" in svg  # Text remains editable in the SVG.
    (HERE / "graphical_abstract.svg").write_text(svg)
    pix = page.get_pixmap(matrix=fitz.Matrix(600 / 72, 600 / 72), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    image.save(HERE / "graphical_abstract.tif", compression="tiff_lzw", dpi=(600, 600))
    image.resize((1800, 720), Image.Resampling.LANCZOS).save(HERE / "graphical_abstract_preview.png")
    doc.close()
    with fitz.open(HERE / "graphical_abstract.pdf") as check:
        spans = [
            span
            for block in check[0].get_text("dict")["blocks"] if "lines" in block
            for line in block["lines"] for span in line["spans"]
        ]
        assert tuple(check[0].rect) == (0.0, 0.0, W, H)
        assert spans and min(span["size"] for span in spans) >= 12
        assert all("Arial" in span["font"] for span in spans)
    print("Created detailed graphical abstract: editable PDF/SVG, 600-dpi TIFF, PNG preview")


if __name__ == "__main__":
    build()
