# Visualization design reference: Oviz-Bio

Research date: 2026-09-19. This records a reference review, not an approved implementation specification or a change to application behavior.

## Intent

The user identified Oviz-Bio as a website previously published by their boss and asked us to understand its visual language before redesigning GRNScope plots and tables. The user's stated priorities are professional presentation, rich data, and white backgrounds suitable for figures in papers.

Working interpretation: design complete scientific figures whose evidence, encodings, labels, and context remain understandable outside the website. This is an inference from the examples, not a claim that the boss has approved these requirements.

## Examples actually inspected

Used the live Demo File Sets selector and Apply button. Inspected rendered figures in the light theme, with editor controls hidden where practical.

- [Landscape](https://bio.oviz.org/demo-project/analyses/landscape): `PMID24121792.Fig1`, `PMID22960745.Fig1`, `PMID28112728.Fig1`, `landscape_demo`, `PMID24952746.Fig1a_Fig2`, and `PMID25581428.Fig2`.
- [Mut: On Genes](https://bio.oviz.org/demo-project/analyses/MutationOnGenes): `MutOnGenes_CSV_hg19`, displaying VHL with mutation symbols, coverage, DNA/cDNA/protein tracks, domains, and a symbol legend.
- [SNV: Signature](https://bio.oviz.org/demo-project/analyses/SNVSignature): `SNV_Signature_demo`, displaying repeated 96-category profiles and reference-similarity summaries.
- [CNV: Overview](https://bio.oviz.org/demo-project/analyses/CNV_circos_view): `demo file`, displaying many sample rings organized by chromosome.
- [SV: Heatmap](https://bio.oviz.org/demo-project/analyses/SV-heatmap): `PE_res25_hg19_ALK-KIF5B`, displaying a coordinated 2-by-2 matrix, intensity scale, genomic coordinates, chromosome ideograms, and breakpoint markers.

Also read the Landscape manual and inspected its General controls: column width, missing-data color, sample ordering, filtering, and panel controls. The manual documents SVG download and white-background light mode. The Download button was activated; the downloaded file itself was not inspected, so export fidelity has not been verified.

## Observed visual principles

1. **Compose related evidence into one figure.** Landscape aligns sample-level histograms above a matrix, gene frequencies beside it, and clinical/pathway annotations below it. These are meaningful shared-coordinate relationships.
2. **Use ordering to reveal structure.** Several demos show stepped patterns across gene rows; annotation tracks retain the same sample order. Reordering is part of interpretation, not merely a cosmetic option.
3. **Keep marks compact and precise.** Flat fills, narrow bars, thin strokes, compact sans-serif labels, and simple legends allow substantial information to occupy the figure.
4. **Use color and shape as encodings.** Mutation types use categorical colors; numeric tracks use gradients; mutation-on-genes uses distinct shapes as well as color. Missing observations have explicit markings in Landscape.
5. **Repeat a visual grammar for comparison.** Signature rows keep the same 96-category order and category bands. Their y-axis limits vary, so repeated layouts should not automatically be described as identical numeric scales.
6. **Attach biological context to quantitative evidence.** Gene and pathway names, chromosome coordinates, protein domains, clinical annotations, and count/percentage scales help explain what the marks mean.
7. **Separate the figure surface from the application.** Light mode makes the figure white while the surrounding navigation remains dark. A white website alone would not accomplish this.
8. **Support adjustment and export as part of analysis.** Researchers can change ordering, colors, widths, and panels. The site's homepage explicitly describes downloadable tables and visualizations for publications.

## Adaptation proposed for GRNScope

These are recommendations, not features verified in Oviz-Bio or a request to implement them immediately.

- Adopt a shared white figure canvas, dark readable text, thin axes and rules, restrained spacing, and consistent semantic colors across all result pages.
- Evaluate figures at their intended paper dimensions. Dense data is useful only if essential labels and legends survive reduction.
- Give the network a scientific composition: stable, readable node placement; explicit direction and sign conventions; explained node sizes and edge widths; and companion evidence panels when they answer the same biological question.
- Possible companion views include a ranked regulator plot or a regulator-by-method support matrix. Choose only metrics actually available and relevant to the question. Do not conflate confidence, evidence, support, or regulatory sign.
- Keep exploration interactive, but ensure the exported figure contains the legends, scales, labels, and selected-data scope required to interpret it without hover or sidebars.
- Make figure ordering, thresholds, dimensions, and layout reproducible. Export the selected scientific content without navigation, editor panels, selection handles, or hover highlights.
- Prefer vector SVG/PDF outputs where supported, plus high-resolution raster output when needed. This is a proposed GRNScope export standard; Oviz-Bio's Landscape manual specifically documents SVG.
- For tables, use compact rows, clear grouped headers, aligned numeric columns, consistent precision, units, explicit missing values, and footnotes for statistical definitions. Provide a clean publication export and the underlying data. This table guidance is extrapolated from the figure language; the review did not establish an Oviz-Bio publication-table template.

## Details to improve instead of copying literally

- Some labels are too small for comfortable reading, and wide figures overflow the viewport.
- Some examples retain placeholder axis labels such as `_Change_Me_In_SideBar_`.
- Category colors change meaning between Landscape demos; use a stable mapping within GRNScope.
- Fine matrix borders can become visually dominant at reduced size.
- The signature similarity gauges retain dark disks in light mode; simple labeled values or compact bars may be more suitable for our paper figures.
- Large data volume alone is not a design goal. Each panel should support a question or supply context needed to interpret another panel.

## Practical redesign approach

Audit all plots and tables against this standard. First produce one representative network composition, one statistical figure, and one results table using real project data; inspect their exported appearance at paper size. Once the visual direction is confirmed, propagate the shared system and refactor individual views as needed. The reference supports a consistent figure system, but does not by itself justify replacing every plotting implementation.

## Sources

- [Oviz-Bio homepage: customization and export](https://bio.oviz.org/)
- [Landscape manual and demos](https://bio.oviz.org/demo-project/analyses/landscape)
- The individual example pages linked above.

The earlier local `frontend/docs/network-gallery-styles.md` records appearance experiments involving dark surfaces and shaded nodes. This new reference suggests shifting the design emphasis toward scientific composition, explanatory context, and publication output. No current live GRNScope screen was audited during this reference review.
