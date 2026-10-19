# Four figures for review

These figures preview a manuscript layout for completed project `3ac71f2c61bd`. They are for review before writing manuscript text.

| Figure | File | Provenance |
| --- | --- | --- |
| 1. Detailed workflow | `figure_1_detailed_workflow.png` | Drawn from this project's saved manifest and completed runs. |
| 2. Inferred network | `figure_2_website_network.png` / `.svg` | Direct export from the live GRNScope Network view. The chart is unchanged. |
| 3. Stability and agreement | `figure_3_website_comparison.png` | Assembly of two unchanged PNG chart exports from the live GRNScope Comparison view. Panel a is repeat-run ranking stability. Panel b is method agreement for each method's top 50 edges. Original PNGs are in `site_exports/`. |
| 4. Beeline comparison concept | `figure_4_SIMULATED_comparison.png` | **All values invented for layout review. No Beeline comparison was run.** Values are in `figure_4_SIMULATED_source_data.csv` and must be replaced before any scientific claim or manuscript submission. |

From the workspace root, run `python3 GRNScope/figures/review_v2/make_figures.py` to regenerate Figures 1, 3, and 4 and copy Figure 2 from `site_exports/`. Use a Python environment with Matplotlib and NumPy installed. Figures 1, 3, and 4 also have PDF, SVG, and TIFF exports. Figure 2 is available in the site's original PNG and SVG formats. The `qa/` folder holds figure checks.

Figure 4's illustrative metrics are rank correlation (Spearman ρ), overlap of the top 50 edges (Jaccard), and GRNScope-to-Beeline runtime ratio. They have no empirical interpretation until the real comparison is run.
