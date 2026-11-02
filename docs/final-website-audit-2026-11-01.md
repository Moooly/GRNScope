# GRNScope final website audit

Reviewed November 1, 2026 (America/Toronto). Changes are local and have not been deployed.

## Fixed

- **Continuous status requests on Home and Projects.** Each status response created a new array of active project IDs, restarting the effect and immediately requesting status again. The effect now uses a stable, sorted key. Polling waits five seconds after completion, aborts on navigation, and includes stopping jobs.
- **Missing final results.** The detail page previously aborted its polling request when that request changed the last task from Running to Completed. Loading now has a project-scoped lifecycle independent of task status, allowing final edges and metadata to finish.
- **Stale responses and rerun results.** Navigation and explicit refresh cancel superseded requests. Completed result revisions are revalidated, including reruns with the same job ID. Preview results cannot satisfy a full-result request. A failed preview still attempts the complete files.
- **Repeated graph work.** Unchanged result objects and project/metadata manifests retain their identity; a batch of edges is published together instead of rebuilding for each method response. The result cache retains at most three projects and drops superseded jobs.
- **State leaking between project routes.** Detail-page content is keyed by project ID, resetting filters, selected genes, and other project-specific state on navigation.
- **Empty demo opening view.** The old defaults excluded every relationship. The demo now opens at evidence 0.55, no confidence cut, and support from at least seven methods: 19 genes and 56 relationships. Scores and analysis calculations are unchanged.
- **Misleading empty project history after connection failure.** Home and Projects now show an error with a retry action and retain any previously loaded projects.
- **Invalid zero dimensions.** Missing gene/cell counts remain unknown instead of converting null to zero.
- **Malformed identity cookie.** Invalid percent-encoding no longer crashes every API request.
- **Unfinished registration route.** `/register` now redirects to the existing workspace, matching `/login`.
- **Contact dialog accessibility.** Added dialog naming, focus entry/restoration, Tab wrapping, Escape dismissal, background scroll locking, and a scrollable panel on short viewports. No contact message was sent.
- **Small-screen project grid.** Card columns can shrink to the available width.
- **Navigation and browser title.** Added the site title/description and the Next.js smooth-scroll marker for immediate route scroll restoration.
- **Vulnerable production dependencies.** Updated Next.js from 16.2.2 to 16.4.3 and applied compatible dependency fixes. The full npm audit now reports zero known vulnerabilities across production and development dependencies. A small compatibility adapter lets the older ESLint plugins use the patched minimatch 11.0.3 engine; its installed CommonJS and ESM interfaces are regression-tested.

- **Email unavailable but apparently saved.** Saving a notification address now returns a clear HTTP 503 when SMTP is unavailable, and the browser shows that message while keeping retry available. Contact SMTP work runs outside the request event loop.
- **Deprecated test renderer.** Replaced react-test-renderer with React DOM and jsdom. Existing loading regressions and the new email failure test run against a DOM.
- **Supported tooling runtime.** Added a Node 24 `.nvmrc` and verified the frontend checks on Node 24 LTS.

- **Progress bar alignment.** Removed the positioned actions wrapper that anchored the running progress track to the right-hand controls. The track now spans the complete analysis header. Browser geometry checks matched the header’s left edge and width in download/no-download and expanded states at 1280px and 483px viewport widths. [Verified layout](qa/progress-bar-alignment.png).

- **Solid network nodes.** Removed the direction-based pie slices from canvas nodes, detail icons, and exported figures, along with their legend/help/caption text. TFs use a single blue fill and other genes a single yellow fill. Verified SOX9 in the browser and reran the frontend checks. [Updated network](qa/network-solid-nodes.png).

- **CellOracle excluded from method agreement.** Agreement, overlap, and regulator-comparison figures and their exports now omit CellOracle. A rendered sample with CellOracle plus four other selected algorithms produced only the four comparison methods. Frontend checks passed. [Sample comparison](qa/agreement-without-celloracle.png).

- **Species-safe Circos and mouse support.** Added bundled GENCODE M39 coordinates for mouse (GRCm39). Coordinate lookup, result caches, and the viewer now validate the project's declared species and assembly; mouse genes cannot receive human annotations. Unsupported or undeclared species disable Circos with an explanation. The figure and exports identify their reference. Browser checks confirmed mouse Sox9 on chromosome 11 and human SOX9 on chromosome 17. [Mouse reference preview using illustrative edges](qa/circos-mouse.png). [Reference details](circos-species.md).

- **Circos workspace and right panel (November 2).** Circos now uses the same split layout, shared panel width/visibility, chart height, title, and responsive key space as Force, Hierarchical, and Circular. Its default Overview shows counts, ranked chromosome connections, chromosome activity, and reference/mapping coverage. Chart and panel share chromosome/ribbon focus; scoped Edges/Genes tables and familiar gene/edge cards remain available. The full reading guide is collapsed inside the panel. Browser measurements confirmed identical Force/Circos chart and panel bounds at 1280px and 483px; resized panel widths persisted across Hierarchical, Circular, and Circos. Checked a live 768px tablet frame, keyboard controls, scope reset, guide expansion, and hide/show. Fixed tablet tab spacing and the show button's stacking above the SVG. [Updated workspace](qa/circos-default-panel.png), [desktop geometry](qa/circos-panel-alignment.json), [phone geometry](qa/circos-panel-mobile-alignment.json).

## Verification

- Backend suite: **229 tests and 65 subtests passed**.
- Frontend network, scientific score, layout, and export suite: **69 tests passed**.
- Loading, cancellation, glob compatibility, and notification UI regression suite: **12 tests passed**.
- ESLint, TypeScript, production build, and whitespace/diff checks passed.
- Python installed-requirement consistency check passed.
- Production HTTP checks passed for Home, Projects, Algorithms, PIDC details, demo, login/register redirects, demo project/metadata/results, and all 12 complete algorithm result payloads.
- The sample ZIP passed an integrity check and contains four files.
- Browser checks covered demo rendering, Comparison, Trajectory, Benchmark, Circos, SVG export action, new-project open/cancel, and contact-dialog keyboard focus and Escape dismissal. Layout was inspected at 528px and 1280px widths; a fresh desktop demo tab reported no browser errors or warnings. [Desktop evidence](qa/final-demo-network.png).
- Static local asset references were checked; no missing referenced assets were found.

- A clean dependency installation (`npm ci`) succeeded. Full npm audit: **0 vulnerabilities**.
- Real synthetic-data smoke test: project creation/upload handlers, preprocessing, fixed two-run bootstrap inference, saved results, and perturbation completed successfully. PEARSON returned 529 edges, Docker GENIE3 535 edges, and CellOracle 122 edges. A STAT3 knockout with three propagation steps completed. [Machine-readable evidence](qa/fresh-analysis-summary.json).
- Actual SMTP client delivery was tested against a loopback-only SMTP receiver for contact messages and one-time completion notifications. A separate test verifies that contact delivery runs outside the request event loop. No external inbox was contacted.
- Real inference smoke test can be repeated from `backend/` with `PYTHONPATH=. .venv/bin/python ../scripts/smoke-analysis.py`; it uses a disposable synthetic dataset outside the user project library and leaves temporary diagnostics for inspection.

## Deferred by request

- Real email service configuration and external inbox delivery are deferred at the user's request. The local sending path and unavailable-service behavior are verified.
- Deployment and checks against the deployed host remain outside this local audit. The real inference smoke test covers representative small synthetic inputs; it is not a large-dataset load test.
