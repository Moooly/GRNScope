# GRNScope graphical abstract

`graphical_abstract.pdf` is the editable review file. `graphical_abstract.tif` is a 600-dpi raster alternative. `graphical_abstract.svg` is editable source artwork, `graphical_abstract_preview.png` is for review, and `build_graphical_abstract.py` recreates all four outputs on macOS with PyMuPDF, Pillow and the system Arial fonts.

The visual reads left to right: single-cell expression and supplied pseudotime → input checks and preprocessing → all 13 selected GRN inference methods with cell bootstraps and early stopping → distinct rank, recovery and overlap views. The matrix, example network, bar marks and heatmap are schematic. They do not encode the demo project's numerical results or establish biological accuracy. This is an original graphical abstract, separate from Figures 1–3.

The footer contains verified values from project `3ac71f2c61bd`: the bundled simulated GSD example has 19 genes and 2,000 cells; all 13 selected methods completed; their automatic runs completed 3–7 cell-bootstrap fits per method. The displayed 0.415–0.999 range is the range across methods of the **median pairwise Spearman correlation among replicate rankings**. It is not network accuracy. This project had no uploaded reference network. Source values are in the adjacent `../case_study_method_summary.csv`.

## NAR format check

- Landscape, 5:2 aspect ratio, 10 × 4 inches (254 × 101.6 mm), exceeding NAR's 5 × 2 inch minimum.
- Arial and Arial Bold text at 12–16 pt in the editable PDF. This intentionally dense version is meant for full-size review; reduction to 5 × 2 inches will make the smallest text approximately 6 pt.
- Colour used with shape and placement cues; the dense method list and verified case-study footer answer the request for more detail.
- Editable PDF with embedded fonts, plus a 6000 × 2400 pixel TIFF at 600 dpi.
- File stem `graphical_abstract`, intended for the graphical-abstract upload slot rather than embedding as a numbered manuscript figure.
- Final PDF passed the rendered text-size and collision checks.

**Suggested alt text:** A left-to-right diagram shows a stylized expression matrix and pseudotime entering GRNScope. The software checks and preprocesses the input, runs 13 named inference methods and repeats fits on cell-bootstrap samples with early stopping. Three output areas distinguish within-target edge rank, recovery in bootstrap replicates and top-50 network overlap among methods. A footer identifies the simulated GSD demo, its 19 genes and 2,000 cells, completion of all 13 methods, 3–7 bootstrap fits per method, a 0.415–0.999 range of median replicate-rank correlations, and the absence of an uploaded reference network. The network and charts are schematic, not validated biological results.

**AI-use disclosure draft for the cover letter and manuscript Acknowledgements or Methods:** “An OpenAI Codex assistant helped design and generate the graphical abstract as editable vector artwork. The authors reviewed and verified its scientific content and are responsible for the final figure.” The authors should review and adapt this statement to reflect their actual oversight before submission.

NAR's [author guidelines](https://academic.oup.com/nar/pages/author-guidelines) require a separate, original 5:2 graphical abstract with large sans-serif labels. The [Web Server Issue instructions](https://academic.oup.com/nar/pages/Submission_Webserver) request it as an additional file. [OUP journal AI policy](https://academic.oup.com/pages/for-authors/journals/preparing-and-submitting-your-manuscript/ai-principles-for-oxford-journals/policy-on-ai-use-and-disclosure-for-oxford-journals-authors) permits illustrative graphical abstracts made with AI with disclosure; NAR's author guidelines also call for disclosure in the cover letter and manuscript. Requirements checked 15 October 2026.
