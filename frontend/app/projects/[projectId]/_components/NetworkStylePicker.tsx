import {
  NETWORK_APPEARANCES,
  type NetworkAppearance,
} from "./networkAppearance";

export default function NetworkStylePicker({
  value,
  onChange,
}: {
  value: NetworkAppearance;
  onChange: (value: NetworkAppearance) => void;
}) {
  return (
    <fieldset className="grn-style-picker">
      <legend>Network style</legend>
      <div className="grn-style-grid">
        {(Object.keys(NETWORK_APPEARANCES) as NetworkAppearance[]).map(
          (key) => {
            const p = NETWORK_APPEARANCES[key];
            const shaded = key === "silver" || key === "graphite";
            return (
              <button
                type="button"
                key={key}
                aria-pressed={value === key}
                aria-label={p.label}
                title={p.description}
                onClick={() => onChange(key)}
              >
                <svg viewBox="0 0 140 57" aria-hidden="true">
                  <defs>
                    <radialGradient
                      id={`grn-preview-${key}`}
                      cx="35%"
                      cy="25%"
                      r="75%"
                    >
                      <stop stopColor="#fff" />
                      <stop offset="0.4" stopColor={p.node} />
                      <stop
                        offset="1"
                        stopColor={key === "graphite" ? "#222" : "#737b85"}
                      />
                    </radialGradient>
                  </defs>
                  <rect width="140" height="57" rx="6" fill={p.background} />
                  <path
                    d={
                      key === "pastel" || key === "classic"
                        ? "M22 16L67 32L113 12M67 32L121 45M67 32L28 47"
                        : "M22 16Q53 14 67 32Q80 20 113 12M67 32Q92 33 121 45M67 32Q45 31 28 47"
                    }
                    fill="none"
                    stroke={p.positive}
                    strokeWidth="1.2"
                    opacity="0.8"
                  />
                  <path
                    d="M67 32L86 51"
                    stroke={p.negative}
                    strokeWidth="1.2"
                  />
                  {[
                    [22, 16, 4],
                    [113, 12, 4],
                    [121, 45, 4],
                    [28, 47, 4],
                    [86, 51, 3],
                  ].map(([x, y, r]) => (
                    <circle
                      key={x}
                      cx={x}
                      cy={y}
                      r={shaded ? 6 : r}
                      fill={shaded ? `url(#grn-preview-${key})` : p.node}
                    />
                  ))}
                  <path
                    d="M67 22L77 32L67 42L57 32Z"
                    fill={shaded ? `url(#grn-preview-${key})` : p.tf}
                  />
                </svg>
                <span>{p.label}</span>
              </button>
            );
          },
        )}
      </div>
      <p>
        Teal uses branching neighborhoods in Force layout. Other styles retain
        the standard layouts.
      </p>
    </fieldset>
  );
}
