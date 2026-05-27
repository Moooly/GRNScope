from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT_PATH = Path(__file__).resolve().parent / "GRNScope_Consensus_Analysis_Proposal.pdf"

ACCENT = colors.HexColor("#1f78a8")
DARK = colors.HexColor("#0f172a")
TEXT = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748b")
LIGHT_BLUE = colors.HexColor("#eaf5fb")
LIGHT_GRAY = colors.HexColor("#f7f9fc")
BORDER = colors.HexColor("#d9e2ec")
GREEN = colors.HexColor("#2f855a")


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="CoverTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=30,
            alignment=TA_CENTER,
            textColor=DARK,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CoverSubtitle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            alignment=TA_CENTER,
            textColor=MUTED,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            textColor=DARK,
            spaceBefore=14,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SubTitle",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=15,
            textColor=DARK,
            spaceBefore=10,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Body",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.4,
            leading=14,
            textColor=TEXT,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=11,
            textColor=TEXT,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableHeader",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.3,
            leading=10.5,
            textColor=DARK,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableCell",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=10.8,
            textColor=TEXT,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="FormulaCode",
            parent=styles["Code"],
            fontName="Courier",
            fontSize=8.4,
            leading=11.5,
            textColor=colors.HexColor("#1e293b"),
            leftIndent=8,
            rightIndent=8,
            spaceBefore=4,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Callout",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.2,
            leading=13,
            textColor=DARK,
            spaceAfter=0,
        )
    )
    return styles


def p(text, style):
    return Paragraph(text, style)


def bullet_list(items, styles):
    return ListFlowable(
        [ListItem(p(item, styles["Body"]), leftIndent=12) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=16,
        bulletFontName="Helvetica",
        bulletFontSize=7,
        bulletColor=ACCENT,
        spaceAfter=6,
    )


def callout(text, styles, fill=LIGHT_BLUE):
    table = Table([[p(text, styles["Callout"])]], colWidths=[6.45 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#b8d8ea")),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def metric_table(styles):
    data = [
        [
            p("Metric", styles["TableHeader"]),
            p("Question Answered", styles["TableHeader"]),
            p("How It Is Computed", styles["TableHeader"]),
        ],
        [
            p("Consensus evidence", styles["TableCell"]),
            p("Is this regulation strongly supported across algorithms?", styles["TableCell"]),
            p("Normalized Borda-style rank evidence averaged across selected algorithms.", styles["TableCell"]),
        ],
        [
            p("Method support", styles["TableCell"]),
            p("How many algorithms independently support this edge?", styles["TableCell"]),
            p("Count algorithms whose normalized edge evidence passes a support threshold.", styles["TableCell"]),
        ],
        [
            p("Direction agreement", styles["TableCell"]),
            p("Do directed methods agree on A -> B versus B -> A?", styles["TableCell"]),
            p("Evidence-weighted vote from directed algorithms only; undirected methods abstain.", styles["TableCell"]),
        ],
        [
            p("Direction coverage", styles["TableCell"]),
            p("How much evidence can actually vote on direction?", styles["TableCell"]),
            p("Directed evidence divided by total edge evidence.", styles["TableCell"]),
        ],
        [
            p("Sign agreement", styles["TableCell"]),
            p("Do signed methods agree on activation versus repression?", styles["TableCell"]),
            p("Evidence-weighted vote from signed algorithms only; unsigned methods abstain.", styles["TableCell"]),
        ],
        [
            p("Sign coverage", styles["TableCell"]),
            p("How much evidence can actually vote on sign?", styles["TableCell"]),
            p("Signed evidence divided by total edge evidence.", styles["TableCell"]),
        ],
    ]
    table = Table(data, colWidths=[1.35 * inch, 2.35 * inch, 2.75 * inch], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
                ("TEXTCOLOR", (0, 0), (-1, 0), DARK),
                ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def comparison_table(styles):
    data = [
        [
            p("Current 30-run approach", styles["TableHeader"]),
            p("Proposed one-run consensus approach", styles["TableHeader"]),
        ],
        [
            p("Measures repeat stability within each algorithm.", styles["TableCell"]),
            p("Measures agreement across algorithms using one run per algorithm.", styles["TableCell"]),
        ],
        [
            p("Scientifically useful, but very slow for an interactive web app.", styles["TableCell"]),
            p("Much faster and better aligned with a consensus-analysis platform.", styles["TableCell"]),
        ],
        [
            p("Uses terms like confidence and stability from repeated runs.", styles["TableCell"]),
            p("Uses clearer labels: consensus evidence, method support, direction/sign agreement.", styles["TableCell"]),
        ],
    ]
    table = Table(data, colWidths=[3.18 * inch, 3.18 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
                ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 0.55 * inch, letter[0] - doc.rightMargin, 0.55 * inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 0.35 * inch, "GRNScope consensus analysis proposal")
    canvas.drawRightString(letter[0] - doc.rightMargin, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf():
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=letter,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="GRNScope Consensus Analysis Proposal",
        author="GRNScope",
        subject="Proposal to replace repeated algorithm runs with single-run consensus rank aggregation",
    )

    story = []
    story.append(Spacer(1, 0.35 * inch))
    story.append(p("GRNScope Consensus Analysis Proposal", styles["CoverTitle"]))
    story.append(
        p(
            "Replacing 30 repeated runs with single-run Borda-style consensus metrics",
            styles["CoverSubtitle"],
        )
    )
    story.append(p("Prepared for internal review | May 2026", styles["CoverSubtitle"]))
    story.append(Spacer(1, 0.22 * inch))
    story.append(
        callout(
            "Recommendation: run each selected algorithm once, then combine ranked edge lists using normalized Borda-style consensus evidence. Direction and sign should be calculated separately using only algorithms that can vote on those properties.",
            styles,
        )
    )
    story.append(Spacer(1, 0.2 * inch))
    story.append(p("Executive Summary", styles["SectionTitle"]))
    story.append(
        p(
            "The current pipeline estimates confidence by running each algorithm 30 times. This is scientifically useful, but it makes analysis very slow. A faster and more explainable approach is to run each algorithm once and then aggregate algorithm rankings across methods.",
            styles["Body"],
        )
    )
    story.append(
        p(
            "This proposal treats GRNScope as a consensus-analysis platform. Each algorithm contributes evidence through its ranked edge list. Directed methods vote on direction, signed methods vote on activation versus repression, and methods that cannot provide those properties abstain from those votes.",
            styles["Body"],
        )
    )
    story.append(comparison_table(styles))
    story.append(Spacer(1, 0.12 * inch))
    story.append(p("Why Raw Algorithm Weights Should Not Be Averaged", styles["SectionTitle"]))
    story.append(
        p(
            "Different algorithms output edge weights on different scales. A larger raw value from one method is not necessarily stronger than a smaller value from another method.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "GENIE3 weight:   0.004\nPIDC weight:     12.7\nPearson weight:  0.82\nSCODE weight:   -3.4",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "The safer method is to use each algorithm's raw weights only to rank edges within that algorithm, then convert ranks into normalized evidence scores before combining algorithms.",
            styles["Body"],
        )
    )

    story.append(PageBreak())
    story.append(p("Proposed Metrics", styles["SectionTitle"]))
    story.append(metric_table(styles))
    story.append(Spacer(1, 0.14 * inch))

    story.append(p("1. Consensus Evidence", styles["SubTitle"]))
    story.append(
        p(
            "Consensus evidence measures how strongly a regulation is supported across all selected algorithms. It is conceptually close to BEELINE's BORDA aggregation.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "b_a(e) = 1 - (rank_a(e) - 1) / (N_a - 1)\n\nConsensusEvidence(e) = weighted average of b_a(e)",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "Here, e is one edge, a is one algorithm, rank_a(e) is the edge rank from that algorithm, and N_a is the number of ranked edges. A top-ranked edge is near 1.0, a middle-ranked edge is near 0.5, and a weak or missing edge is near 0.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "Example evidence:\nGENIE3:     0.95\nGRNBoost2:  0.90\nPIDC:       0.80\nPearson:    0.20\n\nConsensusEvidence = 0.7125",
            styles["FormulaCode"],
        )
    )

    story.append(p("2. Method Support", styles["SubTitle"]))
    story.append(
        p(
            "Method support counts how many algorithms independently support an edge above a chosen threshold, such as top 10 percent or normalized evidence >= 0.9.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted("Support(e) = number of algorithms where b_a(e) >= threshold", styles["FormulaCode"])
    )

    story.append(p("3. Direction Agreement and Coverage", styles["SubTitle"]))
    story.append(
        p(
            "Direction agreement asks whether directed algorithms agree on A -> B versus B -> A. Undirected algorithms still contribute to consensus evidence, but they abstain from direction voting.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "DirectionVote = sum over directed algorithms of weight * (forward evidence - reverse evidence)\n\nDirectionAgreement = abs(DirectionVote) / total directed evidence\nDirectionCoverage = directed evidence / total evidence",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "Coverage is important. A high direction agreement with low direction coverage means the directed algorithms agree, but most total evidence came from undirected methods.",
            styles["Body"],
        )
    )
    story.append(p("Example", styles["SubTitle"]))
    story.append(
        p(
            "For the pair FOXL2 and NR5A1, suppose three directed algorithms and one undirected algorithm report the following evidence:",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "GENIE3:     FOXL2 -> NR5A1, evidence 0.90\nGRNBoost2:  FOXL2 -> NR5A1, evidence 0.80\nSCRIBE:     NR5A1 -> FOXL2, evidence 0.40\nPIDC:       FOXL2 -- NR5A1, evidence 0.95  (undirected, so no direction vote)\n\nDirectionVote = +0.90 +0.80 -0.40 = 1.30\nTotal directed evidence = 0.90 +0.80 +0.40 = 2.10\nDirectionAgreement = 1.30 / 2.10 = 61.9%",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "Interpretation: the directed algorithms lean toward FOXL2 -> NR5A1, but one directed method supports the opposite direction. PIDC still strengthens the evidence that the two genes are related, but it does not vote on arrow direction.",
            styles["Body"],
        )
    )

    story.append(PageBreak())
    story.append(p("4. Sign Agreement and Coverage", styles["SubTitle"]))
    story.append(
        p(
            "Sign agreement asks whether signed algorithms agree that an edge is activating or repressing. Unsigned algorithms can support the edge, but they abstain from sign voting.",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "Activation = +1\nRepression = -1\nUnknown / unsigned = 0\n\nSignVote = sum over signed algorithms of weight * evidence * sign\n\nSignAgreement = abs(SignVote) / total signed evidence\nSignCoverage = signed evidence / total evidence",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "For example, if SCODE and SINCERITIES support activation but PPCOR supports repression, sign agreement reflects the evidence-weighted balance between those votes.",
            styles["Body"],
        )
    )
    story.append(p("Example", styles["SubTitle"]))
    story.append(
        p(
            "For the edge FOXL2 -> NR5A1, suppose the signed and unsigned methods report:",
            styles["Body"],
        )
    )
    story.append(
        Preformatted(
            "SCODE:        activating, evidence 0.80\nSINCERITIES:  activating, evidence 0.70\nPPCOR:        repressing,  evidence 0.30\nGENIE3:       unsigned,    evidence 0.95  (no sign vote)\n\nSignVote = +0.80 +0.70 -0.30 = 1.20\nTotal signed evidence = 0.80 +0.70 +0.30 = 1.80\nSignAgreement = 1.20 / 1.80 = 66.7%\n\nTotal evidence = 0.80 +0.70 +0.30 +0.95 = 2.75\nSignCoverage = 1.80 / 2.75 = 65.5%",
            styles["FormulaCode"],
        )
    )
    story.append(
        p(
            "Interpretation: signed algorithms lean toward activation, but there is some disagreement. GENIE3 supports the edge strongly, but because it is unsigned, it cannot tell whether the regulation is activating or repressing.",
            styles["Body"],
        )
    )

    story.append(p("Recommended User-Facing Labels", styles["SectionTitle"]))
    story.append(
        p(
            "If GRNScope uses one run per algorithm, it is better to avoid calling the main score confidence. With one run, the platform measures cross-method consensus rather than repeat stability.",
            styles["Body"],
        )
    )
    story.append(
        bullet_list(
            [
                "Consensus evidence",
                "Method support",
                "Direction agreement",
                "Direction coverage",
                "Sign agreement",
                "Sign coverage",
            ],
            styles,
        )
    )
    story.append(
        callout(
            "Plain interpretation: consensus evidence asks whether the edge is likely supported; direction agreement asks which way the arrow points; sign agreement asks activation versus repression; coverage shows how much evidence was eligible to vote.",
            styles,
            fill=LIGHT_GRAY,
        )
    )

    story.append(p("Implementation Recommendation", styles["SectionTitle"]))
    story.append(
        bullet_list(
            [
                "Run each selected algorithm once.",
                "Convert each algorithm's ranked edge list into normalized Borda-style evidence.",
                "Use normalized BORDA as the primary consensus evidence score.",
                "Compute method support from the number of algorithms passing the support threshold.",
                "Compute direction agreement using only directed algorithms.",
                "Compute sign agreement using only signed algorithms.",
                "Display direction and sign coverage to prevent overinterpretation.",
            ],
            styles,
        )
    )

    story.append(p("References", styles["SectionTitle"]))
    references = [
        "Pratapa et al. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. Nature Methods, 2020.",
        "BEELINE documentation: BLEvaluator.py Borda aggregation output.",
        "Marbach et al. Wisdom of crowds for robust gene network inference. Nature Methods, 2012.",
    ]
    story.append(bullet_list(references, styles))

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    build_pdf()
