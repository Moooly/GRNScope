"""Build a standalone, editable LaTeX review manuscript from the checked draft.

Run from anywhere: python3 GRNScope/docs/manuscript/build_latex.py
The generated .tex uses the figure PNGs in this manuscript folder's figures/ directory.
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "grnscope_nar_web_server_v1.md"
TARGET = HERE / "grnscope_nar_web_server_v1.tex"

CITES = {
    "1": "pratapa2020",
    "2": "chan2017",
    "3": "huynhthu2010",
    "4": "moerman2019",
    "5": "kamimoto2023",
    "6": "beeline_docs",
}


def plain(value: str) -> str:
    """Escape prose while retaining standard TeX punctuation."""
    value = value.replace("–", "--").replace("—", "---")
    value = value.replace("×", r"\(\times\)").replace("≥", r"\(\geq\)")
    value = value.replace("González", r"Gonz\'{a}lez")
    value = value.replace("%", r"\%").replace("&", r"\&").replace("_", r"\_")
    value = value.replace("#", r"\#")
    return value


def inline(value: str) -> str:
    tokens: list[str] = []

    def keep(text: str) -> str:
        tokens.append(text)
        return f"ZZTOKEN{len(tokens) - 1}ZZ"

    value = re.sub(r"\\\(.*?\\\)", lambda m: keep(m.group()), value)
    value = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: keep(r"\href{" + m.group(2) + "}{" + plain(m.group(1)) + "}"),
        value,
    )
    value = re.sub(
        r"\[(\d+(?:,\d+)*)\]",
        lambda m: keep(r"\cite{" + ",".join(CITES[n] for n in m.group(1).split(",")) + "}"),
        value,
    )
    value = re.sub(r"`([^`]+)`", lambda m: keep(r"\texttt{" + plain(m.group(1)) + "}"), value)
    value = re.sub(r"\*\*(.*?)\*\*", lambda m: keep(r"\textbf{" + plain(m.group(1)) + "}"), value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", lambda m: keep(r"\emph{" + plain(m.group(1)) + "}"), value)
    value = plain(value)
    for index, token in enumerate(tokens):
        value = value.replace(f"ZZTOKEN{index}ZZ", token)
    return value


def blocks(text: str) -> list[str]:
    return [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]


def figure(number: int, caption: str) -> str:
    files = {
        1: "figure_1_detailed_workflow.png",
        2: "figure_2_website_network.png",
        3: "figure_3_website_comparison.png",
    }
    labels = {1: "workflow", 2: "network", 3: "comparison"}
    return "\n".join(
        [
            r"\begin{figure}[p]",
            r"\centering",
            rf"\includegraphics[width=\linewidth,height=0.68\textheight,keepaspectratio]{{{files[number]}}}",
            rf"\caption{{{inline(caption)}}}",
            rf"\label{{fig:{labels[number]}}}",
            r"\end{figure}",
        ]
    )


def main() -> None:
    source = SOURCE.read_text()
    manuscript = source.split("\n---\n", 1)[0]
    entries = blocks(manuscript)
    title = entries[0].removeprefix("# ")
    assert entries[1].startswith("**Working manuscript draft")

    lines = [
        r"\documentclass[11pt]{article}",
        r"\usepackage[utf8]{inputenc}",
        r"\usepackage[T1]{fontenc}",
        r"\usepackage[margin=1in]{geometry}",
        r"\usepackage{graphicx}",
        r"\usepackage[hidelinks]{hyperref}",
        r"\graphicspath{{figures/}}",
        r"\setlength{\parindent}{0pt}",
        r"\setlength{\parskip}{0.45em}",
        rf"\title{{{plain(title)}}}",
        r"\author{Author details to be supplied}",
        r"\date{15 October 2026}",
        r"\begin{document}",
        r"\maketitle",
        r"\begin{center}\small\emph{Working draft; public URL and validation study pending.}\end{center}",
    ]

    section = ""
    references: list[str] = []
    figures: list[str] = []
    for entry in entries[2:]:
        if entry.startswith("## "):
            section = entry[3:]
            if section == "Abstract":
                lines.append(r"\begin{abstract}")
            elif section == "Figure legends":
                lines.append(r"\clearpage")
            elif section == "References":
                lines.extend(figures)
                lines.append(r"\clearpage")
                lines.append(r"\begin{thebibliography}{9}")
            else:
                lines.append(rf"\section{{{plain(section)}}}")
            continue
        if entry.startswith("### "):
            lines.append(rf"\subsection{{{plain(entry[4:])}}}")
            continue
        if section == "Abstract":
            if entry.startswith("**Keywords:"):
                lines.append(r"\end{abstract}")
                lines.append(inline(entry))
                section = "Keywords"
            else:
                lines.append(inline(entry))
            continue
        if section == "Figure legends":
            match = re.match(r"\*\*Figure ([123])\. (.*?)\*\*\s*(.*)", entry, re.S)
            if match:
                number = int(match.group(1))
                caption = match.group(2).rstrip(".") + ". " + match.group(3)
                figures.append(figure(number, caption))
            # "View Figure" Markdown links are omitted: the figures are embedded.
            continue
        if section == "References":
            for item in entry.splitlines():
                match = re.match(r"(\d+)\. (.*)", item)
                if match:
                    references.append(rf"\bibitem{{{CITES[match.group(1)]}}} {inline(match.group(2))}")
            continue
        lines.append(inline(entry))

    lines.extend(references)
    lines.extend([r"\end{thebibliography}", r"\end{document}"])
    output = "\n\n".join(line for line in lines if line) + "\n"
    assert output.count(r"\begin{abstract}") == output.count(r"\end{abstract}") == 1
    assert output.count(r"\begin{figure}") == 3
    assert output.count(r"\bibitem") == 6
    TARGET.write_text(output)
    print(TARGET)


if __name__ == "__main__":
    main()
