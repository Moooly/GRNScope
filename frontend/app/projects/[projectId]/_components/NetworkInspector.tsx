import type { AggregatedEdge, NodeInfo } from "../_lib/types";
import {
  displayEndpoints,
  edgeMetric,
  evidenceText,
  hasDirection,
  percent,
  relationshipLabel,
  signColor,
  signText,
} from "./networkVisualEncoding";

type Props = {
  edge: AggregatedEdge | null;
  node: NodeInfo | null;
  nodes: NodeInfo[];
  edges: AggregatedEdge[];
  methods: string[];
  highlightedMethod: string | null;
  onHighlight: (method: string | null) => void;
  onSelectEdge: (key: string) => void;
  onSelectGene: (gene: string) => void;
  onFocus: (gene: string) => void;
  onClose: () => void;
  canPerturb: boolean;
  onPerturb: (gene: string) => void;
};
export default function NetworkInspector({
  edge,
  node,
  nodes,
  edges,
  methods,
  highlightedMethod,
  onHighlight,
  onSelectEdge,
  onSelectGene,
  onFocus,
  onClose,
  canPerturb,
  onPerturb,
}: Props) {
  if (!edge && !node) return null;
  const endpoints = edge ? displayEndpoints(edge) : null;
  const type = (id: string) =>
    nodes.find((n) => n.id === id)?.isTF
      ? "Transcription factor"
      : "Other gene";
  const related = node
    ? edges.filter((e) => e.source === node.id || e.target === node.id)
    : [];
  return (
    <aside className="grn-inspector" aria-label="Network inspector">
      <header>
        <span className="grn-eyebrow">
          {edge ? "Relationship" : "Gene profile"}
        </span>
        <button aria-label="Close inspector" onClick={onClose}>
          ×
        </button>
      </header>
      {edge && endpoints ? (
        <>
          <h2 className="grn-inspector-title">{relationshipLabel(edge)}</h2>
          <p
            className="grn-sign-description"
            style={{ color: signColor(edge.sign) }}
          >
            {signText(edge.sign)}
          </p>
          <div className="grn-endpoints">
            {[endpoints.source, endpoints.target].map((id, index) => (
              <button key={id + index} onClick={() => onSelectGene(id)}>
                <span>{id}</span>
                <small>{type(id)}</small>
              </button>
            ))}
          </div>
          <div className="grn-score-grid">
            <div>
              <span>Confidence</span>
              <strong
                className={
                  edgeMetric(edge, "confidence", methods.length) === null
                    ? "grn-unavailable"
                    : ""
                }
              >
                {percent(edgeMetric(edge, "confidence", methods.length))}
              </strong>
            </div>
            <div>
              <span>Evidence</span>
              <strong>{evidenceText(edge.score)}</strong>
            </div>
            <div>
              <span>Method support</span>
              <strong>
                {edge.count}
                <small> / {methods.length}</small>
              </strong>
            </div>
          </div>
          <p className="grn-fine-print">
            {edge.bootstrapVerified === false
              ? "Verified cell-bootstrap confidence is unavailable for this legacy result."
              : "Confidence measures bootstrap recovery, not the probability of a biological interaction."}
          </p>
          {edge.bootstrapVerified === false && (
            <p className="grn-fine-print">
              Saved legacy resampling score: {percent(edge.confidence)}. The
              confidence filter uses this saved score.
            </p>
          )}
          <section className="grn-inspector-section">
            <h3>Sign & direction</h3>
            <dl className="grn-facts">
              <div>
                <dt>Direction</dt>
                <dd>{hasDirection(edge) ? "Predicted" : "Unresolved"}</dd>
              </div>
              <div>
                <dt>Direction confidence / coverage</dt>
                <dd>
                  {percent(edge.directionConfidence)} /{" "}
                  {percent(edge.directionCoverage)}
                </dd>
              </div>
              <div>
                <dt>Sign confidence / coverage</dt>
                <dd>
                  {percent(edge.signConfidence)} / {percent(edge.signCoverage)}
                </dd>
              </div>
            </dl>
            <p className="grn-fine-print">
              Support counts methods reporting this pair. Those methods may
              disagree on sign or direction.
            </p>
          </section>
          <section className="grn-inspector-section">
            <h3>
              Supporting algorithms{" "}
              <span>
                {edge.count}/{methods.length}
              </span>
            </h3>
            <p className="grn-fine-print">
              Select a method to highlight its relationships in this view.
            </p>
            <div className="grn-method-list">
              {methods.map((method) => {
                const supported = edge.supportingAlgorithms.includes(method);
                return (
                  <div
                    key={method}
                    className={supported ? "" : "grn-method-absent"}
                  >
                    <button
                      disabled={!supported}
                      aria-pressed={highlightedMethod === method}
                      onClick={() =>
                        onHighlight(
                          highlightedMethod === method ? null : method,
                        )
                      }
                    >
                      {method}
                      <span>
                        {supported
                          ? highlightedMethod === method
                            ? "Highlighted"
                            : "Highlight"
                          : "Not reported"}
                      </span>
                    </button>
                    {supported && (
                      <dl>
                        <div>
                          <dt>Evidence</dt>
                          <dd>
                            {evidenceText(edge.perAlgorithmScores[method])}
                          </dd>
                        </div>
                        <div>
                          <dt>Confidence</dt>
                          <dd>
                            {edge.bootstrapVerified !== true
                              ? "Unavailable"
                              : percent(edge.perAlgorithmConfidences?.[method])}
                          </dd>
                        </div>
                        <div>
                          <dt>Sign</dt>
                          <dd>
                            {signText(
                              edge.perAlgorithmSigns?.[method] ?? 0,
                            ).replace("Predicted ", "")}
                          </dd>
                        </div>
                        {edge.perAlgorithmRawScores?.[method] !== undefined && (
                          <div>
                            <dt>Raw score</dt>
                            <dd>
                              {Number(
                                edge.perAlgorithmRawScores[method],
                              ).toPrecision(4)}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {(edge.bootstrapRunCount !== undefined ||
            edge.evidenceCiLower != null ||
            edge.bootstrapSignConfidence != null) && (
            <section className="grn-inspector-section">
              <h3>Bootstrap detail</h3>
              <dl className="grn-facts">
                {edge.bootstrapRunCount !== undefined && (
                  <div>
                    <dt>Recovered samples</dt>
                    <dd>
                      {edge.bootstrapSelectedRuns ?? "—"} /{" "}
                      {edge.bootstrapRunCount}
                    </dd>
                  </div>
                )}
                {edge.evidenceCiLower != null && (
                  <div>
                    <dt>Evidence interval</dt>
                    <dd>
                      {evidenceText(edge.evidenceCiLower)}–
                      {evidenceText(edge.evidenceCiUpper)}
                    </dd>
                  </div>
                )}
                {edge.bootstrapSignConfidence != null && (
                  <div>
                    <dt>Sign confidence / coverage</dt>
                    <dd>
                      {percent(edge.bootstrapSignConfidence)} /{" "}
                      {percent(edge.bootstrapSignCoverage)}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </>
      ) : node ? (
        <>
          <h2 className="grn-inspector-title">{node.id}</h2>
          <p className="grn-sign-description">
            {node.isTF ? "◆ Transcription factor" : "● Other gene"}
          </p>
          <div className="grn-score-grid">
            <div>
              <span>Connections</span>
              <strong>{node.degree}</strong>
            </div>
            <div>
              <span>Incoming</span>
              <strong>{node.inDegree}</strong>
            </div>
            <div>
              <span>Outgoing</span>
              <strong>{node.outDegree}</strong>
            </div>
          </div>
          <p className="grn-fine-print">
            Counts use all relationships matching the result filters, before the
            display limit.
          </p>
          <button
            className="grn-primary grn-full"
            onClick={() => onFocus(node.id)}
          >
            Explore this neighborhood →
          </button>
          {canPerturb && (
            <button className="grn-full" onClick={() => onPerturb(node.id)}>
              Simulate perturbation
            </button>
          )}
          <section className="grn-inspector-section">
            <h3>
              Visible relationships <span>{related.length}</span>
            </h3>
            <div className="grn-relationship-list">
              {related.map((e) => (
                <button key={e.key} onClick={() => onSelectEdge(e.key)}>
                  <strong>{relationshipLabel(e)}</strong>
                  <span style={{ color: signColor(e.sign) }}>
                    {signText(e.sign)}
                  </span>
                  <small>
                    C {percent(edgeMetric(e, "confidence", methods.length))} · E{" "}
                    {evidenceText(e.score)} · {e.count}/{methods.length} methods
                  </small>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </aside>
  );
}
