import {
  METRICS,
  metricOpacity,
  type NetworkMetric,
} from "./networkVisualEncoding";

import {
  NETWORK_APPEARANCES,
  type NetworkAppearance,
} from "./networkAppearance";

export default function NetworkLegend({
  metric,
  methodCount,
  circos = false,
  appearance = "classic",
  onChangeMetric,
  confidenceDisabled = false,
}: {
  metric: NetworkMetric;
  methodCount: number;
  circos?: boolean;
  appearance?: NetworkAppearance;
  onChangeMetric?: (metric: NetworkMetric) => void;
  confidenceDisabled?: boolean;
}) {
  const palette = NETWORK_APPEARANCES[appearance];
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
    <footer
      className="grn-legend grn-legend-compact"
      aria-label="Network legend"
    >
      <span className="grn-legend-key">
        <i
          className="grn-node-symbol grn-diamond"
          style={{ background: palette.tf }}
        />
        TF
      </span>
      <span className="grn-legend-key">
        <i className="grn-node-symbol" />
        Gene
      </span>
      {(appearance === "atlas" ||
        appearance === "teal" ||
        appearance === "pastel") && (
        <span className="grn-legend-key">Size = connections</span>
      )}
      <span className="grn-legend-sep" aria-hidden="true" />
      <span className="grn-legend-key">
        <svg width="30" height="14" viewBox="0 0 32 16" aria-hidden="true">
          <path d="M2 8H23" stroke={palette.positive} strokeWidth="1.8" />
          <path d="M22 3L30 8L22 13Z" fill={palette.positive} />
        </svg>
        Activation
      </span>
      <span className="grn-legend-key">
        <svg width="30" height="14" viewBox="0 0 32 16" aria-hidden="true">
          <path
            d="M2 8H27M27 2V14"
            stroke={palette.negative}
            strokeWidth="1.8"
            fill="none"
          />
        </svg>
        Repression
      </span>
      <span className="grn-legend-sep" aria-hidden="true" />
      <span className="grn-legend-key grn-legend-widthkey">
        <span className="grn-legend-emphasis">
          Emphasis
          {onChangeMetric ? (
            <select
              className="grn-legend-emphasis-select"
              value={metric}
              onChange={(event) =>
                onChangeMetric(event.target.value as NetworkMetric)
              }
              aria-label="Emphasis metric"
            >
              {(Object.keys(METRICS) as NetworkMetric[]).map((key) => (
                <option
                  key={key}
                  value={key}
                  disabled={key === "confidence" && confidenceDisabled}
                >
                  {METRICS[key].label}
                </option>
              ))}
            </select>
          ) : (
            <> = {METRICS[metric].label}</>
          )}
        </span>
        <span className="grn-scale">
          {[0, 0.5, 1].map((value) => (
            <span key={value}>
              <svg width="30" height="12" aria-hidden="true">
                <path
                  d="M2 6H28"
                  stroke={palette.node}
                  strokeWidth={2.4}
                  strokeOpacity={metricOpacity(value)}
                  strokeLinecap="round"
                />
              </svg>
              {metric === "evidence"
                ? value.toFixed(1)
                : Math.round(value * 100) + "%"}
            </span>
          ))}
        </span>
      </span>
    </footer>
  );
}
