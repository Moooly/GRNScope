import {
  METRICS,
  metricOpacity,
  type NetworkMetric,
} from "./networkVisualEncoding";

import {
  NETWORK_APPEARANCES,
  type NetworkAppearance,
} from "./networkAppearance";
import {
  MODULE_BRIDGE,
  MODULE_COLORS,
  MODULE_NEUTRAL,
} from "./networkModules";

const GROUP_LABEL = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#9aa8b6",
  whiteSpace: "nowrap",
} as const;

const INK = "#4a5b6b";

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
  // Focused consensus: one uniform line per relationship, with the arrowhead
  // carrying agreement and evidence. Long explanations live in the tooltips so
  // the bar stays a single scannable row.
  if (appearance === "braid")
    return (
      <footer
        className="grn-legend grn-legend-compact"
        aria-label="Network legend"
      >
        <span style={GROUP_LABEL}>Link</span>
        <span
          className="grn-legend-key"
          title="The regulator increases its target's expression"
        >
          <svg width="30" height="12" aria-hidden="true">
            <path d="M1 6h17" stroke={palette.positive} strokeWidth="2" />
            <path d="M17 1.5L28 6L17 10.5Z" fill={palette.positive} />
          </svg>
          Activates
        </span>
        <span
          className="grn-legend-key"
          title="The regulator decreases its target's expression"
        >
          <svg width="30" height="12" aria-hidden="true">
            <path d="M1 6h23" stroke={palette.negative} strokeWidth="2" />
            <path d="M25 1v10" stroke={palette.negative} strokeWidth="2.6" />
          </svg>
          Represses
        </span>
        <span className="grn-legend-sep" aria-hidden="true" />
        <span style={GROUP_LABEL}>Strength</span>
        <span
          className="grn-legend-key"
          title="Arrowhead size — how many inference methods called this relationship"
        >
          <svg width="36" height="14" aria-hidden="true">
            <path d="M1 7h10" stroke={INK} strokeWidth="1.5" />
            <path d="M10 5L14 7L10 9Z" fill={INK} />
            <path d="M19 7h5" stroke={INK} strokeWidth="1.5" />
            <path d="M24 1L35 7L24 13Z" fill={INK} />
          </svg>
          Agreement
        </span>
        <span
          className="grn-legend-key"
          title="Arrowhead fill — solid means this regulator is among the stronger explanations for its target"
        >
          <svg width="36" height="14" aria-hidden="true">
            <path d="M1 7h8" stroke={INK} strokeWidth="1.5" />
            <path
              d="M9 2.6L16 7L9 11.4Z"
              fill="#fff"
              stroke={INK}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M21 7h8" stroke={INK} strokeWidth="1.5" />
            <path d="M29 2.6L36 7L29 11.4Z" fill={INK} />
          </svg>
          Evidence
        </span>
        <span
          className="grn-legend-key"
          title="Line darkness — bootstrap confidence in the relationship"
        >
          <svg width="34" height="14" aria-hidden="true">
            <defs>
              <linearGradient
                id="grnLegendConfidence"
                gradientUnits="userSpaceOnUse"
                x1="1"
                y1="0"
                x2="33"
                y2="0"
              >
                <stop offset="0%" stopColor={INK} stopOpacity="0.16" />
                <stop offset="100%" stopColor={INK} stopOpacity="1" />
              </linearGradient>
            </defs>
            <path
              d="M1 7h32"
              stroke="url(#grnLegendConfidence)"
              strokeWidth="3"
            />
          </svg>
          Confidence
        </span>
        <span className="grn-legend-sep" aria-hidden="true" />
        <span style={GROUP_LABEL}>Gene</span>
        <span className="grn-legend-key" title="Transcription factor">
          <svg width="18" height="18" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r="6.5"
              fill={palette.tf}
              stroke="#61d0c4"
              strokeWidth="2"
            />
          </svg>
          TF
        </span>
        <span className="grn-legend-key" title="Regulated gene">
          <svg width="18" height="18" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r="6"
              fill={palette.node}
              stroke="#a8c3d5"
              strokeWidth="1.5"
            />
          </svg>
          Target
        </span>
        <span
          className="grn-legend-key"
          title="Node size — number of regulatory links the gene takes part in"
        >
          <svg width="34" height="18" aria-hidden="true">
            <circle cx="6" cy="9" r="3.5" fill={palette.node} stroke="#a8c3d5" strokeWidth="1.3" />
            <circle cx="22" cy="9" r="7.5" fill={palette.node} stroke="#a8c3d5" strokeWidth="1.3" />
          </svg>
          Connections
        </span>
      </footer>
    );

  // Atlas: too many genes to read a single relationship, so colour carries
  // regulatory modules instead of sign. Sign returns when you zoom in.
  if (appearance === "atlas")
    return (
      <footer
        className="grn-legend grn-legend-compact"
        aria-label="Network legend"
      >
        <span style={GROUP_LABEL}>Colour</span>
        <span
          className="grn-legend-key"
          title="Genes reached by the same master regulator before any other one"
        >
          <svg width="46" height="14" aria-hidden="true">
            {MODULE_COLORS.slice(0, 6).map((color, index) => (
              <circle key={color} cx={5 + index * 7.6} cy={7} r={3.4} fill={color} />
            ))}
          </svg>
          Regulatory module
        </span>
        <span
          className="grn-legend-key"
          title="Genes more than four steps from any of the main hubs"
        >
          <svg width="16" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="3.4" fill={MODULE_NEUTRAL} />
          </svg>
          Outside
        </span>
        <span
          className="grn-legend-key"
          title="A relationship linking two different modules"
        >
          <svg width="26" height="14" aria-hidden="true">
            <path d="M1 7h24" stroke={MODULE_BRIDGE} strokeWidth="2" />
          </svg>
          Bridge
        </span>
        <span className="grn-legend-sep" aria-hidden="true" />
        <span style={GROUP_LABEL}>Gene</span>
        <span className="grn-legend-key" title="Transcription factor">
          <svg width="18" height="16" aria-hidden="true">
            <rect
              x="4"
              y="2"
              width="10"
              height="10"
              fill={palette.node}
              transform="rotate(45 9 7)"
            />
          </svg>
          TF
        </span>
        <span
          className="grn-legend-key"
          title="Node size — number of regulatory links the gene takes part in"
        >
          <svg width="30" height="16" aria-hidden="true">
            <circle cx="5" cy="8" r="2.6" fill={palette.node} />
            <circle cx="19" cy="8" r="6" fill={palette.node} />
          </svg>
          Connections
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
                <svg width="24" height="12" aria-hidden="true">
                  <path
                    d="M2 6H22"
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
        <span style={{ fontSize: 11, color: "#8496a6", fontStyle: "italic" }}>
          Zoom in for activation and repression
        </span>
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
