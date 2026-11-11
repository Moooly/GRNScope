"use client";

import type { NetworkEdge } from "../networkGraphTypes";
import { displayEndpoints, hasDirection } from "../networkVisualEncoding";
import { elasticNetMagnitude } from "./encoding";

export type ElasticNetState = { loading: boolean; error: string; ready: boolean; retry: () => void };
export const betaText = (value: number | null | undefined) => typeof value !== "number" || !Number.isFinite(value) ? "—"
  : value === 0 ? "0.000" : Math.abs(value) < 0.001 ? value.toExponential(2) : `${value > 0 ? "+" : ""}${value.toFixed(3)}`;

export function ElasticNetDetails({ edge, state }: { edge: NetworkEdge; state?: ElasticNetState }) {
  const { source, target } = displayEndpoints(edge);
  const directed = hasDirection(edge);
  return <section className="tp-section en-detail">
    <h4>Elastic Net <span className="tp-muted">standardized β</span></h4>
    <dl className="tp-detail">
      <dt>{source} → {target}</dt><dd>{betaText(edge.elasticNetBeta)}</dd>
      {!directed && <><dt>{target} → {source}</dt><dd>{betaText(edge.elasticNetReverseBeta)}</dd></>}
    </dl>
    <p className="tp-sub">{state?.error || edge.elasticNetReason || (edge.elasticNetBeta === undefined ? "Coefficients are calculating automatically."
      : "Positive / negative β describes a conditional association. Zero means the fit shrank this coefficient to zero.")}
      {!directed && " Both directions are fitted; this does not resolve the edge’s direction."}</p>
    {state?.error && <button type="button" className="tp-link" onClick={state.retry}>Retry</button>}
  </section>;
}

export default function ElasticNetOverview({ edges, state, onSelectEdge, onHoverEdge }: {
  edges: NetworkEdge[]; state?: ElasticNetState; onSelectEdge: (key: string) => void; onHoverEdge: (key: string | null) => void;
}) {
  if (!state) return null;
  const fits = edges.flatMap(e => [e.elasticNetBeta, ...(!hasDirection(e) ? [e.elasticNetReverseBeta] : [])])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const fitted = edges.filter(e => elasticNetMagnitude(e) !== null);
  const positive = fits.filter(v => v > 0).length, negative = fits.filter(v => v < 0).length, zero = fits.length - positive - negative;
  const range = fits.reduce((max, v) => Math.max(max, Math.ceil(Math.abs(v) * 2) / 2), 1);
  const bins = Array.from({ length: 12 }, () => 0);
  for (const value of fits) bins[Math.min(11, Math.max(0, Math.floor((value + range) / (2 * range) * 12)))]++;
  const peak = Math.max(1, ...bins);
  const top = [...fitted].sort((a, b) => (elasticNetMagnitude(b) ?? 0) - (elasticNetMagnitude(a) ?? 0)).slice(0, 3);
  return <section className="tp-section en-overview" aria-label="Elastic Net overview">
    <header className="en-heading">
      <h4>Elastic Net</h4>
      {!state.loading && !state.error && <span className="en-coverage" title="Visible edges with at least one available coefficient">{fitted.length.toLocaleString()} / {edges.length.toLocaleString()} fitted</span>}
    </header>
    {state.loading ? <p className="en-status" role="status">Calculating coefficients…</p>
      : state.error ? <p className="en-status" role="status">{state.error} <button type="button" className="tp-link" onClick={state.retry}>Retry</button></p>
      : <>
        {!!fits.length && <>
          <dl className="en-counts" aria-label="Coefficient counts">
            <div><dt>Positive</dt><dd>{positive.toLocaleString()}</dd></div>
            <div><dt>Negative</dt><dd>{negative.toLocaleString()}</dd></div>
            <div><dt>Zero</dt><dd>{zero.toLocaleString()}</dd></div>
          </dl>
          <figure className="en-distribution">
            <figcaption><span>Standardized β</span><span>{fits.length.toLocaleString()} coefficients</span></figcaption>
            <svg viewBox="0 0 320 104" role="img" aria-label="Distribution of standardized Elastic Net coefficients">
            <line x1="20" x2="300" y1="76" y2="76" stroke="#dce4e9" />
            <line x1="160" x2="160" y1="10" y2="76" stroke="#dce4e9" strokeDasharray="2 3" />
            {bins.map((count, i) => <rect key={i} x={21 + i * 280 / 12} y={76 - count / peak * 60} width={280 / 12 - 3} height={count / peak * 60} fill="#70899a"><title>{(-range + i * range / 6).toFixed(2)} to {(-range + (i + 1) * range / 6).toFixed(2)}: {count} coefficients</title></rect>)}
            {[-range, 0, range].map((v, i) => <text key={i} x={20 + i * 140} y="95" textAnchor="middle" fontSize="11" fill="#6b7a86">{v}</text>)}
            </svg>
          </figure>
          <section className="en-top" aria-label="Strongest edges by absolute coefficient">
            <div className="en-top-heading"><h5>Strongest edges</h5><span>|β|</span></div>
            <ol>{top.map(edge => {
              const endpoints = displayEndpoints(edge);
              const label = `${endpoints.source} ${hasDirection(edge) ? "→" : "—"} ${endpoints.target}`;
              return <li key={edge.key}><button type="button" onClick={() => onSelectEdge(edge.key)} onMouseEnter={() => onHoverEdge(edge.key)} onMouseLeave={() => onHoverEdge(null)} title={label}>
                <span>{label}</span><b>{elasticNetMagnitude(edge)?.toFixed(3)}</b>
              </button></li>;
            })}</ol>
          </section>
        </>}
        {!fits.length && <p className="en-status">No coefficients available.</p>}
      </>}
  </section>;
}
