import type { GenomeReference } from "../_lib/types";
import { CircosReadingGuide } from "./CircosLegend";
import { displayEndpoints, hasDirection } from "./networkVisualEncoding";
import { circosScope, getChromosomeLabel, getRelationLabel, UNMAPPED_CHROMOSOME, type CircosFocus, type CircosSummary } from "./circosModel";

type Props = {
  summary: CircosSummary;
  reference: GenomeReference;
  focus: CircosFocus | null;
  onFocus: (focus: CircosFocus | null) => void;
  onSelectGene: (id: string) => void;
  onSelectEdge: (key: string) => void;
};

export function circosFocusLabel(summary: CircosSummary, focus: CircosFocus | null) {
  if (focus?.kind === "chromosome") return focus.chromosome === UNMAPPED_CHROMOSOME ? "Unknown locations" : `Chromosome ${getChromosomeLabel(focus.chromosome)}`;
  const bundle = focus?.kind === "bundle" ? summary.bundles.get(focus.bundleKey) : null;
  return bundle ? `${getChromosomeLabel(bundle.source)} ${bundle.relation === "undirected" ? "↔" : "→"} ${getChromosomeLabel(bundle.target)} · ${getRelationLabel(bundle.relation)}` : "Chromosome overview";
}

export default function CircosOverview({ summary, reference, focus, onFocus, onSelectGene, onSelectEdge }: Props) {
  const scope = circosScope(summary, focus);
  const chromosome = focus?.kind === "chromosome" ? summary.chromosomes.get(focus.chromosome) : null;
  const represented = new Set(scope.nodes.map(node => summary.chromosomeOf.get(node.id)).filter(id => id !== UNMAPPED_CHROMOSOME));
  const bundles = [...summary.bundles.values()].filter(bundle => !focus || (focus.kind === "bundle" ? bundle.key === focus.bundleKey : bundle.source === focus.chromosome || bundle.target === focus.chromosome))
    .sort((a, b) => b.edges.length - a.edges.length || a.key.localeCompare(b.key)).slice(0, 5);
  const chromosomes = [...summary.chromosomes.values()].filter(item => item.id !== UNMAPPED_CHROMOSOME).sort((a, b) => b.edges.length - a.edges.length || a.id.localeCompare(b.id)).slice(0, 5);
  const maxConnections = Math.max(1, ...chromosomes.map(item => item.edges.length));
  const stat = (value: number, label: string) => <div className="tp-stat"><b>{value.toLocaleString()}</b><span>{label}</span></div>;
  const topEdges = [...scope.edges].sort((a, b) => b.score - a.score).slice(0, 5);
  const degree = new Map<string, number>();
  scope.edges.forEach(edge => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); });
  const topGenes = [...scope.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, 5);

  return <div className="tp-card circos-overview">
    <div className="tp-stats">
      {stat(scope.nodes.length, chromosome ? "connected genes" : "genes")}{stat(scope.edges.length, "relationships")}{stat(represented.size, "chromosomes")}
    </div>
    {chromosome && <dl className="tp-detail" aria-label="Chromosome relationship counts">
      <dt>Incoming</dt><dd>{chromosome.incoming}</dd><dt>Outgoing</dt><dd>{chromosome.outgoing}</dd>
      <dt>Within chromosome</dt><dd>{chromosome.internal}</dd><dt>Direction unresolved</dt><dd>{chromosome.unresolved}</dd>
    </dl>}
    {focus?.kind === "bundle" ? <section className="tp-section">
      <h4>Strongest relationships</h4>
      <div className="circos-rank-list">{topEdges.map(edge => {
        const endpoints = displayEndpoints(edge);
        return <button type="button" key={edge.key} onClick={() => onSelectEdge(edge.key)}>
          <span><em>{endpoints.source}</em> {hasDirection(edge) ? "→" : "↔"} <em>{endpoints.target}</em></span><b>{edge.score.toFixed(3)}</b>
        </button>;
      })}</div>
    </section> : <section className="tp-section">
      <h4>Top chromosome connections</h4>
      <div className="circos-rank-list">{bundles.map(bundle => <button type="button" key={bundle.key} onClick={() => onFocus({ kind: "bundle", bundleKey: bundle.key })}>
        <span>{getChromosomeLabel(bundle.source)} {bundle.relation === "undirected" ? "↔" : "→"} {getChromosomeLabel(bundle.target)}<small>{getRelationLabel(bundle.relation)}</small></span>
        <b>{bundle.edges.length.toLocaleString()}</b>
      </button>)}</div>
      {!bundles.length && <p className="tp-empty">No chromosome connections in this view.</p>}
    </section>}
    {!focus && <section className="tp-section">
      <h4>Most connected chromosomes</h4>
      <div className="circos-rank-list">{chromosomes.map(item => <button type="button" key={item.id} onClick={() => onFocus({ kind: "chromosome", chromosome: item.id })} title={`${item.edges.length} relationships involving chromosome ${getChromosomeLabel(item.id)}; each relationship counted once`}>
        <span className="circos-chromosome-name">chr{getChromosomeLabel(item.id)}</span>
        <span className="circos-rank-track"><i style={{ width: `${100 * item.edges.length / maxConnections}%` }} /></span><b>{item.edges.length.toLocaleString()}</b>
      </button>)}</div>
    </section>}
    {focus && <section className="tp-section">
      <h4>Connected genes</h4>
      <div className="circos-rank-list">{topGenes.map(node => <button type="button" key={node.id} onClick={() => onSelectGene(node.id)}><em>{node.id}</em><b>{degree.get(node.id)}</b></button>)}</div>
    </section>}
    <section className="circos-reference" aria-label="Genome reference and mapping">
      <h4>{reference.species === "mouse" ? "Mouse" : "Human"} · {reference.assembly}</h4>
      <span>{reference.annotation}</span>
      <p>{summary.mappedCount.toLocaleString()} mapped · {summary.unmappedCount.toLocaleString()} unmapped genes</p>
      {summary.unmappedCount > 0 && <button type="button" className="tp-link" onClick={() => onFocus({ kind: "chromosome", chromosome: UNMAPPED_CHROMOSOME })}>Inspect Unknown group →</button>}
    </section>
    <CircosReadingGuide />
  </div>;
}
