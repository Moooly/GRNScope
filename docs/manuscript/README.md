# Manuscript working files

This directory is a self-contained LaTeX manuscript package. `grnscope_nar_web_server_v1.tex` is the manuscript and `grnscope_nar_web_server_v1.pdf` is its compiled review copy. The three included figure PNGs in `figures/` are used by LaTeX; the matching SVGs are editable figure originals. The per-method source data are in `case_study_method_summary.csv`. The LaTeX was generated from the checked text in `grnscope_nar_web_server_v1.md` with `build_latex.py`. It uses the standard `article` class and has its six references embedded, so no external journal class or bibliography file is needed. Author details and public availability information remain marked for completion.

The separate NAR graphical abstract is in `graphical_abstract/`. Its `README.md` records the technical checks, alt text and AI-use disclosure language. Upload its `graphical_abstract.pdf` or `graphical_abstract.tif` as a separate graphical-abstract file; it is not a numbered manuscript figure.

To regenerate after editing the Markdown source, run `python3 build_latex.py` from this directory, then run `pdflatex -interaction=nonstopmode grnscope_nar_web_server_v1.tex` twice from the same directory. The `.tex` can also be edited directly. Regenerating it from Markdown will overwrite direct LaTeX edits.

This draft supersedes the older `docs/grnscope_nar_webserver_draft.tex` and `docs/grnscope_nar_webserver_expanded_draft.tex` for factual review; those files have unverified placeholders and an outdated bootstrap-confidence description.

`case_study_method_summary.csv` was extracted from `backend/projects/3ac71f2c61bd/results/*/result.json`. The CSV records each method's result status, number of reported edge rows, completed bootstrap count, repeat-run stability summary, early-stopping flag and saved elapsed time. The manuscript cites the first six fields; elapsed times are kept for audit but are not presented as portable performance measurements.

The project expression file is byte-identical to `backend/data/demo_project/inputs/ExpressionData.csv`, identified in the bundled manifest as the BEELINE GSD example. The project's pseudotime rows match the bundled example, with an additional blank first header cell in the uploaded version. This is a workflow demonstration with simulated expression from a curated model, not an independent biological case study.

The current manuscript uses Figures 1–3 from `figures/review_v2/`. Figure 4 is explicitly simulated and excluded from empirical manuscript results. Before journal submission, replace the remaining administrative placeholders and add a real matched Beeline comparison plus a biological use case with independent evidence.
