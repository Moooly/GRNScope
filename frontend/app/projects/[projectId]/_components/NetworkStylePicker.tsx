import {
  NETWORK_APPEARANCES,
  type NetworkAppearance,
} from "./networkAppearance";

const STYLE_OPTIONS: NetworkAppearance[] = ["atlas", "braid", "classic", "teal"];

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
        {STYLE_OPTIONS.map((key) => {
          const p = NETWORK_APPEARANCES[key];
          const curved = key !== "classic";
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
                <rect width="140" height="57" rx="6" fill={p.background} />
                <path
                  d={
                    curved
                      ? "M22 16Q53 14 67 32Q80 20 113 12M67 32Q92 33 121 45M67 32Q45 31 28 47"
                      : "M22 16L67 32L113 12M67 32L121 45M67 32L28 47"
                  }
                  fill="none"
                  stroke={p.positive}
                  strokeWidth="1.2"
                  opacity="0.85"
                />
                <path d="M67 32L86 51" stroke={p.negative} strokeWidth="1.2" />
                {[
                  [22, 16, 4],
                  [113, 12, 4],
                  [121, 45, 4],
                  [28, 47, 4],
                  [86, 51, 3],
                ].map(([x, y, r]) => (
                  <circle key={x} cx={x} cy={y} r={r} fill={p.node} />
                ))}
                <path d="M67 22L77 32L67 42L57 32Z" fill={p.tf} />
              </svg>
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>
      <p>
        Regulatory atlas and Teal use force-directed neighborhoods in the Force
        layout. Current style keeps the standard layouts.
      </p>
    </fieldset>
  );
}
