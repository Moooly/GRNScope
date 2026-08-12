import type { ReactNode } from "react";

function FormulaCard({
  step,
  title,
  formula,
  children,
}: {
  step: number;
  title: string;
  formula: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#087ead] text-[11px] font-extrabold text-white">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h5 className="font-extrabold text-slate-900">{title}</h5>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 [&_math]:min-w-max [&_math]:text-[1.05rem] sm:[&_math]:text-[1.15rem]">
            {formula}
          </div>
          <div className="mt-3 text-xs leading-5 text-slate-600">{children}</div>
        </div>
      </div>
    </article>
  );
}

export default function EdgeCalculationGuide() {
  return (
    <section className="mt-5 border-t border-slate-100 pt-5">
      <h4 className="font-extrabold text-slate-900">
        Exact calculation pipeline
      </h4>
      <p className="mt-2">
        The calculations happen in this order. Subscript <em>m</em> identifies
        a method, <em>b</em> a bootstrap run, and <em>e</em> an edge. Every
        reported value is clipped to the 0–1 range where appropriate.
      </p>

      <div className="mt-3 space-y-3">
        <FormulaCard
          step={1}
          title="Evidence from each method"
          formula={
            <math
              display="block"
              aria-label="E sub m of e equals one minus the fraction r sub m of e minus one over R sub t minus one when R sub t is greater than one; otherwise it equals one"
            >
              <mrow>
                <msub><mi>E</mi><mi>m</mi></msub>
                <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <mo stretchy="true">&#123;</mo>
                <mtable columnalign="left left" rowspacing="0.55em">
                  <mtr>
                    <mtd>
                      <mrow>
                        <mn>1</mn><mo>−</mo>
                        <mfrac>
                          <mrow>
                            <msub><mi>r</mi><mi>m</mi></msub>
                            <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>−</mo><mn>1</mn>
                          </mrow>
                          <mrow>
                            <msub><mi>R</mi><mi>t</mi></msub><mo>−</mo><mn>1</mn>
                          </mrow>
                        </mfrac>
                      </mrow>
                    </mtd>
                    <mtd>
                      <mtext>&nbsp;when&nbsp;</mtext>
                      <msub><mi>R</mi><mi>t</mi></msub><mo>&gt;</mo><mn>1</mn>
                    </mtd>
                  </mtr>
                  <mtr>
                    <mtd><mn>1</mn></mtd>
                    <mtd>
                      <mtext>&nbsp;when&nbsp;</mtext>
                      <msub><mi>R</mi><mi>t</mi></msub><mo>≤</mo><mn>1</mn>
                    </mtd>
                  </mtr>
                </mtable>
              </mrow>
            </math>
          }
        >
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              For each target gene <em>t</em>, take one strongest source →
              target entry per source and sort candidates by descending
              absolute raw method score |xₘ(e)|.
            </li>
            <li>
              <em>rₘ(e)</em> is the edge&apos;s rank within that target. Exact
              score ties receive their average rank; for example, positions 2
              and 3 both receive rank 2.5.
            </li>
            <li>
              <em>Rₜ</em> is the number of ranked regulator candidates for that
              target. The best edge receives evidence 1, the last receives 0,
              and intermediate ranks are linearly spaced.
            </li>
          </ol>
          <p className="mt-2">
            This per-target percentile makes differently scaled algorithm
            scores comparable without treating their raw magnitudes as the
            same unit.
          </p>
        </FormulaCard>

        <FormulaCard
          step={2}
          title="Bootstrap confidence for one method"
          formula={
            <div className="space-y-2">
              <math
                display="block"
                aria-label="I sub m b of e equals one when normalized evidence reaches tau, and zero otherwise"
              >
                <mrow>
                  <msub>
                    <mi>I</mi>
                    <mrow><mi>m</mi><mo>,</mo><mi>b</mi></mrow>
                  </msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                  <mo>=</mo>
                  <mo stretchy="true">&#123;</mo>
                  <mtable columnalign="left left" rowspacing="0.55em">
                    <mtr>
                      <mtd><mn>1</mn></mtd>
                      <mtd>
                        <mtext>&nbsp;if&nbsp;</mtext>
                        <msub>
                          <mi>E</mi>
                          <mrow><mi>m</mi><mo>,</mo><mi>b</mi></mrow>
                        </msub>
                        <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>≥</mo><mi>τ</mi>
                      </mtd>
                    </mtr>
                    <mtr>
                      <mtd><mn>0</mn></mtd>
                      <mtd><mtext>&nbsp;otherwise</mtext></mtd>
                    </mtr>
                  </mtable>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="C sub m of e equals the sum over bootstrap runs of I sub m b of e divided by B sub m, which equals N recovered divided by B sub m"
              >
                <mrow>
                  <msub><mi>C</mi><mi>m</mi></msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>=</mo>
                  <mfrac>
                    <mrow>
                      <munderover>
                        <mo>∑</mo><mrow><mi>b</mi><mo>=</mo><mn>1</mn></mrow>
                        <msub><mi>B</mi><mi>m</mi></msub>
                      </munderover>
                      <msub>
                        <mi>I</mi>
                        <mrow><mi>m</mi><mo>,</mo><mi>b</mi></mrow>
                      </msub>
                      <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                    </mrow>
                    <msub><mi>B</mi><mi>m</mi></msub>
                  </mfrac>
                  <mo>=</mo>
                  <mfrac>
                    <msub><mi>N</mi><mtext>recovered</mtext></msub>
                    <msub><mi>B</mi><mi>m</mi></msub>
                  </mfrac>
                </mrow>
              </math>
            </div>
          }
        >
          <p>
            Each bootstrap run samples the original number of cells with
            replacement, reruns the method, and recalculates the per-target
            evidence. The edge is recovered only when its normalized evidence
            reaches the configured threshold <em>τ</em>. <em>Bₘ</em> is the
            completed run count and <em>Nrecovered</em> is the number of
            recovered runs.
          </p>
          <p className="mt-2">
            The 95% evidence interval is the 2.5th and 97.5th percentiles of
            Eₘᵦ(e) across runs; a run in which the edge is absent contributes
            evidence 0. This interval describes evidence variation, while
            Cₘ(e) describes threshold-based recovery frequency.
          </p>
        </FormulaCard>

        <FormulaCard
          step={3}
          title="Consensus evidence, confidence, support, and rank"
          formula={
            <div className="space-y-2">
              <math
                display="block"
                aria-label="Consensus evidence of e equals one over M times the sum from m equals one to M of E sub m of e"
              >
                <mrow>
                  <msub><mi>E</mi><mtext>cons</mtext></msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>=</mo>
                  <mfrac><mn>1</mn><mi>M</mi></mfrac>
                  <munderover>
                    <mo>∑</mo><mrow><mi>m</mi><mo>=</mo><mn>1</mn></mrow><mi>M</mi>
                  </munderover>
                  <msub><mi>E</mi><mi>m</mi></msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Consensus confidence of e equals the median of C sub m of e for methods m in the support set S sub e"
              >
                <mrow>
                  <msub><mi>C</mi><mtext>cons</mtext></msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>=</mo>
                  <mi mathvariant="normal">median</mi>
                  <mo stretchy="false">&#123;</mo>
                  <msub><mi>C</mi><mi>m</mi></msub>
                  <mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                  <mo>|</mo><mi>m</mi><mo>∈</mo><msub><mi>S</mi><mi>e</mi></msub>
                  <mo stretchy="false">&#125;</mo>
                </mrow>
              </math>
            </div>
          }
        >
          <p>
            <em>M</em> is every selected method. A method without the edge has
            Eₘ(e) = 0, so consensus evidence rewards both strength and breadth.
            Support is the number of selected methods that report the edge.
            Consensus confidence is the median finite bootstrap recovery among
            those supporting methods—not the mean across all methods.
          </p>
          <p className="mt-2">
            Rows are sorted by descending Ccons, then Econs. Exact ties receive
            their average rank, displayed as a tied range in the table. If any
            supporting result uses the older subsampling scheme, the consensus
            confidence is marked legacy.
          </p>
        </FormulaCard>

        <FormulaCard
          step={4}
          title="Direction and direction coverage"
          formula={
            <div className="space-y-2">
              <math
                display="block"
                aria-label="Direction vote equals the sum over direction-aware methods of forward evidence minus reverse evidence"
              >
                <mrow>
                  <msub><mi>V</mi><mtext>dir</mtext></msub><mo>=</mo>
                  <munder><mo>∑</mo><mrow><mi>m</mi><mo>∈</mo><mi>D</mi></mrow></munder>
                  <mo stretchy="false">(</mo><msub><mi>F</mi><mi>m</mi></msub><mo>−</mo>
                  <msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Direction confidence equals the absolute direction vote divided by the sum of forward plus reverse evidence across direction-aware methods"
              >
                <mrow>
                  <msub><mi>D</mi><mtext>conf</mtext></msub><mo>=</mo>
                  <mfrac>
                    <mrow><mo>|</mo><msub><mi>V</mi><mtext>dir</mtext></msub><mo>|</mo></mrow>
                    <mrow>
                      <munder><mo>∑</mo><mrow><mi>m</mi><mo>∈</mo><mi>D</mi></mrow></munder>
                      <mo stretchy="false">(</mo><msub><mi>F</mi><mi>m</mi></msub><mo>+</mo>
                      <msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo>
                    </mrow>
                  </mfrac>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Direction coverage equals direction-aware evidence divided by all evidence"
              >
                <mrow>
                  <msub><mi>D</mi><mtext>coverage</mtext></msub><mo>=</mo>
                  <mfrac>
                    <mrow>
                      <munder><mo>∑</mo><mrow><mi>m</mi><mo>∈</mo><mi>D</mi></mrow></munder>
                      <mi mathvariant="normal">max</mi><mo stretchy="false">(</mo>
                      <msub><mi>F</mi><mi>m</mi></msub><mo>,</mo>
                      <msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo>
                    </mrow>
                    <mrow>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <mi mathvariant="normal">max</mi><mo stretchy="false">(</mo>
                      <msub><mi>F</mi><mi>m</mi></msub><mo>,</mo>
                      <msub><mi>R</mi><mi>m</mi></msub><mo stretchy="false">)</mo>
                    </mrow>
                  </mfrac>
                </mrow>
              </math>
            </div>
          }
        >
          <p>
            For each unordered gene pair &#123;A,B&#125;, Fₘ is method <em>m</em>&apos;s
            evidence for A → B and Rₘ its evidence for B → A. <em>D</em> contains
            only direction-aware methods. The sign of Vdir chooses the displayed
            orientation; its absolute normalized margin is direction confidence.
          </p>
          <p className="mt-2">
            A value near 0 means forward and reverse evidence nearly cancel. It
            does not mean the reverse direction is likely. Coverage separately
            reports how much of all evidence came from methods able to vote on
            direction. For one directed method, confidence and coverage are 1;
            for one undirected method, confidence is unavailable and coverage
            is 0.
          </p>
        </FormulaCard>

        <FormulaCard
          step={5}
          title="Regulatory sign, sign stability, and sign coverage"
          formula={
            <div className="space-y-2">
              <math
                display="block"
                aria-label="Displayed sign equals the sign of the evidence-weighted method votes"
              >
                <mrow>
                  <mi>S</mi><mo>=</mo><mi mathvariant="normal">sgn</mi><mo stretchy="false">(</mo>
                  <munder><mo>∑</mo><mi>m</mi></munder>
                  <msub><mi>E</mi><mi>m</mi></msub><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                  <mo>·</mo><msub><mi>s</mi><mi>m</mi></msub><mo stretchy="false">)</mo>
                  <mo>,</mo><mspace width="1em" />
                  <msub><mi>s</mi><mi>m</mi></msub><mo>∈</mo>
                  <mo stretchy="false">&#123;</mo><mo>−</mo><mn>1</mn><mo>,</mo><mn>0</mn><mo>,</mo>
                  <mo>+</mo><mn>1</mn><mo stretchy="false">&#125;</mo>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Positive sign probability and signed coverage for method m"
              >
                <mrow>
                  <msubsup><mi>p</mi><mi>m</mi><mo>+</mo></msubsup><mo>=</mo>
                  <mfrac>
                    <msubsup><mi>N</mi><mi>m</mi><mo>+</mo></msubsup>
                    <mrow>
                      <msubsup><mi>N</mi><mi>m</mi><mo>+</mo></msubsup><mo>+</mo>
                      <msubsup><mi>N</mi><mi>m</mi><mo>−</mo></msubsup>
                    </mrow>
                  </mfrac>
                  <mo>,</mo><mspace width="1em" />
                  <msub><mi>q</mi><mi>m</mi></msub><mo>=</mo>
                  <mfrac>
                    <mrow>
                      <msubsup><mi>N</mi><mi>m</mi><mo>+</mo></msubsup><mo>+</mo>
                      <msubsup><mi>N</mi><mi>m</mi><mo>−</mo></msubsup>
                    </mrow>
                    <msub><mi>N</mi><mtext>selected</mtext></msub>
                  </mfrac>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Signed evidence weight and consensus positive probability"
              >
                <mrow>
                  <msub><mi>w</mi><mi>m</mi></msub><mo>=</mo>
                  <msub><mi>E</mi><mi>m</mi></msub><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                  <msub><mi>q</mi><mi>m</mi></msub>
                  <mo>,</mo><mspace width="1em" />
                  <msubsup><mi>P</mi><mtext>cons</mtext><mo>+</mo></msubsup><mo>=</mo>
                  <mfrac>
                    <mrow>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <msub><mi>w</mi><mi>m</mi></msub>
                      <msubsup><mi>p</mi><mi>m</mi><mo>+</mo></msubsup>
                    </mrow>
                    <mrow>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <msub><mi>w</mi><mi>m</mi></msub>
                    </mrow>
                  </mfrac>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Sign confidence equals consensus positive probability for activation or one minus it for repression"
              >
                <mrow>
                  <msub><mi>S</mi><mtext>conf</mtext></msub><mo>=</mo>
                  <mo stretchy="true">&#123;</mo>
                  <mtable columnalign="left left" rowspacing="0.55em">
                    <mtr>
                      <mtd><msubsup><mi>P</mi><mtext>cons</mtext><mo>+</mo></msubsup></mtd>
                      <mtd><mtext>&nbsp;if&nbsp;</mtext><mi>S</mi><mo>=</mo><mo>+</mo><mn>1</mn></mtd>
                    </mtr>
                    <mtr>
                      <mtd>
                        <mrow><mn>1</mn><mo>−</mo>
                        <msubsup><mi>P</mi><mtext>cons</mtext><mo>+</mo></msubsup></mrow>
                      </mtd>
                      <mtd><mtext>&nbsp;if&nbsp;</mtext><mi>S</mi><mo>=</mo><mo>−</mo><mn>1</mn></mtd>
                    </mtr>
                  </mtable>
                </mrow>
              </math>
              <math
                display="block"
                aria-label="Sign coverage equals signed evidence divided by all evidence"
              >
                <mrow>
                  <msub><mi>S</mi><mtext>coverage</mtext></msub><mo>=</mo>
                  <mfrac>
                    <mrow>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <msub><mi>E</mi><mi>m</mi></msub><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                      <msub><mi>q</mi><mi>m</mi></msub>
                    </mrow>
                    <mrow>
                      <munder><mo>∑</mo><mi>m</mi></munder>
                      <msub><mi>E</mi><mi>m</mi></msub><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo>
                    </mrow>
                  </mfrac>
                </mrow>
              </math>
            </div>
          }
        >
          <p>
            The displayed sign <em>S</em> is the evidence-weighted full-data
            vote: +1 is activation, −1 repression, and 0 unsigned. Unsigned
            methods abstain. Among bootstrap runs where the edge is selected,
            Nₘ⁺ and Nₘ⁻ count positive and negative nonzero raw scores.
          </p>
          <p className="mt-2">
            For one method, sign stability is the signed selected-run fraction
            agreeing with the displayed full-data sign; if the edge was absent
            from the full-data fit, the bootstrap-mean sign is the reference.
            For consensus, positive probability is averaged using signed
            evidence weights wₘ, then converted into agreement with the
            displayed consensus sign. Sign coverage measures how much total
            evidence had usable signed-bootstrap data.
          </p>
        </FormulaCard>
      </div>

      <details className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <summary className="cursor-pointer font-bold text-slate-800">
          Stored-result compatibility rules
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          Current bootstrap results store the per-target percentile above. When
          loading older or algorithm-specific files, the interface preserves a
          valid explicit normalized score first; otherwise it uses stored mean
          percentile, then an already bounded 0–1 score, then stored confidence,
          and finally computes the per-target percentile locally. A confidence
          value is labeled legacy unless its metadata confirms with-replacement
          cell bootstrapping.
        </p>
      </details>
    </section>
  );
}
