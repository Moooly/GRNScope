"use client";

import { useEffect, useRef, useState } from "react";

import type { NetworkViewCounts } from "./networkViewCounts";
import "./resultsEdgeCount.css";

/** Long enough to read as movement, short enough not to delay the next change. */
const TWEEN_MS = 520;
/** How long the delta chip stays before fading. Matches the CSS animation. */
const DELTA_MS = 1400;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The live relationship count, at the top of Results Settings.
 *
 * It sits above the filters rather than among them because it is not a filter:
 * it is what the filters produced. Every control below it moves this number,
 * and the number is the only way to tell whether a threshold did anything --
 * a reader who drags Evidence from 31% to 45% otherwise has to close the panel
 * and compare two pictures from memory.
 *
 * The headline is `total`, not `shown`, and the difference matters. `shown` is
 * capped by the opening view's readability budget, so on a network large enough
 * to be trimmed it sits at the cap and does not move: tightening Evidence from
 * 31% to 45% drops the matching relationships from 67 to 65 while the canvas
 * still draws its 38 strongest either way. Animating `shown` would report
 * "nothing happened" for a filter change that did something. `total` is the
 * number the controls in this panel actually decide, so it is the number that
 * answers for them; how many of those fit on the canvas is a separate fact, and
 * it belongs in the line underneath.
 *
 * The count tweens instead of cutting because the distance travelled is the
 * point: dropping from 67 to 12 should feel different from dropping to 61, and
 * a number that simply replaces itself gives both the same weight.
 *
 * Everything else here is a number or a control. The prose that used to explain
 * the trim -- how the ranking works, what the canvas is currently drawing -- is
 * gone: it restated the two numbers already on the card, and it was two lines of
 * reading above the filters on every single open. What survives of it lives in
 * the toggle's title, where it is available on hover to the one reader in twenty
 * who wants it and costs the other nineteen nothing.
 */
export default function ResultsEdgeCount({
  shown,
  total,
  trimmed,
  showAll,
  canShowAll,
  onToggleShowAll,
}: NetworkViewCounts) {
  const [display, setDisplay] = useState(total);
  const [pulse, setPulse] = useState({ key: 0, delta: 0 });
  const previous = useRef(total);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const from = previous.current;
    previous.current = total;
    if (from === total) return;

    setPulse((current) => ({ key: current.key + 1, delta: total - from }));

    if (reducedMotion()) {
      setDisplay(total);
    } else {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / TWEEN_MS);
        setDisplay(Math.round(from + (total - from) * easeOut(progress)));
        if (progress < 1) frame.current = requestAnimationFrame(step);
      };
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(step);
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setPulse((current) => ({ ...current, delta: 0 })),
      DELTA_MS,
    );

    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
    };
  }, [total]);

  const direction =
    pulse.delta > 0 ? "up" : pulse.delta < 0 ? "down" : "flat";

  return (
    <div
      className="grn-edge-count"
      data-direction={direction}
      data-pulsed={pulse.key > 0}
    >
      <div className="grn-edge-count-head">
        <span className="grn-edge-count-eyebrow">
          Relationships passing filters
        </span>
        {pulse.delta !== 0 && (
          // Keyed on the pulse so a second change restarts the animation
          // instead of leaving a chip that is already part-way faded.
          <span key={pulse.key} className="grn-edge-count-delta">
            {pulse.delta > 0 ? "▲ +" : "▼ −"}
            {Math.abs(pulse.delta).toLocaleString()}
          </span>
        )}
      </div>

      <p className="grn-edge-count-value">
        {/* The tweened value is decorative; assistive technology is given the
            settled number and told when it changes, not sixty intermediate
            frames of a count-up. */}
        <span
          key={pulse.key}
          className="grn-edge-count-number"
          aria-hidden="true"
        >
          {display.toLocaleString()}
        </span>
        {trimmed && (
          <span className="grn-edge-count-total" aria-hidden="true">
            {shown.toLocaleString()} drawn
          </span>
        )}
        {(trimmed || (showAll && canShowAll)) && (
          <button
            type="button"
            className="grn-edge-count-action"
            onClick={onToggleShowAll}
            title={
              showAll
                ? "Draw only the strongest relationships, ranked by method agreement then confidence"
                : "Draw every relationship passing these filters, including the ones trimmed for readability"
            }
          >
            {showAll ? "Show strongest" : `Show all ${total.toLocaleString()}`}
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {trimmed
            ? `${total.toLocaleString()} relationships pass these filters; the canvas draws the strongest ${shown.toLocaleString()}.`
            : `${total.toLocaleString()} relationships pass these filters.`}
        </span>
      </p>
    </div>
  );
}
