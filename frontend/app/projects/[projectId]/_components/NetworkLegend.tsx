import {
  METRICS,
  NETWORK_COLORS,
  metricWidth,
  type NetworkMetric,
} from "./networkVisualEncoding";

export default function NetworkLegend({
  metric,
  methodCount,
  circos = false,
}: {
  metric: NetworkMetric;
  methodCount: number;
  circos?: boolean;
}) {
  if (circos)
    return (
      <footer className="grn-legend" aria-label="Chromosome network legend">
        <div>
          <strong>Reading Circos</strong>
          <p>
            Outer sectors group genes by chromosome. Ribbons summarize
            relationships between chromosome groups; wider ribbons represent
            more relationships.
          </p>
        </div>
        <div>
          <strong>Explore a ribbon</strong>
          <p>
            Select a chromosome or ribbon to inspect its genes and
            relationships. Color identifies the source chromosome, not
            regulatory sign. Opacity shows mean evidence (below 0.75, 0.75–0.90,
            at least 0.90); dense views use lower opacity.
          </p>
        </div>
        <div>
          <strong>Gene activity</strong>
          <p>
            Diamond marks identify TFs. Taller gene tracks mean more outgoing
            relationships. Sector widths reflect activity, not chromosome
            length.
          </p>
        </div>
      </footer>
    );
  return (
    <footer className="grn-legend" aria-label="Network legend">
      <div className="grn-legend-group">
        <strong>Genes</strong>
        <div className="grn-legend-items">
          <span>
            <i className="grn-node-symbol grn-diamond" />
            TF
          </span>
          <span>
            <i className="grn-node-symbol" />
            Other gene
          </span>
        </div>
        <small>Shape identifies gene type</small>
      </div>
      <div className="grn-legend-group">
        <strong>Predicted sign & direction</strong>
        <div className="grn-legend-items">
          <span>
            <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
              <path
                d="M2 8H23"
                stroke={NETWORK_COLORS.positive}
                strokeWidth="1.8"
              />
              <path d="M22 3L30 8L22 13Z" fill={NETWORK_COLORS.positive} />
            </svg>
            Activation
          </span>
          <span>
            <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
              <path
                d="M2 8H27M27 2V14"
                stroke={NETWORK_COLORS.negative}
                strokeWidth="1.8"
                fill="none"
              />
            </svg>
            Repression
          </span>
          <span>
            <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true">
              <path
                d="M2 8H22M22 3L30 8L22 13Z"
                stroke={NETWORK_COLORS.unknown}
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
            Unresolved sign
          </span>
        </div>
        <small>
          Tip points to the affected gene · No tip: direction unresolved
        </small>
      </div>
      <div className="grn-legend-group grn-legend-scale">
        <strong>Line width · {METRICS[metric].label}</strong>
        <div className="grn-scale">
          {[0, 0.5, 1].map((value) => (
            <span key={value}>
              <svg width="43" height="14" aria-hidden="true">
                <path
                  d="M2 7H41"
                  stroke="#476477"
                  strokeWidth={metricWidth(value)}
                  strokeLinecap="round"
                />
              </svg>
              {metric === "evidence"
                ? value.toFixed(1)
                : Math.round(value * 100) + "%"}
            </span>
          ))}
          <span>
            <svg width="35" height="14" aria-hidden="true">
              <path
                d="M2 7H33"
                stroke="#8b95a0"
                strokeWidth={metricWidth(null)}
                strokeDasharray="4 3"
              />
            </svg>
            Unavailable
          </span>
        </div>
        <small>
          {metric === "support"
            ? `Support = reporting methods ÷ ${methodCount} selected methods`
            : "Fixed scale · Gold outline marks your selection"}
        </small>
      </div>
    </footer>
  );
}
