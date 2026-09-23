"use client";

import { createPortal } from "react-dom";

type NetworkHelpModalProps = {
  onClose: () => void;
  isClosing?: boolean;
  galaxy?: boolean;
};

export default function NetworkHelpModal({
  onClose,
  isClosing = false,
  galaxy = false,
}: NetworkHelpModalProps) {
  return createPortal(
  <div
    className={`fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px] ${
      isClosing
        ? "animate-modal-overlay-out"
        : "animate-modal-overlay"
    }`}
    onClick={onClose}
    role="presentation"
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-visual-guide-title"
      aria-describedby="network-visual-guide-summary"
      className={`network-help-modal flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-slate-900 shadow-2xl ${
        isClosing
          ? "animate-modal-panel-out"
          : "animate-modal-panel"
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
        <div>
          <h3
            id="network-visual-guide-title"
            className="text-lg font-extrabold tracking-tight text-slate-950"
          >
            Understanding the network
          </h3>
          <p
            id="network-visual-guide-summary"
            className="mt-1 text-sm leading-5 text-slate-500"
          >
            How genes, regulations, evidence, confidence, and controls
            work together.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
          aria-label="Close visual guide"
        >
          ×
        </button>
      </header>

      <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
        <section>
          <h4 className="font-extrabold text-slate-900">
            What is currently drawn
          </h4>
          <p className="mt-2">
            Results Settings first selects the result scope and methods,
            then applies minimum evidence, bootstrap confidence,
            direction confidence, sign stability, and—when comparing
            methods—minimum support. Search genes filters the network to matching relationships.
            Focus explicitly narrows the graph to its direct neighborhood.
          </p>
          <p className="mt-2">
            {galaxy ? "The network shows every relationship passing your Results Settings filters. " : "The graph draws the first requested number of matching edges"}
            {!galaxy && " in saved rank order and only the genes connected by those edges. "}
            Isolating a gene keeps its directly incident edges;
            it does not recalculate evidence or rank.
          </p>
        </section>

        <section className="mt-5 border-t border-slate-100 pt-5">
          <h4 className="font-extrabold text-slate-900">Reading the atlas</h4>
          {galaxy ? <>
            <p className="mt-2">Blue circles are transcription factors; mint circles are other genes. Each circle is split by the direction of its links: the darker part regulates other genes, the lighter part is regulated by them, and the palest part has no known direction. The gene name sits inside its circle and may extend past a small one. Bigger circles have more links; choose what size counts under Display → Node size: the genes it regulates (Targets), all its connections, or its regulators. Teal links are predicted activation, clay links repression, and grey links an unresolved sign. Click a count in the Links line above the network to show only those links; genes keep their places. Line width (Display → Line width) shows evidence or method support in four fixed steps; opacity shows bootstrap confidence (solid ≥ 0.8, faint 0.5–0.8, very faint below 0.5; relationships without a verified value are solid). Strong relationships are drawn on top of weak ones, and a link that passes under a gene it does not connect is drawn lighter.</p>
            <p className="mt-2">Activation uses an arrowhead (→); repression uses a perpendicular bar (⊣). Each marks the regulated gene only when direction is supported. No tip means direction is unresolved, not bidirectional. A hollow arrowhead has a resolved direction but an unresolved sign. Separate lanes keep reciprocal records distinguishable.</p>
            <p className="mt-2">The force layout aims for the same rim-to-rim length on every link, and single-link genes sit on an arc around their hub. In dense networks only each gene’s three strongest links (by evidence) position it; every link is still drawn, and weaker ones may be long. The network opens at evidence ≥ 0.5; change this in Results Settings. Focus neighborhood shows all matching direct relationships of the selected gene. Layout groups describe connectivity, not biological modules.</p>
            <p className="mt-2">Select a gene to pin its label. Pinned names have first priority; in larger networks names that would overlap are hidden until you zoom. Display → Spacing moves genes apart without changing their sizes or zoom, and Display → Reset layout recomputes the arrangement. The corner button next to − and + fits the whole network in view. Selection and width changes preserve node positions; changing Node size recomputes the layout. Arrow keys browse genes; Escape clears selection.</p>
            <p className="mt-2">SVG and high-resolution PNG exports include the complete displayed network, fixed labels, legend, methods, counts, and filter context. Export fits a separate copy so zoom and selection cannot crop the figure or dim its connections. The SVG is sized for a 180 mm figure; inspect legibility before reducing it further.</p>
          </> : <>
            <p className="mt-2">Shape identifies transcription factors and other genes. Arrowheads indicate predicted activation; perpendicular bar tips indicate predicted repression. Tips are placed at the affected gene; when direction is unresolved, the edge retains its sign color but has no tip. Line width shows the selected metric.</p>
            <p className="mt-2">Connected groups describe topology, not proven biological modules. Export includes the current view, legend, methods and filter context.</p>
          </>}
        </section>

        <section className="mt-5 border-t border-slate-100 pt-5">
          <h4 className="font-extrabold text-slate-900">
            How the metrics are calculated
          </h4>
          <p className="mt-2">
            Select a metric to see its calculation and a small example.
            Percentages describe algorithmic agreement and stability;
            they are not probabilities of biological causality.
          </p>
          <div className="mt-3 space-y-2">
            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Regulation evidence
                <span className="ml-2 text-xs font-normal text-slate-500">
                  normalized strength for a target
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  For one method, evidence is the target-specific rank
                  converted to a 0–1 scale:
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="E sub m of e equals one minus the edge rank minus one divided by the number of retained candidates for the target minus one"
                  >
                    <mrow>
                      <msub><mi>E</mi><mi>m</mi></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo><mn>1</mn><mo>−</mo>
                      <mfrac>
                        <mrow><msub><mi>r</mi><mi>m</mi></msub><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>−</mo><mn>1</mn></mrow>
                        <mrow><msub><mi>R</mi><mi>t</mi></msub><mo>−</mo><mn>1</mn></mrow>
                      </mfrac>
                    </mrow>
                  </math>
                </div>
                <p>
                  The best-ranked regulator has evidence 1 and the
                  lowest-ranked retained candidate has evidence 0. With
                  multiple methods, consensus evidence is the mean across
                  selected methods; a method without the edge contributes
                  0.
                </p>
                <p className="text-xs text-slate-500">
                  Here, <em>rₘ(e)</em> is the edge&apos;s target-specific rank
                  for method <em>m</em>, and <em>Rₜ</em> is the number of
                  retained candidates for target <em>t</em>. If only one
                  candidate is retained, its evidence is 1.
                </p>
                <p className="text-xs text-slate-500">
                  Example: with 5 retained candidates, rank 1 gives 1.00;
                  rank 3 gives 0.50.
                </p>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Confidence runs and bootstrap confidence
                <span className="ml-2 text-xs font-normal text-slate-500">
                  recovery across resampled cells
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  Each confidence run samples the original cells with
                  replacement, reruns the algorithm, and checks whether
                  the edge ranks within the configured{" "}
                  <strong className="text-slate-800">Recovery rank</strong>{" "}
                  for its target. Recovery rank is the top percentage of
                  retained candidates that counts as recovered. For
                  example, a top-20% recovery rank accepts an edge only
                  when it falls within the strongest 20% of candidates
                  for that target.
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="C sub m of e equals the number of recovered runs divided by the total number of confidence runs"
                  >
                    <mrow>
                      <msub><mi>C</mi><mi>m</mi></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mfrac>
                        <msub><mi>N</mi><mtext>recovered</mtext></msub>
                        <msub><mi>B</mi><mi>m</mi></msub>
                      </mfrac>
                    </mrow>
                  </math>
                </div>
                <p className="text-xs text-slate-500">
                  <em>N</em><sub>recovered</sub> is the number of runs in
                  which the edge meets the recovery-rank rule, and
                  <em> Bₘ</em> is the total completed confidence runs.
                </p>
                <p>
                  Automatic mode starts with 3 runs and stops when
                  consecutive aggregate rankings stabilize, up to 50
                  runs. Fixed mode runs the selected 3–50 runs exactly.
                  Changing Recovery rank changes which runs count as
                  recovered and recalculates confidence from the saved
                  runs; it does not rerun the algorithms.
                </p>
                <p className="text-xs text-slate-500">
                  Example: recovered in 8 of 10 runs gives 80% confidence.
                  For a consensus edge, confidence is the median of the
                  supporting methods&apos; confidences:
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="Consensus confidence of e equals the median of method confidence for methods supporting e"
                  >
                    <mrow>
                      <msub><mi>C</mi><mtext>cons</mtext></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mi mathvariant="normal">median</mi>
                      <mo stretchy="false">&#123;</mo>
                      <msub><mi>C</mi><mi>m</mi></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>|</mo><mi>m</mi><mo>∈</mo><msub><mi>S</mi><mi>e</mi></msub>
                      <mo stretchy="false">&#125;</mo>
                    </mrow>
                  </math>
                </div>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Rank
                <span className="ml-2 text-xs font-normal text-slate-500">
                  saved display order
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  Edges are ordered by bootstrap confidence first and
                  evidence second. Lower rank numbers indicate a stronger
                  position in the saved result ordering.
                </p>
                <p className="text-xs text-slate-500">
                  Example: an edge with 90% confidence ranks above one
                  with 70% confidence, even if the latter has slightly
                  higher evidence.
                </p>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Direction confidence and coverage
                <span className="ml-2 text-xs font-normal text-slate-500">
                  agreement on the arrow direction
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  For each direction-aware method, F is evidence for A →
                  B and R is evidence for B → A. The website calculates:
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="Direction confidence equals the absolute sum over direction-aware methods of forward evidence minus reverse evidence divided by the sum of forward plus reverse evidence"
                  >
                    <mrow>
                      <msub><mi>D</mi><mtext>conf</mtext></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mfrac>
                        <mrow><mo>|</mo><munder><mo>∑</mo><mrow><mi>m</mi><mo>∈</mo><mi>𝒟</mi></mrow></munder><mo stretchy="false">(</mo><msub><mi>F</mi><mi>m</mi></msub><mo>−</mo><msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo><mo>|</mo></mrow>
                        <mrow><munder><mo>∑</mo><mrow><mi>m</mi><mo>∈</mo><mi>𝒟</mi></mrow></munder><mo stretchy="false">(</mo><msub><mi>F</mi><mi>m</mi></msub><mo>+</mo><msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo></mrow>
                      </mfrac>
                    </mrow>
                  </math>
                </div>
                <p className="text-xs text-slate-500">
                  <em>𝒟</em> is the set of direction-aware methods;
                  <em> Fₘ</em> and <em>Rₘ</em> are their evidence for the
                  forward and reverse orientations. The displayed arrow
                  follows the sign of the numerator&apos;s inner sum.
                </p>
                <p>
                  The larger total determines the displayed arrow. A
                  value near 0 means the evidence is split; it does not
                  mean the reverse direction is likely. Coverage is the
                  share of total edge evidence supplied by methods that
                  can infer direction.
                </p>
                <p className="text-xs text-slate-500">
                  Example: forward evidence 1.0 and reverse evidence 0.2
                  gives |1.0 − 0.2| ÷ 1.2 = 66.7% direction confidence.
                </p>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Regulatory sign and sign stability
                <span className="ml-2 text-xs font-normal text-slate-500">
                  activation or repression agreement
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  A positive raw score is activation, a negative raw score
                  is repression, and zero or unsigned is unannotated. For
                  consensus, methods cast evidence-weighted signed votes:
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="S of e equals the sign of the sum over methods of evidence times the method sign"
                  >
                    <mrow>
                      <mi>S</mi><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo><mi mathvariant="normal">sgn</mi>
                      <mo stretchy="false">(</mo>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <msub><mi>E</mi><mi>m</mi></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <msub><mi>s</mi><mi>m</mi></msub>
                      <mo stretchy="false">)</mo>
                    </mrow>
                  </math>
                </div>
                <p className="text-xs text-slate-500">
                  Each method sign <em>sₘ</em> is +1 for activation, −1
                  for repression, or 0 when the method is unsigned.
                </p>
                <p>
                  Sign stability is calculated among recovered runs with
                  a nonzero sign:
                </p>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="Sign stability equals the number of signed runs agreeing with the displayed sign divided by the total number of positive and negative signed runs"
                  >
                    <mrow>
                      <msub><mi>S</mi><mtext>stab</mtext></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mfrac>
                        <msub><mi>N</mi><mtext>agree</mtext></msub>
                        <mrow><msub><mi>N</mi><mo>+</mo></msub><mo>+</mo><msub><mi>N</mi><mo>−</mo></msub></mrow>
                      </mfrac>
                    </mrow>
                  </math>
                </div>
                <div className="overflow-x-auto rounded-lg bg-white px-3 py-3 text-center text-slate-800">
                  <math
                    display="block"
                    aria-label="Sign coverage equals the number of positive and negative signed runs divided by the total number of recovered runs"
                  >
                    <mrow>
                      <msub><mi>S</mi><mtext>cov</mtext></msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mfrac>
                        <mrow><msub><mi>N</mi><mo>+</mo></msub><mo>+</mo><msub><mi>N</mi><mo>−</mo></msub></mrow>
                        <msub><mi>N</mi><mtext>recovered</mtext></msub>
                      </mfrac>
                    </mrow>
                  </math>
                </div>
                <p className="text-xs text-slate-500">
                  <em>N</em><sub>agree</sub> counts signed runs matching
                  the displayed activation or repression; zero-sign runs
                  are excluded from stability but remain in the coverage
                  denominator.
                </p>
                <p>
                  Sign coverage is the share of all recovered runs that
                  supplied a nonzero sign. Zero-sign runs reduce coverage
                  but are not treated as positive or negative disagreement.
                </p>
                <p className="text-xs text-slate-500">
                  Example: 6 positive, 2 negative, and 2 zero-sign
                  recoveries for an activation edge gives 6 ÷ 8 = 75%
                  stability and 8 ÷ 10 = 80% coverage.
                </p>
              </div>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer list-none font-bold text-slate-800 marker:hidden">
                Support and method evidence
                <span className="ml-2 text-xs font-normal text-slate-500">
                  which methods report the edge
                </span>
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm leading-6">
                <p>
                  Support is the number of selected methods that report
                  the edge. The inspection panel lists each supporting
                  method&apos;s normalized full-data evidence so a consensus
                  edge can be audited.
                </p>
                <p className="text-xs text-slate-500">
                  Example: 3 of 5 selected methods report the edge, so
                  support is 3/5; the other two contribute zero to
                  consensus evidence.
                </p>
              </div>
            </details>
          </div>
        </section>

      </div>
    </section>
  </div>,
    document.body,
  );
}
